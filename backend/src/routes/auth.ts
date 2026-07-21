import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { hashPassword, verifyPassword, assertStrongPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { sendEmail, verifyEmail, orgInviteEmail } from "../lib/email";
import { config } from "../config";
import { OrgRole } from "@prisma/client";

export const authRouter = Router();

const appBase = () => config.appUrl.replace(/\/$/, "");
const verifyUrl = (t: string) => `${appBase()}/verify/${t}`;

// Personal pilot invites are single-use and expire; share links are long-lived.
const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;
const VERIFY_TTL_MS = 24 * 3600 * 1000;

type UserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: "PM" | "COMPANY_ADMIN" | "PARTICIPANT";
  tokenVersion: number;
  emailVerifiedAt: Date | null;
  organizationId: string | null;
  orgRole: OrgRole;
};

function publicUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
    organizationId: u.organizationId,
    orgRole: u.orgRole,
  };
}

function issueToken(u: UserRecord): string {
  return signToken({ sub: u.id, role: u.role, email: u.email, tv: u.tokenVersion });
}

function freshVerifyToken() {
  return { verifyToken: randomBytes(24).toString("hex"), verifyTokenExpiresAt: new Date(Date.now() + VERIFY_TTL_MS) };
}

async function sendVerification(email: string, token: string) {
  await sendEmail(verifyEmail({ to: email, verifyUrl: verifyUrl(token) }));
}

/* ------------------------------ Register ------------------------------ */

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).optional(),
  // PMs run pilots; participants test. Either way the email must be verified
  // before it can act on email-scoped resources (invites, admin seats).
  role: z.enum(["PM", "PARTICIPANT"]).default("PM"),
  // A PM signing up creates their own organization (they become its owner).
  organizationName: z.string().min(1).max(120).optional(),
});

// POST /auth/register — create an account and email a verification link. Always
// responds the same way whether or not the email is already taken, so it can't
// be used to enumerate existing accounts.
authRouter.post(
  "/register",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: "Too many sign-up attempts, try again later" }),
  asyncHandler(async (req, res) => {
    const { email, password, name, role, organizationName } = registerSchema.parse(req.body);
    assertStrongPassword(password, email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const { verifyToken, verifyTokenExpiresAt } = freshVerifyToken();
      // A new PM owns a fresh organization; participants have none.
      const orgName =
        organizationName?.trim() || (name ? `${name}'s organization` : "My organization");
      await prisma.user.create({
        data: {
          email,
          name: name ?? null,
          role,
          passwordHash: await hashPassword(password),
          verifyToken,
          verifyTokenExpiresAt,
          ...(role === "PM"
            ? { orgRole: "OWNER", organization: { create: { name: orgName } } }
            : {}),
        },
      });
      await sendVerification(email, verifyToken);
    }
    // Identical response either way (no account-existence disclosure).
    res.status(202).json({ pending: true });
  })
);

// POST /auth/verify/:token — confirm an email address and sign in.
authRouter.post(
  "/verify/:token",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { verifyToken: req.params.token } });
    if (!user || !user.verifyTokenExpiresAt || user.verifyTokenExpiresAt < new Date()) {
      throw new HttpError(400, "This verification link is invalid or has expired");
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyToken: null, verifyTokenExpiresAt: null },
    });
    res.json({ token: issueToken(updated), user: publicUser(updated) });
  })
);

// POST /auth/resend-verification — re-send the link. Generic response.
authRouter.post(
  "/resend-verification",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const { verifyToken, verifyTokenExpiresAt } = freshVerifyToken();
      await prisma.user.update({ where: { id: user.id }, data: { verifyToken, verifyTokenExpiresAt } });
      await sendVerification(email, verifyToken);
    }
    res.json({ ok: true });
  })
);

/* -------------------------------- Login ------------------------------- */

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many sign-in attempts, try again later" }),
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new HttpError(401, "Invalid email or password");
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password");
    if (!user.emailVerifiedAt) {
      throw new HttpError(403, "Please verify your email address before signing in", "EMAIL_UNVERIFIED");
    }
    res.json({ token: issueToken(user), user: publicUser(user) });
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

/* ---------------------- Pilot invitations (by token) ------------------- */

// GET /auth/invitations/:token — preview an invite. Requires the (secret) token;
// returns only what the accept screen needs.
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
    if (membership.status !== "ACCEPTED" && membership.invitedAt.getTime() + INVITE_TTL_MS < Date.now()) {
      throw new HttpError(410, "This invitation has expired — ask for a new one");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: membership.participant.email },
    });
    res.json({
      email: membership.participant.email,
      company: membership.participant.company.name,
      pilot: membership.pilot,
      status: membership.status,
      accountExists: Boolean(existingUser?.passwordHash),
    });
  })
);

const acceptSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  name: z.string().min(1).optional(),
});

// POST /auth/invitations/:token/accept — claim an invite. Creates/activates the
// account (proving email ownership, so it's marked verified), links the
// membership, and single-uses the token by rotating it.
authRouter.post(
  "/invitations/:token/accept",
  asyncHandler(async (req, res) => {
    const { password, name } = acceptSchema.parse(req.body);
    const membership = await prisma.membership.findUnique({
      where: { inviteToken: req.params.token },
      include: { participant: true },
    });
    if (!membership) throw new HttpError(404, "Invitation not found");
    if (membership.status !== "ACCEPTED" && membership.invitedAt.getTime() + INVITE_TTL_MS < Date.now()) {
      throw new HttpError(410, "This invitation has expired — ask for a new one");
    }
    const participant = membership.participant;

    let user = await prisma.user.findUnique({ where: { email: participant.email } });

    if (!user) {
      if (!password) throw new HttpError(400, "A password is required to create your account");
      assertStrongPassword(password, participant.email);
      user = await prisma.user.create({
        data: {
          email: participant.email,
          name: name ?? participant.name,
          role: "PARTICIPANT",
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(), // the invite proves they control this inbox
        },
      });
    } else if (!user.passwordHash) {
      if (!password) throw new HttpError(400, "A password is required to activate your account");
      assertStrongPassword(password, participant.email);
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          name: name ?? user.name ?? participant.name,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
    } else if (!user.emailVerifiedAt) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    await prisma.participant.update({
      where: { id: participant.id },
      data: { userId: user.id },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: membership.acceptedAt ?? new Date(),
        inviteToken: randomBytes(24).toString("hex"), // dead-link the used token
      },
    });

    res.json({ token: issueToken(user), user: publicUser(user) });
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
      assertStrongPassword(password, company.adminEmail);
      user = await prisma.user.create({
        data: {
          email: company.adminEmail,
          name: name ?? null,
          role: "COMPANY_ADMIN",
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(), // the emailed token proves inbox control
        },
      });
    } else if (!user.passwordHash) {
      if (!password) throw new HttpError(400, "A password is required to activate your account");
      assertStrongPassword(password, company.adminEmail);
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          name: name ?? user.name,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
    } else if (!user.emailVerifiedAt) {
      user = await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }

    await prisma.company.update({ where: { id: company.id }, data: { adminUserId: user.id } });

    res.json({ token: issueToken(user), user: publicUser(user) });
  })
);

/* ---------------------- Organization (PM) invitations ------------------- */

// GET /auth/org-invitations/:token — preview a PM's invite to join an org.
authRouter.get(
  "/org-invitations/:token",
  asyncHandler(async (req, res) => {
    const invite = await prisma.orgInvite.findUnique({
      where: { token: req.params.token },
      include: { organization: { select: { name: true } } },
    });
    if (!invite) throw new HttpError(404, "Invitation not found");
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    res.json({
      organization: { name: invite.organization.name },
      email: invite.email,
      role: invite.role,
      accepted: invite.acceptedAt !== null,
      accountExists: Boolean(existingUser?.passwordHash),
    });
  })
);

const orgAcceptSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  name: z.string().min(1).optional(),
});

// POST /auth/org-invitations/:token/accept — join the organization as a PM.
// Creates or activates the account, links it to the org with the invited role,
// and single-uses the invite.
authRouter.post(
  "/org-invitations/:token/accept",
  asyncHandler(async (req, res) => {
    const { password, name } = orgAcceptSchema.parse(req.body);
    const invite = await prisma.orgInvite.findUnique({ where: { token: req.params.token } });
    if (!invite) throw new HttpError(404, "Invitation not found");
    if (invite.acceptedAt) throw new HttpError(410, "This invitation has already been used");

    let user = await prisma.user.findUnique({ where: { email: invite.email } });

    const orgLink = {
      role: "PM" as const,
      organizationId: invite.organizationId,
      orgRole: invite.role,
    };

    if (!user) {
      if (!password) throw new HttpError(400, "A password is required to create your account");
      assertStrongPassword(password, invite.email);
      user = await prisma.user.create({
        data: {
          email: invite.email,
          name: name ?? null,
          passwordHash: await hashPassword(password),
          emailVerifiedAt: new Date(), // the emailed token proves inbox control
          ...orgLink,
        },
      });
    } else if (!user.passwordHash) {
      if (!password) throw new HttpError(400, "A password is required to activate your account");
      assertStrongPassword(password, invite.email);
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          name: name ?? user.name,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          ...orgLink,
        },
      });
    } else {
      // Existing, active account joins the org (moving from any prior org).
      user = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), ...orgLink },
      });
    }

    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), token: randomBytes(24).toString("hex") },
    });

    res.json({ token: issueToken(user), user: publicUser(user) });
  })
);
