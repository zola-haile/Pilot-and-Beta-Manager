import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate } from "../middleware/auth";
import { pilotStatus } from "../lib/pilotStatus";
import { CommentCategory } from "@prisma/client";
import { COMMENT_CATEGORIES, CATEGORY_VALUES } from "../lib/comments";
import { saveDataUrlImage } from "../lib/uploads";

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
        questionCount: m.pilot._count.questions,
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
        application: { include: { features: { orderBy: { name: "asc" } } } },
      },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");

    const draft = await prisma.submission.findFirst({
      where: { pilotId: pilot.id, userId: req.user!.sub, submittedAt: null },
      include: { answers: true },
    });
    const history = await prisma.submission.findMany({
      where: { pilotId: pilot.id, userId: req.user!.sub, submittedAt: { not: null } },
      orderBy: { submittedAt: "desc" },
      include: { answers: true },
    });

    res.json({
      pilot: {
        id: pilot.id,
        name: pilot.name,
        description: pilot.description,
        status: pilotStatus(pilot.startDate, pilot.endDate),
        questions: pilot.questions,
      },
      // Everything the comment composer needs:
      features: pilot.application.features.map((f) => ({ id: f.id, name: f.name })),
      commentCategories: COMMENT_CATEGORIES,
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

/* ------------------------------ Comments ------------------------------ */

function serializeComment(c: {
  id: string;
  body: string;
  category: string;
  createdAt: Date;
  features: { id: string; name: string }[];
  images: { id: string; url: string }[];
}) {
  return {
    id: c.id,
    body: c.body,
    category: c.category,
    createdAt: c.createdAt,
    features: c.features.map((f) => ({ id: f.id, name: f.name })),
    images: c.images.map((i) => ({ id: i.id, url: i.url })),
  };
}

const createCommentSchema = z.object({
  body: z.string().min(1, "Please describe your feedback"),
  category: z.enum(CATEGORY_VALUES),
  featureIds: z.array(z.string()).optional().default([]),
  images: z.array(z.string()).max(6, "At most 6 images").optional().default([]),
});

// POST /my/pilots/:id/comments — leave a flexible comment on the pilot.
participantRouter.post(
  "/pilots/:id/comments",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const { body, category, featureIds, images } = createCommentSchema.parse(req.body);

    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      select: { applicationId: true },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");

    // Only allow features belonging to this pilot's application.
    let validFeatureIds: string[] = [];
    if (featureIds.length > 0) {
      const features = await prisma.feature.findMany({
        where: { id: { in: featureIds }, applicationId: pilot.applicationId },
        select: { id: true },
      });
      validFeatureIds = features.map((f) => f.id);
    }

    // Persist images to disk first (throws on invalid data).
    const urls: string[] = [];
    for (const dataUrl of images) urls.push(await saveDataUrlImage(dataUrl));

    const comment = await prisma.comment.create({
      data: {
        pilotId: req.params.id,
        userId: req.user!.sub,
        body,
        category: category as CommentCategory,
        features: { connect: validFeatureIds.map((id) => ({ id })) },
        images: { create: urls.map((url) => ({ url })) },
      },
      include: { features: true, images: true },
    });
    res.status(201).json({ comment: serializeComment(comment) });
  })
);

// GET /my/pilots/:id/comments — the current user's comments on this pilot.
participantRouter.get(
  "/pilots/:id/comments",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const comments = await prisma.comment.findMany({
      where: { pilotId: req.params.id, userId: req.user!.sub },
      orderBy: { createdAt: "desc" },
      include: { features: true, images: true },
    });
    res.json({ comments: comments.map(serializeComment) });
  })
);

// DELETE /my/pilots/:id/comments/:cid — delete one of your own comments.
participantRouter.delete(
  "/pilots/:id/comments/:cid",
  asyncHandler(async (req, res) => {
    await requireMembership(req.params.id, req.user!.sub);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id || comment.userId !== req.user!.sub) {
      throw new HttpError(404, "Comment not found");
    }
    await prisma.comment.delete({ where: { id: comment.id } }); // cascades images
    res.status(204).end();
  })
);
