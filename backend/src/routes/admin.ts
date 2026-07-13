import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate } from "../middleware/auth";
import { pilotStatus } from "../lib/pilotStatus";
import { config } from "../config";
import { sendEmail, inviteEmail } from "../lib/email";

// Company-admin area. Any authenticated user may call these, but each route
// verifies the user administers the relevant company.
export const adminRouter = Router();
adminRouter.use(authenticate);

const appBase = () => config.appUrl.replace(/\/$/, "");
const inviteUrl = (t: string) => `${appBase()}/invite/${t}`;
const shareUrl = (t: string) => `${appBase()}/join/${t}`;

/** Loads a PilotCompany the current user administers, or throws. */
async function getAdminParticipation(pcId: string, userId: string) {
  const pc = await prisma.pilotCompany.findUnique({
    where: { id: pcId },
    include: { company: true, pilot: true },
  });
  if (!pc) throw new HttpError(404, "Not found");
  if (pc.company.adminUserId !== userId) {
    throw new HttpError(403, "You do not administer this company");
  }
  return pc;
}

// GET /admin/participations — every (company, pilot) this user administers.
adminRouter.get(
  "/participations",
  asyncHandler(async (req, res) => {
    const companies = await prisma.company.findMany({
      where: { adminUserId: req.user!.sub },
      include: {
        pilotCompanies: { include: { pilot: true } },
      },
    });

    const participations = companies.flatMap((c) =>
      c.pilotCompanies.map((pc) => ({
        id: pc.id,
        company: { id: c.id, name: c.name },
        pilot: {
          id: pc.pilot.id,
          name: pc.pilot.name,
          description: pc.pilot.description,
          status: pilotStatus(pc.pilot.startDate, pc.pilot.endDate),
        },
        shareUrl: shareUrl(pc.shareToken),
      }))
    );

    // Participant counts for this company in each pilot.
    const results = await Promise.all(
      participations.map(async (p) => {
        const count = await prisma.membership.count({
          where: { pilotId: p.pilot.id, participant: { companyId: p.company.id } },
        });
        return { ...p, participantCount: count };
      })
    );

    res.json({ participations: results });
  })
);

// GET /admin/participations/:pcId — the company's people in this pilot.
adminRouter.get(
  "/participations/:pcId",
  asyncHandler(async (req, res) => {
    const pc = await getAdminParticipation(req.params.pcId, req.user!.sub);

    const memberships = await prisma.membership.findMany({
      where: { pilotId: pc.pilotId, participant: { companyId: pc.companyId } },
      orderBy: { invitedAt: "asc" },
      include: { participant: true },
    });

    // Finalized entry counts per participant user in this pilot.
    const userIds = memberships.map((m) => m.participant.userId).filter(Boolean) as string[];
    const grouped = userIds.length
      ? await prisma.submission.groupBy({
          by: ["userId"],
          where: { pilotId: pc.pilotId, userId: { in: userIds }, submittedAt: { not: null } },
          _count: { _all: true },
        })
      : [];
    const entryCount = new Map(grouped.map((g) => [g.userId, g._count._all]));

    // Is the admin themselves enrolled as a participant in this pilot?
    const selfEnrolled = memberships.some((m) => m.participant.userId === req.user!.sub);

    res.json({
      participation: {
        id: pc.id,
        company: { id: pc.company.id, name: pc.company.name },
        pilot: {
          id: pc.pilot.id,
          name: pc.pilot.name,
          description: pc.pilot.description,
          status: pilotStatus(pc.pilot.startDate, pc.pilot.endDate),
        },
        shareUrl: shareUrl(pc.shareToken),
        selfEnrolled,
        participants: memberships.map((m) => ({
          id: m.id,
          email: m.participant.email,
          name: m.participant.name,
          status: m.status,
          joined: m.participant.userId !== null,
          isYou: m.participant.userId === req.user!.sub,
          // Only expose the (bearer-secret) invite link while it's still needed —
          // i.e. before the person has joined. Rotated/void once accepted.
          inviteUrl: m.participant.userId ? null : inviteUrl(m.inviteToken),
          entryCount: m.participant.userId ? entryCount.get(m.participant.userId) ?? 0 : 0,
        })),
      },
    });
  })
);

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional().nullable(),
  sendEmail: z.boolean().optional().default(true),
});

// POST /admin/participations/:pcId/participants — invite one of the company's
// people into the pilot (by email, optionally sending the invite).
adminRouter.post(
  "/participations/:pcId/participants",
  asyncHandler(async (req, res) => {
    const pc = await getAdminParticipation(req.params.pcId, req.user!.sub);
    const { email, name, sendEmail: shouldSend } = inviteSchema.parse(req.body);

    const participant = await prisma.participant.upsert({
      where: { companyId_email: { companyId: pc.companyId, email } },
      create: { companyId: pc.companyId, email, name: name ?? null },
      update: { ...(name ? { name } : {}) },
    });

    const existing = await prisma.membership.findUnique({
      where: { pilotId_participantId: { pilotId: pc.pilotId, participantId: participant.id } },
    });
    if (existing) throw new HttpError(409, "That person is already invited to this pilot");

    const token = randomBytes(24).toString("hex");
    const membership = await prisma.membership.create({
      data: { pilotId: pc.pilotId, participantId: participant.id, inviteToken: token },
    });

    const url = inviteUrl(token);
    if (shouldSend) {
      const admin = await prisma.user.findUnique({ where: { id: req.user!.sub } });
      await sendEmail(inviteEmail({ to: email, pilotName: pc.pilot.name, inviteUrl: url, inviterName: admin?.name }));
    }

    res.status(201).json({
      participant: {
        id: membership.id,
        email: participant.email,
        name: participant.name,
        status: membership.status,
        joined: participant.userId !== null,
        inviteUrl: url,
      },
    });
  })
);

// DELETE /admin/participations/:pcId/participants/:mid — remove a person.
adminRouter.delete(
  "/participations/:pcId/participants/:mid",
  asyncHandler(async (req, res) => {
    const pc = await getAdminParticipation(req.params.pcId, req.user!.sub);
    const membership = await prisma.membership.findUnique({ where: { id: req.params.mid } });
    if (!membership || membership.pilotId !== pc.pilotId) throw new HttpError(404, "Not found");
    await prisma.membership.delete({ where: { id: membership.id } });
    res.status(204).end();
  })
);

// POST /admin/participations/:pcId/self-enroll — the admin joins the pilot as a
// participant themselves (so they can toggle into the piloting view).
adminRouter.post(
  "/participations/:pcId/self-enroll",
  asyncHandler(async (req, res) => {
    const pc = await getAdminParticipation(req.params.pcId, req.user!.sub);
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) throw new HttpError(404, "User not found");

    // Ensure a participant record for the admin under this company.
    const participant = await prisma.participant.upsert({
      where: { companyId_email: { companyId: pc.companyId, email: me.email } },
      create: { companyId: pc.companyId, email: me.email, name: me.name, userId: me.id },
      update: { userId: me.id },
    });

    const existing = await prisma.membership.findUnique({
      where: { pilotId_participantId: { pilotId: pc.pilotId, participantId: participant.id } },
    });
    if (existing) {
      return res.json({ ok: true, alreadyEnrolled: true });
    }
    await prisma.membership.create({
      data: {
        pilotId: pc.pilotId,
        participantId: participant.id,
        inviteToken: randomBytes(24).toString("hex"),
        status: "ACCEPTED",
        acceptedAt: new Date(),
      },
    });
    res.status(201).json({ ok: true });
  })
);
