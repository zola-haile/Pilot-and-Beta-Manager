import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate, requireVerified } from "../middleware/auth";
import { rateLimit, byUser } from "../middleware/rateLimit";
import { signToken } from "../lib/jwt";
import { pilotStatus } from "../lib/pilotStatus";
import { CommentCategory } from "@prisma/client";
import {
  COMMENT_CATEGORIES,
  CATEGORY_VALUES,
  serializeBoardComment,
  serializeReply,
  tokenize,
  similarityScore,
} from "../lib/comments";
import { saveDataUrlFile, signUploadPath } from "../lib/uploads";
import { pilotedFeatures, pilotedFeatureIds } from "../lib/pilotFeatures";
import { listPrivateThread, serializeCreated, saveChatImages } from "../lib/chat";
import { notifyNewReport, notifyReply, notifyPrivateMessage } from "../lib/notify";

export const participantRouter = Router();

// Any authenticated user (PMs included, so they can preview) can use these.
participantRouter.use(authenticate);

/** Ensures the current user is a member of the pilot; returns the membership. */
async function requireMembership(pilotId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { pilotId, participant: { userId } },
  });
  if (!membership) throw new HttpError(403, "You are not part of this pilot");
  return membership;
}

function answersToMap(answers: { questionId: string; value: string | null }[]) {
  return Object.fromEntries(answers.map((a) => [a.questionId, a.value]));
}

// GET /my/pilots — pilots the current user has been invited to / joined.
participantRouter.get(
  "/pilots",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.membership.findMany({
      where: { participant: { userId: req.user!.sub } },
      include: {
        pilot: {
          include: { _count: { select: { questions: true } } },
        },
      },
      orderBy: { invitedAt: "desc" },
    });

    // Count each user's finalized (submitted) entries per pilot.
    const grouped = await prisma.submission.groupBy({
      by: ["pilotId"],
      where: { userId: req.user!.sub, submittedAt: { not: null } },
      _count: { _all: true },
    });
    const entryCount = new Map(grouped.map((g) => [g.pilotId, g._count._all]));

    res.json({
      pilots: memberships.map((m) => ({
        id: m.pilot.id,
        name: m.pilot.name,
        description: m.pilot.description,
        status: pilotStatus(m.pilot.startDate, m.pilot.endDate),
        // No survey => nothing to answer, regardless of any leftover questions.
        questionCount: m.pilot.surveyEnabled ? m.pilot._count.questions : 0,
        entryCount: entryCount.get(m.pilot.id) ?? 0,
      })),
    });
  })
);

// GET /my/pilots/:id — the questions, the user's open draft, and their history
// of past submitted entries.
participantRouter.get(
  "/pilots/:id",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      include: {
        questions: { orderBy: { order: "asc" } },
      },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");
    const features = await pilotedFeatures(pilot);

    // Per-feature star ratings: this user's own rating + the shared average.
    const featureIds = features.map((f) => f.id);
    const [mine, agg] = await Promise.all([
      prisma.featureRating.findMany({
        where: { pilotId: pilot.id, userId: req.user!.sub, featureId: { in: featureIds } },
      }),
      prisma.featureRating.groupBy({
        by: ["featureId"],
        where: { pilotId: pilot.id, featureId: { in: featureIds } },
        _avg: { stars: true },
        _count: { _all: true },
      }),
    ]);
    const myByFeature = new Map(mine.map((r) => [r.featureId, r.stars]));
    const aggByFeature = new Map(agg.map((a) => [a.featureId, a]));

    const draft = await prisma.submission.findFirst({
      where: { pilotId: pilot.id, userId: req.user!.sub, submittedAt: null },
      include: { answers: true },
    });
    const history = await prisma.submission.findMany({
      where: { pilotId: pilot.id, userId: req.user!.sub, submittedAt: { not: null } },
      orderBy: { submittedAt: "desc" },
      include: { answers: true },
    });

    const announcements = await prisma.announcement.findMany({
      where: { pilotId: pilot.id },
      orderBy: { createdAt: "desc" },
      include: { images: true },
    });

    res.json({
      pilot: {
        id: pilot.id,
        name: pilot.name,
        description: pilot.description,
        status: pilotStatus(pilot.startDate, pilot.endDate),
        startDate: pilot.startDate,
        endDate: pilot.endDate,
        surveyEnabled: pilot.surveyEnabled,
        // When the survey is off, hide the questions from participants entirely.
        questions: pilot.surveyEnabled ? pilot.questions : [],
      },
      // Only the features this pilot is testing (drives grouping + the composer +
      // the star ratings). myRating is this user's; avgRating/ratingCount are shared.
      features: features.map((f) => {
        const a = aggByFeature.get(f.id);
        return {
          id: f.id,
          name: f.name,
          description: f.description,
          myRating: myByFeature.get(f.id) ?? null,
          avgRating: a?._avg.stars ?? null,
          ratingCount: a?._count._all ?? 0,
        };
      }),
      commentCategories: COMMENT_CATEGORIES,
      announcements: announcements.map((a) => ({
        id: a.id,
        subject: a.subject,
        body: a.body,
        createdAt: a.createdAt,
        images: a.images.map((i) => ({ id: i.id, url: signUploadPath(i.url), name: i.name, mime: i.mime })),
      })),
      draft: { answers: draft ? answersToMap(draft.answers) : {} },
      history: history.map((h) => ({
        id: h.id,
        submittedAt: h.submittedAt,
        answers: answersToMap(h.answers),
      })),
    });
  })
);

const saveSchema = z.object({
  // questionId -> answer value (stringified client-side)
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  // true = finalize this entry (validates required, starts fresh next time)
  // false/omitted = just save the open draft
  submit: z.boolean().optional().default(false),
});

// PUT /my/pilots/:id/submission — save the open draft, or finalize it as a new
// dated entry. Each finalized submit becomes its own record, so participants can
// keep adding entries over the life of the pilot.
participantRouter.put(
  "/pilots/:id/submission",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { answers, submit } = saveSchema.parse(req.body);

    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      select: { surveyEnabled: true },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");
    if (!pilot.surveyEnabled) throw new HttpError(400, "This pilot isn't collecting a survey");

    const questions = await prisma.question.findMany({
      where: { pilotId: req.params.id },
    });
    const questionIds = new Set(questions.map((q) => q.id));

    // On final submit, enforce required questions.
    if (submit) {
      const missing = questions.filter((q) => {
        if (!q.required) return false;
        const v = answers[q.id];
        return v === undefined || v === null || v === "";
      });
      if (missing.length > 0) {
        throw new HttpError(422, `Please answer all required questions (${missing.length} remaining)`);
      }
    }

    // Reuse the user's open draft if one exists, otherwise start a new one.
    let submission = await prisma.submission.findFirst({
      where: { pilotId: req.params.id, userId: req.user!.sub, submittedAt: null },
    });
    if (!submission) {
      submission = await prisma.submission.create({
        data: { pilotId: req.params.id, userId: req.user!.sub },
      });
    }

    // Upsert each answer that maps to a real question of this pilot.
    for (const [questionId, value] of Object.entries(answers)) {
      if (!questionIds.has(questionId)) continue;
      const stringValue = value === null ? null : String(value);
      await prisma.answer.upsert({
        where: { submissionId_questionId: { submissionId: submission.id, questionId } },
        create: { submissionId: submission.id, questionId, value: stringValue },
        update: { value: stringValue },
      });
    }

    // Finalizing sets submittedAt; the draft becomes a permanent history entry
    // and the next save will open a fresh draft.
    if (submit) {
      submission = await prisma.submission.update({
        where: { id: submission.id },
        data: { submittedAt: new Date() },
      });
    }

    res.json({ ok: true, submitted: submit, submittedAt: submission.submittedAt });
  })
);

// DELETE /my/pilots/:id/submissions/:sid — a participant deletes their own entry.
participantRouter.delete(
  "/pilots/:id/submissions/:sid",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const submission = await prisma.submission.findUnique({ where: { id: req.params.sid } });
    if (!submission || submission.pilotId !== req.params.id || submission.userId !== req.user!.sub) {
      throw new HttpError(404, "Entry not found");
    }
    await prisma.submission.delete({ where: { id: submission.id } }); // cascades answers
    res.status(204).end();
  })
);

/* --------------------------- Feature ratings --------------------------- */

const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) });

// PUT /my/pilots/:id/features/:featureId/rating — set (or change) the current
// user's 1–5 star rating for one of the pilot's features. Returns the refreshed
// personal + shared numbers so the UI can update in place.
participantRouter.put(
  "/pilots/:id/features/:featureId/rating",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { stars } = ratingSchema.parse(req.body);

    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      select: { id: true, applicationId: true, allFeatures: true },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");

    // Only features this pilot is actually testing can be rated.
    const piloted = await pilotedFeatureIds(pilot);
    if (!piloted.has(req.params.featureId)) {
      throw new HttpError(404, "That feature isn't part of this pilot");
    }

    await prisma.featureRating.upsert({
      where: {
        pilotId_featureId_userId: {
          pilotId: pilot.id,
          featureId: req.params.featureId,
          userId: req.user!.sub,
        },
      },
      create: { pilotId: pilot.id, featureId: req.params.featureId, userId: req.user!.sub, stars },
      update: { stars },
    });

    const agg = await prisma.featureRating.aggregate({
      where: { pilotId: pilot.id, featureId: req.params.featureId },
      _avg: { stars: true },
      _count: { _all: true },
    });
    res.json({
      myRating: stars,
      avgRating: agg._avg.stars,
      ratingCount: agg._count._all,
    });
  })
);

/* --------------------------- Ask a question --------------------------- */
// A participant's private 1:1 line to the pilot's PM (surfaced as "Ask a
// question"). The old shared group channel has been removed — reports are now
// the public space (see the Reports section below).

/** The pilot + its owning PM's id, or 404. */
async function pilotWithOwner(pilotId: string) {
  const pilot = await prisma.pilot.findUnique({
    where: { id: pilotId },
    select: { id: true, application: { select: { ownerId: true } } },
  });
  if (!pilot) throw new HttpError(404, "Pilot not found");
  return { ownerId: pilot.application.ownerId };
}

// GET /my/pilots/:id/chat/private — my private thread with the organizer.
participantRouter.get(
  "/pilots/:id/chat/private",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { ownerId } = await pilotWithOwner(req.params.id);
    res.json({ messages: await listPrivateThread(req.params.id, req.user!.sub, req.user!.sub, ownerId) });
  })
);

// An incoming attachment: a data URL plus its original filename.
const fileSchema = z.object({ data: z.string(), name: z.string().optional() });

const privateSchema = z
  .object({
    body: z.string().max(4000).optional().default(""),
    images: z.array(fileSchema).max(6, "At most 6 files").optional().default([]),
  })
  .refine((d) => d.body.trim().length > 0 || d.images.length > 0, {
    message: "Write a message or attach a file",
  });

// POST /my/pilots/:id/chat/private — send a private message to the organizer.
participantRouter.post(
  "/pilots/:id/chat/private",
  rateLimit({ windowMs: 60 * 1000, max: 30, key: byUser, message: "You're sending messages too fast" }),
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { ownerId } = await pilotWithOwner(req.params.id);
    const { body, images } = privateSchema.parse(req.body);
    const saved = await saveChatImages(images);
    const created = await prisma.chatMessage.create({
      data: {
        pilotId: req.params.id,
        userId: req.user!.sub,
        threadUserId: req.user!.sub, // the thread is keyed on the participant
        body: body.trim(),
        images: { create: saved.map((s) => ({ url: s.url, name: s.name, mime: s.mime })) },
      },
    });
    void notifyPrivateMessage(created.id); // fire-and-forget
    res.status(201).json({ message: await serializeCreated(created.id, req.user!.sub, ownerId) });
  })
);

/* -------------------------- Reports (public) -------------------------- */
// Reports are a public board: every member of the pilot sees every report under
// its category, and can reply. `anonymous` hides the author from peers AND the PM.

const replyInclude = {
  user: { select: { id: true, name: true } },
} as const;
const boardCommentInclude = {
  user: { select: { id: true, name: true } },
  features: true,
  images: true,
  replies: { orderBy: { createdAt: "asc" as const }, include: replyInclude },
} as const;

/** Map participant userId -> company name for a pilot (for public report bylines). */
async function companyMapForPilot(pilotId: string) {
  const memberships = await prisma.membership.findMany({
    where: { pilotId, participant: { userId: { not: null } } },
    include: { participant: { include: { company: { select: { name: true } } } } },
  });
  return new Map(memberships.map((m) => [m.participant.userId!, m.participant.company.name]));
}

const createCommentSchema = z.object({
  subject: z.string().max(200, "Keep the subject under 200 characters").optional(),
  body: z.string().min(1, "Please describe your feedback"),
  category: z.enum(CATEGORY_VALUES),
  featureIds: z.array(z.string()).optional().default([]),
  images: z.array(fileSchema).max(6, "At most 6 files").optional().default([]),
  anonymous: z.boolean().optional().default(false),
});

// POST /my/pilots/:id/comments — post a report to the pilot's public board.
participantRouter.post(
  "/pilots/:id/comments",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: byUser, message: "You're posting too fast, slow down a little" }),
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { subject, body, category, featureIds, images, anonymous } = createCommentSchema.parse(req.body);

    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      select: { id: true, applicationId: true, allFeatures: true },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");

    // Only allow features this pilot is actually testing.
    let validFeatureIds: string[] = [];
    if (featureIds.length > 0) {
      const piloted = await pilotedFeatureIds(pilot);
      validFeatureIds = featureIds.filter((id) => piloted.has(id));
    }

    // Persist files to disk first (throws on invalid data).
    const saved = [];
    for (const f of images) saved.push(await saveDataUrlFile(f.data, f.name));

    const comment = await prisma.comment.create({
      data: {
        pilotId: req.params.id,
        userId: req.user!.sub,
        subject: subject?.trim() || null,
        body,
        category: category as CommentCategory,
        anonymous,
        features: { connect: validFeatureIds.map((id) => ({ id })) },
        images: { create: saved.map((s) => ({ url: s.url, name: s.name, mime: s.mime })) },
      },
      include: boardCommentInclude,
    });
    void notifyNewReport(comment.id); // fire-and-forget; never throws
    const companyByUser = await companyMapForPilot(req.params.id);
    const { ownerId } = await pilotWithOwner(req.params.id);
    res.status(201).json({
      comment: serializeBoardComment(comment, req.user!.sub, ownerId, companyByUser),
    });
  })
);

// GET /my/pilots/:id/comments/similar?q=... — reports on this pilot whose
// subject/body overlaps with what the participant is typing, so they can catch a
// duplicate before posting. Identity-free: never reveals who wrote a match.
participantRouter.get(
  "/pilots/:id/comments/similar",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const q = String(req.query.q ?? "").trim();
    const queryTokens = tokenize(q);
    if (q.length < 3 || queryTokens.length === 0) {
      res.json({ matches: [] });
      return;
    }

    const reports = await prisma.comment.findMany({
      where: { pilotId: req.params.id },
      select: {
        id: true,
        subject: true,
        body: true,
        category: true,
        createdAt: true,
        _count: { select: { replies: true } },
      },
    });

    const matches = reports
      .map((r) => {
        // Weight the title heavily; the body is a weaker signal.
        const score =
          similarityScore(queryTokens, r.subject ?? "") * 2 +
          similarityScore(queryTokens, r.body);
        return { r, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || +b.r.createdAt - +a.r.createdAt)
      .slice(0, 5)
      .map(({ r }) => ({
        id: r.id,
        subject: r.subject,
        category: r.category,
        snippet: r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body,
        replyCount: r._count.replies,
        createdAt: r.createdAt,
      }));

    res.json({ matches });
  })
);

// GET /my/pilots/:id/comments — the whole public board for this pilot.
participantRouter.get(
  "/pilots/:id/comments",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const comments = await prisma.comment.findMany({
      where: { pilotId: req.params.id },
      orderBy: { createdAt: "desc" },
      include: boardCommentInclude,
    });
    const companyByUser = await companyMapForPilot(req.params.id);
    const { ownerId } = await pilotWithOwner(req.params.id);
    res.json({
      comments: comments.map((c) => serializeBoardComment(c, req.user!.sub, ownerId, companyByUser)),
    });
  })
);

// DELETE /my/pilots/:id/comments/:cid — delete one of your own reports.
participantRouter.delete(
  "/pilots/:id/comments/:cid",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id || comment.userId !== req.user!.sub) {
      throw new HttpError(404, "Comment not found");
    }
    await prisma.comment.delete({ where: { id: comment.id } }); // cascades images + replies
    res.status(204).end();
  })
);

const createReplySchema = z.object({
  body: z.string().min(1, "Write a reply"),
  anonymous: z.boolean().optional().default(false),
});

// POST /my/pilots/:id/comments/:cid/replies — reply to a report on the board.
participantRouter.post(
  "/pilots/:id/comments/:cid/replies",
  rateLimit({ windowMs: 60 * 1000, max: 30, key: byUser, message: "You're replying too fast, slow down a little" }),
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { body, anonymous } = createReplySchema.parse(req.body);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id) throw new HttpError(404, "Report not found");

    const reply = await prisma.commentReply.create({
      data: { commentId: comment.id, userId: req.user!.sub, body: body.trim(), anonymous },
      include: replyInclude,
    });
    void notifyReply(reply.id); // fire-and-forget
    const { ownerId } = await pilotWithOwner(req.params.id);
    res.status(201).json({ reply: serializeReply(reply, req.user!.sub, ownerId) });
  })
);

// DELETE /my/pilots/:id/comments/:cid/replies/:rid — delete your own reply.
participantRouter.delete(
  "/pilots/:id/comments/:cid/replies/:rid",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const reply = await prisma.commentReply.findUnique({ where: { id: req.params.rid } });
    if (!reply || reply.commentId !== req.params.cid || reply.userId !== req.user!.sub) {
      throw new HttpError(404, "Reply not found");
    }
    await prisma.commentReply.delete({ where: { id: reply.id } });
    res.status(204).end();
  })
);

/* ------------------------- Self-serve onboarding ------------------------- */
// These let a signed-in user (e.g. a tester who registered on their own) pick up
// invitations, join via a shared link, or claim an offered company-admin seat —
// all tied to the account they're already logged into, no fresh-account token.

/** Loads the current user, or throws. */
async function currentUser(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) throw new HttpError(404, "User not found");
  return me;
}

// GET /my/invitations — pilot invites addressed to my email that I haven't accepted.
// Requires a verified email (it's keyed on the account's email address).
participantRouter.get(
  "/invitations",
  requireVerified,
  asyncHandler(async (req, res) => {
    const me = await currentUser(req.user!.sub);
    const memberships = await prisma.membership.findMany({
      where: { status: "INVITED", participant: { is: { email: me.email } } },
      include: { pilot: true, participant: { include: { company: true } } },
      orderBy: { invitedAt: "desc" },
    });
    res.json({
      invitations: memberships.map((m) => ({
        token: m.inviteToken,
        pilot: { id: m.pilot.id, name: m.pilot.name, description: m.pilot.description },
        company: m.participant.company.name,
      })),
    });
  })
);

// POST /my/invitations/:token/accept — accept an invite addressed to my email.
participantRouter.post(
  "/invitations/:token/accept",
  requireVerified,
  asyncHandler(async (req, res) => {
    const me = await currentUser(req.user!.sub);
    const membership = await prisma.membership.findUnique({
      where: { inviteToken: req.params.token },
      include: { participant: true },
    });
    if (!membership) throw new HttpError(404, "Invitation not found");
    if (membership.participant.email.toLowerCase() !== me.email.toLowerCase()) {
      throw new HttpError(403, "This invitation was sent to a different email address");
    }
    await prisma.participant.update({
      where: { id: membership.participant.id },
      data: { userId: me.id },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: membership.acceptedAt ?? new Date(),
        inviteToken: randomBytes(24).toString("hex"), // single-use: dead-link it
      },
    });
    res.json({ ok: true, pilotId: membership.pilotId });
  })
);

const joinSchema = z.object({ token: z.string().min(1) });

// POST /my/join — enroll me via a company's shareable self-enroll link.
participantRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const { token } = joinSchema.parse(req.body);
    const me = await currentUser(req.user!.sub);
    const pc = await prisma.pilotCompany.findUnique({
      where: { shareToken: token },
      include: { company: true, pilot: true },
    });
    if (!pc) throw new HttpError(404, "This link is not valid");

    const participant = await prisma.participant.upsert({
      where: { companyId_email: { companyId: pc.companyId, email: me.email } },
      create: { companyId: pc.companyId, email: me.email, name: me.name, userId: me.id },
      update: { userId: me.id },
    });
    const existing = await prisma.membership.findUnique({
      where: { pilotId_participantId: { pilotId: pc.pilotId, participantId: participant.id } },
    });
    if (!existing) {
      await prisma.membership.create({
        data: {
          pilotId: pc.pilotId,
          participantId: participant.id,
          inviteToken: randomBytes(24).toString("hex"),
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      });
    } else if (existing.status !== "ACCEPTED") {
      await prisma.membership.update({
        where: { id: existing.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
    }
    res.json({ ok: true, pilot: { id: pc.pilot.id, name: pc.pilot.name } });
  })
);

// GET /my/admin-claims — company-admin seats offered to my email but not yet claimed.
// Verified email required: the seat is keyed on the address, so we must know the
// account actually controls it before offering (let alone granting) the seat.
participantRouter.get(
  "/admin-claims",
  requireVerified,
  asyncHandler(async (req, res) => {
    const me = await currentUser(req.user!.sub);
    const companies = await prisma.company.findMany({
      where: { adminEmail: me.email, adminUserId: null },
      select: { id: true, name: true },
    });
    res.json({ claims: companies });
  })
);

// POST /my/admin-claims/:companyId/accept — claim an offered admin seat. Becoming a
// company admin bumps a plain tester to COMPANY_ADMIN, so we re-issue their token.
participantRouter.post(
  "/admin-claims/:companyId/accept",
  requireVerified,
  asyncHandler(async (req, res) => {
    const me = await currentUser(req.user!.sub);
    const company = await prisma.company.findUnique({ where: { id: req.params.companyId } });
    if (!company) throw new HttpError(404, "Company not found");
    if (company.adminEmail.toLowerCase() !== me.email.toLowerCase()) {
      throw new HttpError(403, "This admin seat was offered to a different email address");
    }
    if (company.adminUserId && company.adminUserId !== me.id) {
      throw new HttpError(409, "This company already has an admin");
    }

    await prisma.company.update({ where: { id: company.id }, data: { adminUserId: me.id } });
    // Keep a PM a PM (that would strip their powers); only promote plain testers.
    // Promotion bumps tokenVersion so any other sessions with the old role die.
    const user =
      me.role === "PARTICIPANT"
        ? await prisma.user.update({
            where: { id: me.id },
            data: { role: "COMPANY_ADMIN", tokenVersion: { increment: 1 } },
          })
        : me;

    const token = signToken({ sub: user.id, role: user.role, email: user.email, tv: user.tokenVersion });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerifiedAt !== null,
      },
    });
  })
);
