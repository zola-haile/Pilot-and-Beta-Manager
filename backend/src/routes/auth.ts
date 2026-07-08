import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate } from "../middleware/auth";

export const authRouter = Router();

function publicUser(u: {
  id: string;
  email: string;
  name: string | null;
  role: "PM" | "COMPANY_ADMIN" | "PARTICIPANT";
}) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).optional(),
  // PMs self-register to run pilots. Participants are created via invitations.
  role: z.enum(["PM", "PARTICIPANT"]).default("PM"),
});

// POST /auth/register — create a new account (defaults to PM).
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new HttpError(409, "An account with that email already exists");

    const user = await prisma.user.create({
      data: {
        email,
        name: name ?? null,
        role,
        passwordHash: await hashPassword(password),
      },
    });
    // PMs create their own applications after registering (they can own many).
    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    res.status(201).json({ token, user: publicUser(user) });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new HttpError(401, "Invalid email or password");
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password");

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    res.json({ token, user: publicUser(user) });
  })
);

// GET /auth/me — current user from token.
authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw new HttpError(404, "User not found");
    res.json({ user: publicUser(user) });
  })
);

// GET /auth/invitations/:token — preview an invite (who it's for, which pilot).
authRouter.get(
  "/invitations/:token",
  asyncHandler(async (req, res) => {
    const membership = await prisma.membership.findUnique({
      where: { inviteToken: req.params.token },
      include: {
        pilot: { select: { name: true, description: true } },
        participant: { include: { company: { select: { name: true } } } },
      },
    });
    if (!membership) throw new HttpError(404, "Invitation not found");

    const existingUser = await prisma.user.findUnique({
      where: { email: membership.participant.email },
    });
    res.json({
      email: membership.participant.email,
      name: membership.participant.name,
      company: membership.participant.company.name,
      pilot: membership.pilot,
      status: membership.status,
      // Tells the frontend whether to ask for a new password or just a login.
      accountExists: Boolean(existingUser?.passwordHash),
    });
  })
);

/* ---------------------- Company admin invitations ---------------------- */

// GET /auth/admin-invitations/:token — preview a company-admin setup invite.
authRouter.get(
  "/admin-invitations/:token",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUnique({
      where: { adminInviteToken: req.params.token },
    });
    if (!company) throw new HttpError(404, "Invitation not found");
    const existingUser = await prisma.user.findUnique({ where: { email: company.adminEmail } });
    res.json({
      company: { name: company.name },
      adminEmail: company.adminEmail,
      alreadySetUp: company.adminUserId !== null,
      accountExists: Boolean(existingUser?.passwordHash),
    });
  })
);

const adminAcceptSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  name: z.string().min(1).optional(),
});

// POST /auth/admin-invitations/:token/accept — set up the company admin account.
authRouter.post(
  "/admin-invitations/:token/accept",
  asyncHandler(async (req, res) => {
    const { password, name } = adminAcceptSchema.parse(req.body);
    const company = await prisma.company.findUnique({
      where: { adminInviteToken: req.params.token },
    });
    if (!company) throw new HttpError(404, "Invitation not found");

    let user = await prisma.user.findUnique({ where: { email: company.adminEmail } });
    if (!user) {
      if (!password) throw new HttpError(400, "A password is required to create your account");
      user = await prisma.user.create({
        data: {
          email: company.adminEmail,
          name: name ?? null,
          role: "COMPANY_ADMIN",
          passwordHash: await hashPassword(password),
        },
      });
    } else if (!user.passwordHash) {
      if (!password) throw new HttpError(400, "A password is required to activate your account");
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), name: name ?? user.name },
      });
    }

    await prisma.company.update({ where: { id: company.id }, data: { adminUserId: user.id } });

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    res.json({ token, user: publicUser(user) });
  })
);

const acceptSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  name: z.string().min(1).optional(),
});

// POST /auth/invitations/:token/accept — claim an invite.
// Creates the participant account (setting a password) if needed, links the
// membership to that user, and returns a login token.
authRouter.post(
  "/invitations/:token/accept",
  asyncHandler(async (req, res) => {
    const { password, name } = acceptSchema.parse(req.body);
    const membership = await prisma.membership.findUnique({
      where: { inviteToken: req.params.token },
      include: { participant: true },
    });
    if (!membership) throw new HttpError(404, "Invitation not found");
    const participant = membership.participant;

    let user = await prisma.user.findUnique({ where: { email: participant.email } });

    if (!user) {
      if (!password) throw new HttpError(400, "A password is required to create your account");
      user = await prisma.user.create({
        data: {
          email: participant.email,
          name: name ?? participant.name,
          role: "PARTICIPANT",
          passwordHash: await hashPassword(password),
        },
      });
    } else if (!user.passwordHash) {
      // Account was pre-created but never activated.
      if (!password) throw new HttpError(400, "A password is required to activate your account");
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          name: name ?? user.name ?? participant.name,
        },
      });
    }

    // Link the app-level participant to this user, and mark the invite accepted.
    await prisma.participant.update({
      where: { id: participant.id },
      data: { userId: user.id },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: membership.acceptedAt ?? new Date(),
      },
    });

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    res.json({ token, user: publicUser(user) });
  })
);
