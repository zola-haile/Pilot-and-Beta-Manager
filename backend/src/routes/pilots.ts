import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate, requireRole } from "../middleware/auth";
import { pilotStatus } from "../lib/pilotStatus";
import { config } from "../config";
import { sendEmail, inviteEmail, adminInviteEmail, adminNotifyEmail } from "../lib/email";
import {
  STATUS_VALUES,
  PRIORITY_VALUES,
  COMMENT_STATUSES,
  COMMENT_PRIORITIES,
} from "../lib/comments";
import { CommentStatus, CommentPriority } from "@prisma/client";
import { commentAnalytics, questionRollups, sentimentScore } from "../lib/analytics";
import { pilotedFeatures, pilotedFeatureIds } from "../lib/pilotFeatures";
import { signUploadPath } from "../lib/uploads";

const OPEN_STATUSES = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS"];

// Single-pilot operations. Listing/creating pilots lives on the applications
// router (scoped to an application: /applications/:appId/pilots).
export const pilotsRouter = Router();

// All routes here require an authenticated PM.
pilotsRouter.use(authenticate, requireRole("PM"));

/** Loads a pilot in the current PM's application or throws 404. */
async function getOwnedPilot(pilotId: string, ownerId: string) {
  const pilot = await prisma.pilot.findUnique({
    where: { id: pilotId },
    include: { application: true },
  });
  if (!pilot || pilot.application.ownerId !== ownerId) {
    throw new HttpError(404, "Pilot not found");
  }
  return pilot;
}

const appBase = () => config.appUrl.replace(/\/$/, "");
function inviteUrl(token: string): string {
  return `${appBase()}/invite/${token}`;
}
function adminSetupUrl(token: string): string {
  return `${appBase()}/admin/accept/${token}`;
}
function shareUrl(token: string): string {
  return `${appBase()}/join/${token}`;
}

/**
 * Ensures the company is recorded as participating in the pilot (PilotCompany).
 * Returns the record; does not email anyone.
 */
async function ensurePilotCompany(pilotId: string, companyId: string) {
  return prisma.pilotCompany.upsert({
    where: { pilotId_companyId: { pilotId, companyId } },
    create: { pilotId, companyId },
    update: {},
  });
}

const upsertPilotSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
});

// GET /pilots/:id — full detail: questions, participants (with company), summary.
pilotsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const pilot = await prisma.pilot.findUnique({
      where: { id: req.params.id },
      include: {
        questions: { orderBy: { order: "asc" } },
        memberships: {
          orderBy: { invitedAt: "asc" },
          include: { participant: { include: { company: { select: { id: true, name: true } } } } },
        },
        submissions: { select: { userId: true, submittedAt: true } },
        pilotCompanies: {
          orderBy: { invitedAt: "asc" },
          include: {
            company: { include: { _count: { select: { participants: true } } } },
          },
        },
      },
    });
    if (!pilot) throw new HttpError(404, "Pilot not found");

    // How many finalized entries each participant has submitted.
    const entryCount = new Map<string, number>();
    for (const s of pilot.submissions) {
      if (s.submittedAt) entryCount.set(s.userId, (entryCount.get(s.userId) ?? 0) + 1);
    }

    // Count this pilot's participants per company (via memberships).
    const perCompany = new Map<string, number>();
    for (const m of pilot.memberships) {
      const cid = m.participant.company.id;
      perCompany.set(cid, (perCompany.get(cid) ?? 0) + 1);
    }

    const features = await pilotedFeatures(pilot);

    res.json({
      pilot: {
        id: pilot.id,
        applicationId: pilot.applicationId,
        name: pilot.name,
        description: pilot.description,
        startDate: pilot.startDate,
        endDate: pilot.endDate,
        createdAt: pilot.createdAt,
        status: pilotStatus(pilot.startDate, pilot.endDate),
        allFeatures: pilot.allFeatures,
        features: features.map((f) => ({ id: f.id, name: f.name, description: f.description })),
        questions: pilot.questions,
        companies: pilot.pilotCompanies.map((pc) => ({
          id: pc.id,
          company: { id: pc.company.id, name: pc.company.name },
          adminEmail: pc.company.adminEmail,
          adminJoined: pc.company.adminUserId !== null,
          participantsInPilot: perCompany.get(pc.company.id) ?? 0,
          shareUrl: shareUrl(pc.shareToken),
        })),
        participants: pilot.memberships.map((m) => ({
          id: m.id,
          email: m.participant.email,
          name: m.participant.name,
          company: m.participant.company,
          status: m.status,
          invitedAt: m.invitedAt,
          acceptedAt: m.acceptedAt,
          joined: m.participant.userId !== null,
          // Invite link is a bearer secret — only surface it until they've joined.
          inviteUrl: m.participant.userId ? null : inviteUrl(m.inviteToken),
          entryCount: m.participant.userId ? entryCount.get(m.participant.userId) ?? 0 : 0,
        })),
      },
    });
  })
);

// PATCH /pilots/:id — update basic fields.
pilotsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const data = upsertPilotSchema.partial().parse(req.body);
    const pilot = await prisma.pilot.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startDate !== undefined
          ? { startDate: data.startDate ? new Date(data.startDate) : null }
          : {}),
        ...(data.endDate !== undefined
          ? { endDate: data.endDate ? new Date(data.endDate) : null }
          : {}),
      },
    });
    res.json({ pilot: { ...pilot, status: pilotStatus(pilot.startDate, pilot.endDate) } });
  })
);

// DELETE /pilots/:id — remove a pilot and everything under it (cascade).
pilotsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    await prisma.pilot.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

/* --------------------------- Piloted features -------------------------- */

const setFeaturesSchema = z.object({
  allFeatures: z.boolean(),
  featureIds: z.array(z.string()).optional().default([]),
});

// PUT /pilots/:id/features — set which of the app's features this pilot tests.
// Questions tied to a feature that's dropped fall back to "general".
pilotsRouter.put(
  "/:id/features",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const { allFeatures, featureIds } = setFeaturesSchema.parse(req.body);

    // Resolve the effective set of feature ids after this change.
    let effectiveIds: string[];
    if (allFeatures) {
      const all = await prisma.feature.findMany({
        where: { applicationId: pilot.applicationId },
        select: { id: true },
      });
      effectiveIds = all.map((f) => f.id);
    } else {
      const valid = await prisma.feature.findMany({
        where: { id: { in: featureIds }, applicationId: pilot.applicationId },
        select: { id: true },
      });
      effectiveIds = valid.map((f) => f.id);
    }

    await prisma.$transaction([
      prisma.pilot.update({ where: { id: pilot.id }, data: { allFeatures } }),
      prisma.pilotFeature.deleteMany({ where: { pilotId: pilot.id } }),
      ...(allFeatures
        ? []
        : [
            prisma.pilotFeature.createMany({
              data: effectiveIds.map((featureId) => ({ pilotId: pilot.id, featureId })),
            }),
          ]),
      // Detach questions pointing at a feature this pilot no longer tests.
      prisma.question.updateMany({
        where: effectiveIds.length
          ? { pilotId: pilot.id, featureId: { notIn: effectiveIds } }
          : { pilotId: pilot.id, featureId: { not: null } },
        data: { featureId: null },
      }),
    ]);

    const features = await pilotedFeatures({ ...pilot, allFeatures });
    res.json({
      allFeatures,
      features: features.map((f) => ({ id: f.id, name: f.name, description: f.description })),
    });
  })
);

/* ----------------------------- Questions ----------------------------- */

const questionSchema = z.object({
  label: z.string().min(1, "Question label is required"),
  helpText: z.string().optional().nullable(),
  type: z.enum(["TEXT", "TEXTAREA", "NUMBER", "BOOLEAN", "SELECT", "RATING"]),
  options: z.any().optional(),
  required: z.boolean().optional(),
  order: z.number().int().optional(),
  featureId: z.string().nullable().optional(), // null/absent = a general question
});

/** Throws unless the featureId (when set) is among the pilot's tested features. */
async function assertFeaturePiloted(
  pilot: { id: string; applicationId: string; allFeatures: boolean },
  featureId: string | null | undefined
) {
  if (!featureId) return;
  const ids = await pilotedFeatureIds(pilot);
  if (!ids.has(featureId)) {
    throw new HttpError(400, "That feature isn't being tested in this pilot");
  }
}

// POST /pilots/:id/questions — add a question.
pilotsRouter.post(
  "/:id/questions",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const data = questionSchema.parse(req.body);
    await assertFeaturePiloted(pilot, data.featureId);
    const max = await prisma.question.aggregate({
      where: { pilotId: req.params.id },
      _max: { order: true },
    });
    const question = await prisma.question.create({
      data: {
        pilotId: req.params.id,
        featureId: data.featureId ?? null,
        label: data.label,
        helpText: data.helpText ?? null,
        type: data.type,
        options: data.options ?? undefined,
        required: data.required ?? false,
        order: data.order ?? (max._max.order ?? -1) + 1,
      },
    });
    res.status(201).json({ question });
  })
);

// PATCH /pilots/:id/questions/:qid — edit a question.
pilotsRouter.patch(
  "/:id/questions/:qid",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const data = questionSchema.partial().parse(req.body);
    const existing = await prisma.question.findUnique({ where: { id: req.params.qid } });
    if (!existing || existing.pilotId !== req.params.id) {
      throw new HttpError(404, "Question not found");
    }
    if (data.featureId !== undefined) await assertFeaturePiloted(pilot, data.featureId);
    const question = await prisma.question.update({
      where: { id: req.params.qid },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.helpText !== undefined ? { helpText: data.helpText } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.options !== undefined ? { options: data.options ?? undefined } : {}),
        ...(data.required !== undefined ? { required: data.required } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.featureId !== undefined ? { featureId: data.featureId } : {}),
      },
    });
    res.json({ question });
  })
);

// DELETE /pilots/:id/questions/:qid
pilotsRouter.delete(
  "/:id/questions/:qid",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const existing = await prisma.question.findUnique({ where: { id: req.params.qid } });
    if (!existing || existing.pilotId !== req.params.id) {
      throw new HttpError(404, "Question not found");
    }
    await prisma.question.delete({ where: { id: req.params.qid } });
    res.status(204).end();
  })
);

/* ---------------------------- Invitations ---------------------------- */

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional().nullable(),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  companyAdminEmail: z.string().email().optional(), // required when creating a new company
  sendEmail: z.boolean().optional().default(true),
});

// POST /pilots/:id/invitations — invite a person (resolving their company) into
// the pilot. Reuses the app-level participant if they already exist.
pilotsRouter.post(
  "/:id/invitations",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const ownerId = req.user!.sub;
    const { email, name, companyId, companyName, companyAdminEmail, sendEmail: shouldSend } =
      inviteSchema.parse(req.body);

    // Resolve the company among the PM's companies (top-level).
    let company;
    if (companyId) {
      company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company || company.ownerId !== ownerId) throw new HttpError(404, "Company not found");
    } else if (companyName && companyName.trim()) {
      const cname = companyName.trim();
      company = await prisma.company.findUnique({
        where: { ownerId_name: { ownerId, name: cname } },
      });
      if (!company) {
        if (!companyAdminEmail) {
          throw new HttpError(400, "A new company needs an admin email");
        }
        company = await prisma.company.create({
          data: { ownerId, name: cname, adminEmail: companyAdminEmail },
        });
      }
    } else {
      throw new HttpError(400, "A company is required");
    }

    // Reuse or create the participant under this company.
    const participant = await prisma.participant.upsert({
      where: { companyId_email: { companyId: company.id, email } },
      create: { companyId: company.id, email, name: name ?? null },
      update: { ...(name ? { name } : {}) },
    });

    const existing = await prisma.membership.findUnique({
      where: { pilotId_participantId: { pilotId: pilot.id, participantId: participant.id } },
    });
    if (existing) throw new HttpError(409, "That person is already invited to this pilot");

    const token = randomBytes(24).toString("hex");
    const membership = await prisma.membership.create({
      data: { pilotId: pilot.id, participantId: participant.id, inviteToken: token },
    });
    // Keep the "companies in this pilot" view complete when a PM invites someone
    // directly from a company that wasn't added to the pilot yet.
    await ensurePilotCompany(pilot.id, company.id);

    const url = inviteUrl(token);
    if (shouldSend) {
      const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });
      await sendEmail(inviteEmail({ to: email, pilotName: pilot.name, inviteUrl: url, inviterName: inviter?.name }));
    }

    res.status(201).json({
      participant: {
        id: membership.id,
        email: participant.email,
        name: participant.name,
        company: { id: company.id, name: company.name },
        status: membership.status,
        invitedAt: membership.invitedAt,
        inviteUrl: url,
      },
    });
  })
);

// POST /pilots/:id/invitations/:mid/resend — re-send the invite email.
pilotsRouter.post(
  "/:id/invitations/:mid/resend",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const membership = await prisma.membership.findUnique({
      where: { id: req.params.mid },
      include: { participant: true },
    });
    if (!membership || membership.pilotId !== pilot.id) {
      throw new HttpError(404, "Invitation not found");
    }
    const url = inviteUrl(membership.inviteToken);
    const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    await sendEmail(
      inviteEmail({ to: membership.participant.email, pilotName: pilot.name, inviteUrl: url, inviterName: inviter?.name })
    );
    res.json({ ok: true, inviteUrl: url });
  })
);

// DELETE /pilots/:id/invitations/:mid — revoke a participant from this pilot.
pilotsRouter.delete(
  "/:id/invitations/:mid",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const membership = await prisma.membership.findUnique({ where: { id: req.params.mid } });
    if (!membership || membership.pilotId !== pilot.id) {
      throw new HttpError(404, "Invitation not found");
    }
    await prisma.membership.delete({ where: { id: membership.id } });
    res.status(204).end();
  })
);

/* ------------------------- Companies in a pilot ------------------------- */

/** Emails a company's admin about a pilot (setup link if new, else notify). */
async function emailCompanyAdmin(
  company: { name: string; adminEmail: string; adminUserId: string | null; adminInviteToken: string },
  pilotName: string,
  inviterName?: string | null
) {
  if (company.adminUserId) {
    await sendEmail(
      adminNotifyEmail({
        to: company.adminEmail,
        companyName: company.name,
        pilotName,
        manageUrl: `${appBase()}/admin`,
        inviterName,
      })
    );
  } else {
    await sendEmail(
      adminInviteEmail({
        to: company.adminEmail,
        companyName: company.name,
        pilotName,
        setupUrl: adminSetupUrl(company.adminInviteToken),
        inviterName,
      })
    );
  }
}

const addCompanySchema = z.object({ companyId: z.string() });

// POST /pilots/:id/companies — add a company to the pilot and email its admin.
pilotsRouter.post(
  "/:id/companies",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const { companyId } = addCompanySchema.parse(req.body);
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company || company.ownerId !== req.user!.sub) {
      throw new HttpError(404, "Company not found");
    }
    const existing = await prisma.pilotCompany.findUnique({
      where: { pilotId_companyId: { pilotId: pilot.id, companyId } },
    });
    if (existing) throw new HttpError(409, "That company is already in this pilot");

    const pc = await prisma.pilotCompany.create({
      data: { pilotId: pilot.id, companyId },
    });
    const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    await emailCompanyAdmin(company, pilot.name, inviter?.name);

    res.status(201).json({
      pilotCompany: {
        id: pc.id,
        company: { id: company.id, name: company.name },
        adminEmail: company.adminEmail,
        adminJoined: company.adminUserId !== null,
        participantsInPilot: 0,
        shareUrl: shareUrl(pc.shareToken),
      },
    });
  })
);

// DELETE /pilots/:id/companies/:pcId — remove a company from the pilot.
pilotsRouter.delete(
  "/:id/companies/:pcId",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const pc = await prisma.pilotCompany.findUnique({ where: { id: req.params.pcId } });
    if (!pc || pc.pilotId !== pilot.id) throw new HttpError(404, "Not found");
    await prisma.pilotCompany.delete({ where: { id: pc.id } });
    res.status(204).end();
  })
);

// POST /pilots/:id/companies/:pcId/resend — re-email the company admin.
pilotsRouter.post(
  "/:id/companies/:pcId/resend",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const pc = await prisma.pilotCompany.findUnique({
      where: { id: req.params.pcId },
      include: { company: true },
    });
    if (!pc || pc.pilotId !== pilot.id) throw new HttpError(404, "Not found");
    const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    await emailCompanyAdmin(pc.company, pilot.name, inviter?.name);
    res.json({ ok: true });
  })
);

/* ----------------------------- Responses ----------------------------- */

// GET /pilots/:id/responses — every submitted entry with its answers, plus the
// submitter's company (via their app-level participant record).
pilotsRouter.get(
  "/:id/responses",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const submissions = await prisma.submission.findMany({
      where: { pilotId: req.params.id, submittedAt: { not: null } },
      orderBy: { submittedAt: "desc" },
      include: { user: { select: { id: true, name: true, email: true } }, answers: true },
    });

    // Map userId -> { name, company } using this pilot's memberships.
    const memberships = await prisma.membership.findMany({
      where: { pilotId: req.params.id, participant: { userId: { not: null } } },
      include: { participant: { include: { company: { select: { name: true } } } } },
    });
    const byUser = new Map(
      memberships.map((m) => [m.participant.userId!, m.participant])
    );

    res.json({
      responses: submissions.map((s) => {
        const p = byUser.get(s.user.id);
        return {
          id: s.id,
          user: s.user,
          company: p?.company.name ?? null,
          participantName: p?.name ?? s.user.name,
          submittedAt: s.submittedAt,
          answers: Object.fromEntries(s.answers.map((a) => [a.questionId, a.value])),
        };
      }),
    });
  })
);

// DELETE /pilots/:id/responses/:sid — the PM deletes a submitted response.
pilotsRouter.delete(
  "/:id/responses/:sid",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const submission = await prisma.submission.findUnique({ where: { id: req.params.sid } });
    if (!submission || submission.pilotId !== req.params.id) {
      throw new HttpError(404, "Response not found");
    }
    await prisma.submission.delete({ where: { id: submission.id } }); // cascades answers
    res.status(204).end();
  })
);

/* ------------------------------ Comments ------------------------------ */

// GET /pilots/:id/comments — all feedback comments on the pilot (PM view), each
// with its full triage state (status/priority/assignee/notes/duplicate/theme).
pilotsRouter.get(
  "/:id/comments",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const comments = await prisma.comment.findMany({
      where: { pilotId: req.params.id },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        features: true,
        images: true,
        notes: { orderBy: { createdAt: "asc" } },
        theme: { select: { id: true, name: true } },
        _count: { select: { duplicates: true } },
      },
    });

    // The app's themes, so the PM can fold a comment into an existing insight.
    const themes = await prisma.theme.findMany({
      where: { applicationId: pilot.applicationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    // Map author userId -> company name via this pilot's memberships.
    const memberships = await prisma.membership.findMany({
      where: { pilotId: req.params.id, participant: { userId: { not: null } } },
      include: { participant: { include: { company: { select: { name: true } } } } },
    });
    const companyByUser = new Map(
      memberships.map((m) => [m.participant.userId!, m.participant.company.name])
    );

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        category: c.category,
        createdAt: c.createdAt,
        author: { name: c.user.name, email: c.user.email },
        company: companyByUser.get(c.user.id) ?? null,
        features: c.features.map((f) => ({ id: f.id, name: f.name })),
        images: c.images.map((i) => ({ id: i.id, url: signUploadPath(i.url) })),
        status: c.status,
        priority: c.priority,
        assignee: c.assignee,
        duplicateOfId: c.duplicateOfId,
        duplicateCount: c._count.duplicates,
        theme: c.theme,
        notes: c.notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt })),
      })),
      statuses: COMMENT_STATUSES,
      priorities: COMMENT_PRIORITIES,
      themes,
    });
  })
);

const patchCommentSchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).nullable().optional(),
  assignee: z.string().max(120).nullable().optional(),
  duplicateOfId: z.string().nullable().optional(),
  themeId: z.string().nullable().optional(),
});

// PATCH /pilots/:id/comments/:cid — triage a comment.
pilotsRouter.patch(
  "/:id/comments/:cid",
  asyncHandler(async (req, res) => {
    const pilot = await getOwnedPilot(req.params.id, req.user!.sub);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id) {
      throw new HttpError(404, "Comment not found");
    }
    const data = patchCommentSchema.parse(req.body);

    // Validate a duplicate link: must point to another comment in the same pilot.
    let statusFromDuplicate: CommentStatus | undefined;
    if (data.duplicateOfId !== undefined && data.duplicateOfId !== null) {
      if (data.duplicateOfId === comment.id) {
        throw new HttpError(400, "A comment can't be a duplicate of itself");
      }
      const canonical = await prisma.comment.findUnique({ where: { id: data.duplicateOfId } });
      if (!canonical || canonical.pilotId !== pilot.id) {
        throw new HttpError(400, "Can only mark as a duplicate of another comment in this pilot");
      }
      statusFromDuplicate = CommentStatus.DUPLICATE; // marking a duplicate sets the status
    }

    // Validate a theme link: must belong to this pilot's application.
    if (data.themeId !== undefined && data.themeId !== null) {
      const theme = await prisma.theme.findUnique({ where: { id: data.themeId } });
      if (!theme || theme.applicationId !== pilot.applicationId) {
        throw new HttpError(400, "That theme doesn't belong to this application");
      }
    }

    const updated = await prisma.comment.update({
      where: { id: comment.id },
      data: {
        ...(data.status !== undefined ? { status: data.status as CommentStatus } : {}),
        ...(statusFromDuplicate && data.status === undefined ? { status: statusFromDuplicate } : {}),
        ...(data.priority !== undefined
          ? { priority: (data.priority as CommentPriority) ?? null }
          : {}),
        ...(data.assignee !== undefined ? { assignee: data.assignee || null } : {}),
        ...(data.duplicateOfId !== undefined ? { duplicateOfId: data.duplicateOfId } : {}),
        ...(data.themeId !== undefined ? { themeId: data.themeId } : {}),
      },
      include: { theme: { select: { id: true, name: true } }, _count: { select: { duplicates: true } } },
    });

    res.json({
      comment: {
        id: updated.id,
        status: updated.status,
        priority: updated.priority,
        assignee: updated.assignee,
        duplicateOfId: updated.duplicateOfId,
        duplicateCount: updated._count.duplicates,
        theme: updated.theme,
      },
    });
  })
);

// POST /pilots/:id/comments/:cid/notes — add a private PM note.
const noteSchema = z.object({ body: z.string().min(1, "Note can't be empty") });
pilotsRouter.post(
  "/:id/comments/:cid/notes",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id) {
      throw new HttpError(404, "Comment not found");
    }
    const { body } = noteSchema.parse(req.body);
    const note = await prisma.commentNote.create({
      data: { commentId: comment.id, body },
    });
    res.status(201).json({ note: { id: note.id, body: note.body, createdAt: note.createdAt } });
  })
);

// DELETE /pilots/:id/comments/:cid/notes/:nid — remove a private note.
pilotsRouter.delete(
  "/:id/comments/:cid/notes/:nid",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const note = await prisma.commentNote.findUnique({ where: { id: req.params.nid } });
    if (!note || note.commentId !== req.params.cid) {
      throw new HttpError(404, "Note not found");
    }
    await prisma.commentNote.delete({ where: { id: note.id } });
    res.status(204).end();
  })
);

/* ------------------------------ Analytics ----------------------------- */

// GET /pilots/:id/analytics — full analytics for one pilot: comment breakdowns,
// per-company engagement, and structured-answer rollups.
pilotsRouter.get(
  "/:id/analytics",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const pilotId = req.params.id;

    const comments = await prisma.comment.findMany({
      where: { pilotId },
      select: {
        category: true,
        createdAt: true,
        userId: true,
        status: true,
        features: { select: { id: true, name: true } },
      },
    });
    const memberships = await prisma.membership.findMany({
      where: { pilotId },
      include: { participant: { include: { company: { select: { name: true } } } } },
    });
    const questions = await prisma.question.findMany({
      where: { pilotId },
      orderBy: { order: "asc" },
    });
    const submissions = await prisma.submission.findMany({
      where: { pilotId, submittedAt: { not: null } },
      include: { answers: true },
    });

    const comAnalyticsInput = comments.map((c) => ({
      category: c.category,
      createdAt: c.createdAt,
      userId: c.userId,
      features: c.features,
    }));
    const analytics = commentAnalytics(comAnalyticsInput);
    const open = comments.filter((c) => OPEN_STATUSES.includes(c.status)).length;

    // Company engagement: invited people, who's active, and their comment tone.
    const companyByUser = new Map<string, string>();
    const invited = new Map<string, number>();
    for (const m of memberships) {
      const name = m.participant.company.name;
      invited.set(name, (invited.get(name) ?? 0) + 1);
      if (m.participant.userId) companyByUser.set(m.participant.userId, name);
    }
    const activeByCompany = new Map<string, Set<string>>();
    const markActive = (userId: string) => {
      const co = companyByUser.get(userId);
      if (!co) return;
      const set = activeByCompany.get(co) ?? new Set<string>();
      set.add(userId);
      activeByCompany.set(co, set);
    };
    for (const s of submissions) markActive(s.userId);
    const comStats = new Map<string, { comments: number; positive: number; negative: number }>();
    for (const c of comments) {
      const co = companyByUser.get(c.userId);
      if (!co) continue;
      markActive(c.userId);
      const st = comStats.get(co) ?? { comments: 0, positive: 0, negative: 0 };
      st.comments++;
      const s = sentimentScore(c.category);
      if (s > 0) st.positive++;
      else if (s < 0) st.negative++;
      comStats.set(co, st);
    }
    const byCompany = [...invited.entries()]
      .map(([company, people]) => {
        const active = activeByCompany.get(company)?.size ?? 0;
        const st = comStats.get(company) ?? { comments: 0, positive: 0, negative: 0 };
        return {
          company,
          participants: people,
          active,
          participationRate: people ? active / people : 0,
          comments: st.comments,
          positive: st.positive,
          negative: st.negative,
        };
      })
      .sort((a, b) => b.comments - a.comments || b.active - a.active);

    const subInput = submissions.map((s) => ({
      submittedAt: s.submittedAt!,
      answers: Object.fromEntries(s.answers.map((a) => [a.questionId, a.value])),
    }));
    const questionsRollup = questionRollups(
      questions.map((q) => ({ id: q.id, label: q.label, type: q.type, options: q.options })),
      subInput
    );

    res.json({
      scope: "pilot",
      totals: {
        comments: comments.length,
        open,
        participants: memberships.length,
        responses: submissions.length,
      },
      ...analytics,
      byCompany,
      questions: questionsRollup,
    });
  })
);

// DELETE /pilots/:id/comments/:cid — the PM removes a comment.
pilotsRouter.delete(
  "/:id/comments/:cid",
  asyncHandler(async (req, res) => {
    await getOwnedPilot(req.params.id, req.user!.sub);
    const comment = await prisma.comment.findUnique({ where: { id: req.params.cid } });
    if (!comment || comment.pilotId !== req.params.id) {
      throw new HttpError(404, "Comment not found");
    }
    await prisma.comment.delete({ where: { id: comment.id } }); // cascades images
    res.status(204).end();
  })
);
