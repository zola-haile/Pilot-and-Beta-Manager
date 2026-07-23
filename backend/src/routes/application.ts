import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate, requireRole } from "../middleware/auth";
import { pilotStatus } from "../lib/pilotStatus";
import { config } from "../config";
import { sendEmail, adminSetupEmail, adminReminderEmail } from "../lib/email";
import {
  COMMENT_STATUSES,
  COMMENT_PRIORITIES,
  STATUS_VALUES,
  PRIORITY_VALUES,
  serializeReply,
} from "../lib/comments";
import { CommentStatus, CommentPriority } from "@prisma/client";
import { commentAnalytics, sentimentScore, weekStart } from "../lib/analytics";
import { signUploadPath } from "../lib/uploads";
import { buildPilotExport } from "../lib/export";
import { Actor, canManage, ownedByWhere } from "../lib/authz";

const OPEN_STATUSES = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS"];

// PM-facing routes for applications, and the companies/pilots scoped under them.
// Mounted at "/", so the PM guard is applied per-route (not router-wide).
export const applicationRouter = Router();
const pm = [authenticate, requireRole("PM")];

/** Loads an application the actor may manage (owns it, or oversees its org). */
export async function getOwnedApplication(appId: string, actor: Actor) {
  const app = await prisma.application.findUnique({
    where: { id: appId },
    include: { owner: { select: { organizationId: true } } },
  });
  if (!app || !canManage(actor, app.ownerId, app.owner.organizationId)) {
    throw new HttpError(404, "Application not found");
  }
  return app;
}

/** Loads a company the actor may manage (owns it, or oversees its org). */
async function getOwnedCompany(companyId: string, actor: Actor) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { owner: { select: { organizationId: true } } },
  });
  if (!company || !canManage(actor, company.ownerId, company.owner.organizationId)) {
    throw new HttpError(404, "Company not found");
  }
  return company;
}

/** Deletes submissions by the given users across all of a PM's pilots. */
async function deletePmSubmissionsForUsers(ownerId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const pilots = await prisma.pilot.findMany({
    where: { application: { ownerId } },
    select: { id: true },
  });
  await prisma.submission.deleteMany({
    where: { userId: { in: userIds }, pilotId: { in: pilots.map((p) => p.id) } },
  });
}

/* ---------------------------- Applications ---------------------------- */

// GET /applications — the PM's applications with pilot/company counts.
applicationRouter.get(
  "/applications",
  pm,
  asyncHandler(async (req, res) => {
    const apps = await prisma.application.findMany({
      where: ownedByWhere(req.user!),
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { pilots: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({
      applications: apps.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        createdAt: a.createdAt,
        counts: { pilots: a._count.pilots },
        // Who runs this project — surfaced so org overseers can tell projects
        // apart. `mine` lets the UI hide the label for the viewer's own work.
        owner: { id: a.owner.id, name: a.owner.name, email: a.owner.email },
        mine: a.ownerId === req.user!.sub,
      })),
    });
  })
);

const upsertAppSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
});

// POST /applications — create an application.
applicationRouter.post(
  "/applications",
  pm,
  asyncHandler(async (req, res) => {
    const data = upsertAppSchema.parse(req.body);
    const app = await prisma.application.create({
      data: { name: data.name, description: data.description ?? null, ownerId: req.user!.sub },
    });
    res.status(201).json({
      application: { id: app.id, name: app.name, description: app.description, counts: { pilots: 0 } },
    });
  })
);

// GET /applications/:appId — one application.
applicationRouter.get(
  "/applications/:appId",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    res.json({ application: { id: app.id, name: app.name, description: app.description } });
  })
);

// GET /applications/:appId/export — every pilot in the project, fully exported.
applicationRouter.get(
  "/applications/:appId/export",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const pilots = await prisma.pilot.findMany({
      where: { applicationId: app.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const exports = [];
    for (const p of pilots) exports.push(await buildPilotExport(p.id));
    res.json({
      exportedAt: new Date().toISOString(),
      project: { id: app.id, name: app.name },
      pilots: exports,
    });
  })
);

// PATCH /applications/:appId — rename / describe.
applicationRouter.patch(
  "/applications/:appId",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const data = upsertAppSchema.partial().parse(req.body);
    const updated = await prisma.application.update({
      where: { id: app.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });
    res.json({ application: { id: updated.id, name: updated.name, description: updated.description } });
  })
);

// DELETE /applications/:appId — remove an application and everything under it.
applicationRouter.delete(
  "/applications/:appId",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    await prisma.application.delete({ where: { id: app.id } }); // cascades pilots, companies, etc.
    res.status(204).end();
  })
);

/* ------------------- Companies (top-level, PM-owned) ------------------ */

// GET /companies — all of the PM's companies.
applicationRouter.get(
  "/companies",
  pm,
  asyncHandler(async (req, res) => {
    const companies = await prisma.company.findMany({
      where: ownedByWhere(req.user!),
      orderBy: { name: "asc" },
      include: {
        _count: { select: { participants: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        adminEmail: c.adminEmail,
        adminJoined: c.adminUserId !== null,
        participantCount: c._count.participants,
        owner: { id: c.owner.id, name: c.owner.name, email: c.owner.email },
        mine: c.ownerId === req.user!.sub,
      })),
    });
  })
);

const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  adminEmail: z.string().email("A valid admin email is required"),
});

// POST /companies — add a company (with its admin email).
applicationRouter.post(
  "/companies",
  pm,
  asyncHandler(async (req, res) => {
    const { name, adminEmail } = createCompanySchema.parse(req.body);
    const company = await prisma.company.create({
      data: { ownerId: req.user!.sub, name, adminEmail },
    });
    res.status(201).json({
      company: {
        id: company.id,
        name: company.name,
        adminEmail: company.adminEmail,
        adminJoined: false,
        participantCount: 0,
      },
    });
  })
);

const patchCompanySchema = z.object({
  name: z.string().min(1).optional(),
  adminEmail: z.string().email().optional(),
});

// PATCH /companies/:id — rename / change admin email.
applicationRouter.patch(
  "/companies/:id",
  pm,
  asyncHandler(async (req, res) => {
    const company = await getOwnedCompany(req.params.id, req.user!);
    const data = patchCompanySchema.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.adminEmail !== undefined ? { adminEmail: data.adminEmail } : {}),
      },
    });
    res.json({ company: { id: updated.id, name: updated.name, adminEmail: updated.adminEmail } });
  })
);

// DELETE /companies/:id — remove a company, its people, memberships and responses.
applicationRouter.delete(
  "/companies/:id",
  pm,
  asyncHandler(async (req, res) => {
    const company = await getOwnedCompany(req.params.id, req.user!);
    const participants = await prisma.participant.findMany({
      where: { companyId: company.id },
      select: { userId: true },
    });
    const userIds = participants.map((p) => p.userId).filter(Boolean) as string[];
    await deletePmSubmissionsForUsers(company.ownerId, userIds);
    await prisma.company.delete({ where: { id: company.id } }); // cascades participants + memberships
    res.status(204).end();
  })
);

// POST /companies/:id/invite-admin — email the company's admin their setup link
// (or a reminder if they've already set up their account).
applicationRouter.post(
  "/companies/:id/invite-admin",
  pm,
  asyncHandler(async (req, res) => {
    const company = await getOwnedCompany(req.params.id, req.user!);
    const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const base = config.appUrl.replace(/\/$/, "");
    if (company.adminUserId) {
      await sendEmail(
        adminReminderEmail({
          to: company.adminEmail,
          companyName: company.name,
          manageUrl: `${base}/admin`,
          inviterName: inviter?.name,
        })
      );
    } else {
      await sendEmail(
        adminSetupEmail({
          to: company.adminEmail,
          companyName: company.name,
          setupUrl: `${base}/admin/accept/${company.adminInviteToken}`,
          inviterName: inviter?.name,
        })
      );
    }
    res.json({ ok: true, alreadyActive: company.adminUserId !== null });
  })
);

// DELETE /participants/:id — remove one app-level person (memberships + responses).
applicationRouter.delete(
  "/participants/:id",
  pm,
  asyncHandler(async (req, res) => {
    const participant = await prisma.participant.findUnique({
      where: { id: req.params.id },
      include: { company: { include: { owner: { select: { organizationId: true } } } } },
    });
    if (
      !participant ||
      !canManage(req.user!, participant.company.ownerId, participant.company.owner.organizationId)
    ) {
      throw new HttpError(404, "Person not found");
    }
    if (participant.userId) {
      await deletePmSubmissionsForUsers(participant.company.ownerId, [participant.userId]);
    }
    await prisma.participant.delete({ where: { id: participant.id } }); // cascades memberships
    res.status(204).end();
  })
);

// GET /companies/:id — app-wide drill-down within the company's application.
applicationRouter.get(
  "/companies/:id",
  pm,
  asyncHandler(async (req, res) => {
    const company = await getOwnedCompany(req.params.id, req.user!);
    const full = await prisma.company.findUnique({
      where: { id: company.id },
      include: {
        participants: {
          orderBy: { createdAt: "asc" },
          include: {
            memberships: {
              include: {
                pilot: {
                  select: {
                    id: true,
                    name: true,
                    startDate: true,
                    endDate: true,
                    application: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!full) throw new HttpError(404, "Company not found");

    const userIds = full.participants.map((p) => p.userId).filter(Boolean) as string[];
    const grouped = userIds.length
      ? await prisma.submission.groupBy({
          by: ["pilotId", "userId"],
          where: { userId: { in: userIds }, submittedAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const entryCount = new Map(grouped.map((g) => [`${g.pilotId}:${g.userId}`, g._count._all]));

    res.json({
      company: {
        id: full.id,
        name: full.name,
        adminEmail: full.adminEmail,
        adminJoined: full.adminUserId !== null,
      },
      participants: full.participants.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        joined: p.userId !== null,
        pilots: p.memberships.map((m) => ({
          pilotId: m.pilot.id,
          pilotName: m.pilot.name,
          appName: m.pilot.application.name, // companies span apps now
          status: pilotStatus(m.pilot.startDate, m.pilot.endDate),
          membershipStatus: m.status,
          entryCount: p.userId ? entryCount.get(`${m.pilot.id}:${p.userId}`) ?? 0 : 0,
        })),
      })),
    });
  })
);

/* ------------------------ Pilots (scoped to app) ---------------------- */

// GET /applications/:appId/pilots — the application's pilots with counts.
applicationRouter.get(
  "/applications/:appId/pilots",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const pilots = await prisma.pilot.findMany({
      where: { applicationId: app.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { questions: true, memberships: true } } },
    });
    const grouped = await prisma.submission.groupBy({
      by: ["pilotId"],
      where: { pilotId: { in: pilots.map((p) => p.id) }, submittedAt: { not: null } },
      _count: { _all: true },
    });
    const responseCount = new Map(grouped.map((g) => [g.pilotId, g._count._all]));

    res.json({
      pilots: pilots.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        startDate: p.startDate,
        endDate: p.endDate,
        createdAt: p.createdAt,
        status: pilotStatus(p.startDate, p.endDate),
        counts: {
          questions: p._count.questions,
          participants: p._count.memberships,
          submissions: responseCount.get(p.id) ?? 0,
        },
      })),
    });
  })
);

const createPilotSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  // Feature scope: test all features (default), or an explicit subset.
  allFeatures: z.boolean().optional().default(true),
  featureIds: z.array(z.string()).optional().default([]),
  // Whether the pilot collects a participant survey (default on).
  surveyEnabled: z.boolean().optional().default(true),
});

// POST /applications/:appId/pilots — create a pilot in the application.
applicationRouter.post(
  "/applications/:appId/pilots",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const data = createPilotSchema.parse(req.body);

    // When a subset is chosen, keep only features that belong to this app.
    let validFeatureIds: string[] = [];
    if (!data.allFeatures && data.featureIds.length > 0) {
      const feats = await prisma.feature.findMany({
        where: { id: { in: data.featureIds }, applicationId: app.id },
        select: { id: true },
      });
      validFeatureIds = feats.map((f) => f.id);
    }

    const pilot = await prisma.pilot.create({
      data: {
        applicationId: app.id,
        name: data.name,
        description: data.description ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        allFeatures: data.allFeatures,
        surveyEnabled: data.surveyEnabled,
        ...(data.allFeatures
          ? {}
          : { pilotFeatures: { create: validFeatureIds.map((featureId) => ({ featureId })) } }),
      },
    });
    res.status(201).json({ pilot: { ...pilot, status: pilotStatus(pilot.startDate, pilot.endDate) } });
  })
);

/* ------------------ Features (app-level, PM-managed) ------------------ */

/** Loads a feature whose application the actor may manage, or throws. */
async function getOwnedFeature(featureId: string, actor: Actor) {
  const feature = await prisma.feature.findUnique({
    where: { id: featureId },
    include: { application: { include: { owner: { select: { organizationId: true } } } } },
  });
  if (!feature || !canManage(actor, feature.application.ownerId, feature.application.owner.organizationId)) {
    throw new HttpError(404, "Feature not found");
  }
  return feature;
}

// GET /applications/:appId/features — the application's features.
applicationRouter.get(
  "/applications/:appId/features",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const features = await prisma.feature.findMany({
      where: { applicationId: app.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { comments: true } } },
    });
    res.json({
      features: features.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        commentCount: f._count.comments,
      })),
    });
  })
);

const featureSchema = z.object({
  name: z.string().min(1, "Feature name is required"),
  description: z.string().optional().nullable(),
});

// POST /applications/:appId/features — add a feature.
applicationRouter.post(
  "/applications/:appId/features",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const { name, description } = featureSchema.parse(req.body);
    const feature = await prisma.feature.create({
      data: { applicationId: app.id, name, description: description ?? null },
    });
    res.status(201).json({
      feature: { id: feature.id, name: feature.name, description: feature.description, commentCount: 0 },
    });
  })
);

// PATCH /features/:id — edit a feature.
applicationRouter.patch(
  "/features/:id",
  pm,
  asyncHandler(async (req, res) => {
    await getOwnedFeature(req.params.id, req.user!);
    const data = featureSchema.partial().parse(req.body);
    const feature = await prisma.feature.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });
    res.json({ feature: { id: feature.id, name: feature.name, description: feature.description } });
  })
);

// DELETE /features/:id — remove a feature (unlinks it from any comments).
applicationRouter.delete(
  "/features/:id",
  pm,
  asyncHandler(async (req, res) => {
    await getOwnedFeature(req.params.id, req.user!);
    await prisma.feature.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

/* ------------------ Themes (app-level feedback insights) -------------- */

/** Loads a theme whose application the actor may manage, or throws. */
async function getOwnedTheme(themeId: string, actor: Actor) {
  const theme = await prisma.theme.findUnique({
    where: { id: themeId },
    include: { application: { include: { owner: { select: { organizationId: true } } } } },
  });
  if (!theme || !canManage(actor, theme.application.ownerId, theme.application.owner.organizationId)) {
    throw new HttpError(404, "Theme not found");
  }
  return theme;
}

// GET /applications/:appId/themes — the application's insight themes, with the
// number of comments folded into each.
applicationRouter.get(
  "/applications/:appId/themes",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const themes = await prisma.theme.findMany({
      where: { applicationId: app.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { comments: true } } },
    });
    res.json({
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        commentCount: t._count.comments,
      })),
    });
  })
);

const themeSchema = z.object({
  name: z.string().min(1, "Theme name is required"),
  description: z.string().optional().nullable(),
});

// POST /applications/:appId/themes — create an insight theme.
applicationRouter.post(
  "/applications/:appId/themes",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const { name, description } = themeSchema.parse(req.body);
    const theme = await prisma.theme.create({
      data: { applicationId: app.id, name, description: description ?? null },
    });
    res.status(201).json({
      theme: { id: theme.id, name: theme.name, description: theme.description, commentCount: 0 },
    });
  })
);

// PATCH /themes/:id — rename / describe a theme.
applicationRouter.patch(
  "/themes/:id",
  pm,
  asyncHandler(async (req, res) => {
    await getOwnedTheme(req.params.id, req.user!);
    const data = themeSchema.partial().parse(req.body);
    const theme = await prisma.theme.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
    });
    res.json({ theme: { id: theme.id, name: theme.name, description: theme.description } });
  })
);

// DELETE /themes/:id — remove a theme (comments keep their data, just unlinked).
applicationRouter.delete(
  "/themes/:id",
  pm,
  asyncHandler(async (req, res) => {
    await getOwnedTheme(req.params.id, req.user!);
    await prisma.theme.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

/* -------------- Feedback workspace (comments across an app) ------------ */

// GET /applications/:appId/comments — every comment across all of the app's
// pilots, each with full triage state + its pilot + the author's company. Feeds
// the cross-pilot Feedback board/inbox.
applicationRouter.get(
  "/applications/:appId/comments",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);

    const comments = await prisma.comment.findMany({
      where: { pilot: { applicationId: app.id } },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        pilot: { select: { id: true, name: true, application: { select: { ownerId: true } } } },
        features: true,
        images: true,
        notes: { orderBy: { createdAt: "asc" } },
        replies: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true } } } },
        theme: { select: { id: true, name: true } },
        _count: { select: { duplicates: true } },
      },
    });

    // Map (pilotId,userId) -> company name via memberships in this app's pilots.
    const memberships = await prisma.membership.findMany({
      where: { pilot: { applicationId: app.id }, participant: { userId: { not: null } } },
      include: { participant: { include: { company: { select: { name: true } } } } },
    });
    const companyByPilotUser = new Map(
      memberships.map((m) => [`${m.pilotId}:${m.participant.userId}`, m.participant.company.name])
    );

    const themes = await prisma.theme.findMany({
      where: { applicationId: app.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    res.json({
      comments: comments.map((c) => ({
        id: c.id,
        subject: c.subject,
        body: c.body,
        category: c.category,
        createdAt: c.createdAt,
        anonymous: c.anonymous,
        author: c.anonymous ? { name: null, email: null } : { name: c.user.name, email: c.user.email },
        company: c.anonymous ? null : companyByPilotUser.get(`${c.pilotId}:${c.user.id}`) ?? null,
        pilot: { id: c.pilot.id, name: c.pilot.name },
        features: c.features.map((f) => ({ id: f.id, name: f.name })),
        images: c.images.map((i) => ({ id: i.id, url: signUploadPath(i.url), name: i.name, mime: i.mime })),
        status: c.status,
        priority: c.priority,
        assignee: c.assignee,
        duplicateOfId: c.duplicateOfId,
        duplicateCount: c._count.duplicates,
        theme: c.theme,
        notes: c.notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt })),
        replies: c.replies.map((r) => serializeReply(r, req.user!.sub, c.pilot.application.ownerId)),
      })),
      statuses: COMMENT_STATUSES,
      priorities: COMMENT_PRIORITIES,
      themes,
    });
  })
);

// GET /applications/:appId/analytics — analytics across every pilot in the app:
// comment breakdowns, company engagement, and a ratings roll-up.
applicationRouter.get(
  "/applications/:appId/analytics",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);

    const comments = await prisma.comment.findMany({
      where: { pilot: { applicationId: app.id } },
      select: {
        category: true,
        createdAt: true,
        userId: true,
        status: true,
        features: { select: { id: true, name: true } },
      },
    });
    const memberships = await prisma.membership.findMany({
      where: { pilot: { applicationId: app.id } },
      include: { participant: { select: { id: true, userId: true, company: { select: { name: true } } } } },
    });
    const submissions = await prisma.submission.findMany({
      where: { pilot: { applicationId: app.id }, submittedAt: { not: null } },
      include: {
        answers: { include: { question: { select: { type: true } } } },
        pilot: { select: { id: true, name: true } },
      },
    });

    const analytics = commentAnalytics(
      comments.map((c) => ({
        category: c.category,
        createdAt: c.createdAt,
        userId: c.userId,
        features: c.features,
      }))
    );
    const open = comments.filter((c) => OPEN_STATUSES.includes(c.status)).length;

    // Company engagement across the whole app (distinct people per company).
    const companyByUser = new Map<string, string>();
    const invited = new Map<string, Set<string>>();
    for (const m of memberships) {
      const name = m.participant.company.name;
      const set = invited.get(name) ?? new Set<string>();
      set.add(m.participant.id);
      invited.set(name, set);
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
          participants: people.size,
          active,
          participationRate: people.size ? active / people.size : 0,
          comments: st.comments,
          positive: st.positive,
          negative: st.negative,
        };
      })
      .sort((a, b) => b.comments - a.comments || b.active - a.active);

    // Ratings roll-up: every RATING answer across the app.
    let ratingSum = 0;
    let ratingCount = 0;
    const ratingWeek = new Map<string, { sum: number; count: number }>();
    const ratingPilot = new Map<string, { name: string; sum: number; count: number }>();
    for (const s of submissions) {
      for (const a of s.answers) {
        if (a.question.type !== "RATING" || a.value == null) continue;
        const n = Number(a.value);
        if (Number.isNaN(n)) continue;
        ratingSum += n;
        ratingCount++;
        const wk = weekStart(s.submittedAt!);
        const w = ratingWeek.get(wk) ?? { sum: 0, count: 0 };
        w.sum += n;
        w.count++;
        ratingWeek.set(wk, w);
        const p = ratingPilot.get(s.pilot.id) ?? { name: s.pilot.name, sum: 0, count: 0 };
        p.sum += n;
        p.count++;
        ratingPilot.set(s.pilot.id, p);
      }
    }
    const ratings = {
      average: ratingCount ? ratingSum / ratingCount : null,
      count: ratingCount,
      overTime: [...ratingWeek.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([week, v]) => ({ week, avg: v.sum / v.count })),
      byPilot: [...ratingPilot.values()]
        .map((p) => ({ pilot: p.name, avg: p.sum / p.count, count: p.count }))
        .sort((a, b) => b.avg - a.avg),
    };

    res.json({
      scope: "app",
      totals: {
        comments: comments.length,
        open,
        participants: new Set(memberships.map((m) => m.participant.id)).size,
        responses: submissions.length,
        pilots: new Set(submissions.map((s) => s.pilot.id)).size,
      },
      ...analytics,
      byCompany,
      ratings,
    });
  })
);

const bulkSchema = z.object({
  commentIds: z.array(z.string()).min(1, "Select at least one comment"),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).nullable().optional(),
  assignee: z.string().max(120).nullable().optional(),
  themeId: z.string().nullable().optional(),
  duplicateOfId: z.string().nullable().optional(),
});

// PATCH /applications/:appId/comments/bulk — apply one triage change to many
// comments at once (status / priority / assignee / theme / merge-as-duplicate).
applicationRouter.patch(
  "/applications/:appId/comments/bulk",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!);
    const data = bulkSchema.parse(req.body);

    // Every target must be a comment in one of this app's pilots.
    const targets = await prisma.comment.findMany({
      where: { id: { in: data.commentIds }, pilot: { applicationId: app.id } },
      select: { id: true, pilotId: true },
    });
    if (targets.length !== data.commentIds.length) {
      throw new HttpError(404, "Some comments weren't found in this application");
    }

    // Validate a theme link.
    if (data.themeId !== undefined && data.themeId !== null) {
      const theme = await prisma.theme.findUnique({ where: { id: data.themeId } });
      if (!theme || theme.applicationId !== app.id) {
        throw new HttpError(400, "That theme doesn't belong to this application");
      }
    }

    // Validate a merge: the canonical must live in the same pilot as every target.
    let statusFromDuplicate: CommentStatus | undefined;
    if (data.duplicateOfId !== undefined && data.duplicateOfId !== null) {
      if (data.commentIds.includes(data.duplicateOfId)) {
        throw new HttpError(400, "Can't merge comments into one that's also selected");
      }
      const canonical = await prisma.comment.findUnique({ where: { id: data.duplicateOfId } });
      if (!canonical) {
        throw new HttpError(400, "Canonical comment not found");
      }
      const samePilot = targets.every((t) => t.pilotId === canonical.pilotId);
      const canonicalInApp = await prisma.pilot.findFirst({
        where: { id: canonical.pilotId, applicationId: app.id },
        select: { id: true },
      });
      if (!canonicalInApp || !samePilot) {
        throw new HttpError(400, "Can only merge comments within the same pilot");
      }
      statusFromDuplicate = CommentStatus.DUPLICATE;
    }

    const result = await prisma.comment.updateMany({
      where: { id: { in: data.commentIds } },
      data: {
        ...(data.status !== undefined ? { status: data.status as CommentStatus } : {}),
        ...(statusFromDuplicate && data.status === undefined ? { status: statusFromDuplicate } : {}),
        ...(data.priority !== undefined
          ? { priority: (data.priority as CommentPriority) ?? null }
          : {}),
        ...(data.assignee !== undefined ? { assignee: data.assignee || null } : {}),
        ...(data.themeId !== undefined ? { themeId: data.themeId } : {}),
        ...(data.duplicateOfId !== undefined ? { duplicateOfId: data.duplicateOfId } : {}),
      },
    });

    res.json({ updated: result.count });
  })
);
