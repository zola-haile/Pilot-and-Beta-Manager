import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate, requireRole } from "../middleware/auth";
import { pilotStatus } from "../lib/pilotStatus";
import { config } from "../config";
import { sendEmail, adminSetupEmail, adminReminderEmail } from "../lib/email";

// PM-facing routes for applications, and the companies/pilots scoped under them.
// Mounted at "/", so the PM guard is applied per-route (not router-wide).
export const applicationRouter = Router();
const pm = [authenticate, requireRole("PM")];

/** Loads an application owned by the current user, or throws 404. */
export async function getOwnedApplication(appId: string, ownerId: string) {
  const app = await prisma.application.findUnique({ where: { id: appId } });
  if (!app || app.ownerId !== ownerId) throw new HttpError(404, "Application not found");
  return app;
}

/** Loads a company owned by the current user, or throws 404. */
async function getOwnedCompany(companyId: string, ownerId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.ownerId !== ownerId) {
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
      where: { ownerId: req.user!.sub },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { pilots: true } } },
    });
    res.json({
      applications: apps.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        createdAt: a.createdAt,
        counts: { pilots: a._count.pilots },
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
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
    res.json({ application: { id: app.id, name: app.name, description: app.description } });
  })
);

// PATCH /applications/:appId — rename / describe.
applicationRouter.patch(
  "/applications/:appId",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
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
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
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
      where: { ownerId: req.user!.sub },
      orderBy: { name: "asc" },
      include: { _count: { select: { participants: true } } },
    });
    res.json({
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        adminEmail: c.adminEmail,
        adminJoined: c.adminUserId !== null,
        participantCount: c._count.participants,
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
    const company = await getOwnedCompany(req.params.id, req.user!.sub);
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
    const company = await getOwnedCompany(req.params.id, req.user!.sub);
    const participants = await prisma.participant.findMany({
      where: { companyId: company.id },
      select: { userId: true },
    });
    const userIds = participants.map((p) => p.userId).filter(Boolean) as string[];
    await deletePmSubmissionsForUsers(req.user!.sub, userIds);
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
    const company = await getOwnedCompany(req.params.id, req.user!.sub);
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
      include: { company: true },
    });
    if (!participant || participant.company.ownerId !== req.user!.sub) {
      throw new HttpError(404, "Person not found");
    }
    if (participant.userId) {
      await deletePmSubmissionsForUsers(req.user!.sub, [participant.userId]);
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
    const company = await getOwnedCompany(req.params.id, req.user!.sub);
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
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
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
});

// POST /applications/:appId/pilots — create a pilot in the application.
applicationRouter.post(
  "/applications/:appId/pilots",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
    const data = createPilotSchema.parse(req.body);
    const pilot = await prisma.pilot.create({
      data: {
        applicationId: app.id,
        name: data.name,
        description: data.description ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    });
    res.status(201).json({ pilot: { ...pilot, status: pilotStatus(pilot.startDate, pilot.endDate) } });
  })
);

/* ------------------ Features (app-level, PM-managed) ------------------ */

/** Loads a feature whose application is owned by the current user, or throws. */
async function getOwnedFeature(featureId: string, ownerId: string) {
  const feature = await prisma.feature.findUnique({
    where: { id: featureId },
    include: { application: true },
  });
  if (!feature || feature.application.ownerId !== ownerId) {
    throw new HttpError(404, "Feature not found");
  }
  return feature;
}

// GET /applications/:appId/features — the application's features.
applicationRouter.get(
  "/applications/:appId/features",
  pm,
  asyncHandler(async (req, res) => {
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
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
    const app = await getOwnedApplication(req.params.appId, req.user!.sub);
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
    await getOwnedFeature(req.params.id, req.user!.sub);
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
    await getOwnedFeature(req.params.id, req.user!.sub);
    await prisma.feature.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
