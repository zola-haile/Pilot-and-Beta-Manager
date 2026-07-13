import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { hashPassword, assertStrongPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { sendEmail, verifyEmail } from "../lib/email";
import { config } from "../config";

// Public self-enroll via a company's shareable pilot link. No auth required.
export const joinRouter = Router();

async function loadShare(token: string) {
  const pc = await prisma.pilotCompany.findUnique({
    where: { shareToken: token },
    include: { company: true, pilot: true },
  });
  if (!pc) throw new HttpError(404, "This link is not valid");
  return pc;
}

// GET /join/:token — preview which pilot/company this link joins.
joinRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const pc = await loadShare(req.params.token);
    res.json({
      pilot: { name: pc.pilot.name, description: pc.pilot.description },
      company: { name: pc.company.name },
    });
  })
);

const acceptSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// POST /join/:token/accept — self-enroll as a participant under that company.
// For NEW people only: an existing, active account must sign in and use the
// logged-in "join a link" flow (so a share link can't enroll someone else's
// account or probe/alter it). New accounts start unverified and are emailed a
// confirmation link.
joinRouter.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const pc = await loadShare(req.params.token);
    const { email, name, password } = acceptSchema.parse(req.body);
    assertStrongPassword(password, email);

    // Create or activate the user account.
    let user = await prisma.user.findUnique({ where: { email } });
    if (user && user.passwordHash) {
      throw new HttpError(
        409,
        "An account with this email already exists — sign in, then use “Have a link?” to join."
      );
    }
    const { verifyToken, verifyTokenExpiresAt } = {
      verifyToken: randomBytes(24).toString("hex"),
      verifyTokenExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    };
    if (!user) {
      user = await prisma.user.create({
        data: { email, name, role: "PARTICIPANT", passwordHash: await hashPassword(password), verifyToken, verifyTokenExpiresAt },
      });
    } else {
      // A shell account pre-created by a PM invite (no password yet).
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), name: user.name ?? name, verifyToken, verifyTokenExpiresAt },
      });
    }
    await sendEmail(verifyEmail({ to: email, verifyUrl: `${config.appUrl.replace(/\/$/, "")}/verify/${verifyToken}` }));

    // Participant under this company.
    const participant = await prisma.participant.upsert({
      where: { companyId_email: { companyId: pc.companyId, email } },
      create: { companyId: pc.companyId, email, name, userId: user.id },
      update: { userId: user.id },
    });

    // Membership into the pilot (idempotent).
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
