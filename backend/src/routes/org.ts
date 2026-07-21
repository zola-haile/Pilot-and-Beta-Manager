import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { asyncHandler, HttpError } from "../lib/http";
import { authenticate, requireRole } from "../middleware/auth";
import { isOrgOverseer } from "../lib/authz";
import { config } from "../config";
import { sendEmail, orgInviteEmail } from "../lib/email";

// Organization / team management, for PMs. Viewing is open to any member; only
// owners/admins (overseers) can invite, remove, or re-role people.
export const orgRouter = Router();
orgRouter.use(authenticate, requireRole("PM"));

const appBase = () => config.appUrl.replace(/\/$/, "");
const acceptUrl = (t: string) => `${appBase()}/org/accept/${t}`;

/** Loads the caller's organization id, or 404 if they somehow have none. */
function requireOrgId(req: { user?: { organizationId: string | null } }): string {
  const orgId = req.user?.organizationId ?? null;
  if (!orgId) throw new HttpError(404, "You are not part of an organization");
  return orgId;
}

/** Guards a route to org overseers (OWNER/ADMIN). */
function requireOverseer(req: { user?: { organizationId: string | null; orgRole: any } }) {
  if (!req.user || !isOrgOverseer(req.user as any)) {
    throw new HttpError(403, "Only organization owners and admins can do this");
  }
}

// GET /org — the caller's organization: members, pending invites, and whether
// the caller may manage the team.
orgRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        members: {
          orderBy: [{ orgRole: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, email: true, orgRole: true, emailVerifiedAt: true },
        },
        invites: {
          where: { acceptedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, email: true, role: true, createdAt: true },
        },
      },
    });
    if (!org) throw new HttpError(404, "Organization not found");

    const canManage = isOrgOverseer(req.user!);
    res.json({
      organization: { id: org.id, name: org.name },
      youCanManage: canManage,
      members: org.members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        orgRole: m.orgRole,
        verified: m.emailVerifiedAt !== null,
        isYou: m.id === req.user!.sub,
      })),
      // Pending invites are only useful to (and only shown to) managers. The
      // accept link (a bearer secret) is only returned once, at create time.
      invites: canManage
        ? org.invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt }))
        : [],
    });
  })
);

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  sendEmail: z.boolean().optional().default(true),
});

// POST /org/invites — invite another PM into the organization (overseer only).
orgRouter.post(
  "/invites",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    requireOverseer(req);
    const { email, role, sendEmail: shouldSend } = inviteSchema.parse(req.body);

    // Refuse if that email is already an active member of this org.
    const already = await prisma.user.findFirst({
      where: { email, organizationId: orgId },
      select: { id: true },
    });
    if (already) throw new HttpError(409, "That person is already in your organization");

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    const inviter = await prisma.user.findUnique({ where: { id: req.user!.sub } });

    // One pending invite per (org, email): re-inviting refreshes the role/token.
    const invite = await prisma.orgInvite.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, role, invitedByName: inviter?.name ?? null },
      update: { role, acceptedAt: null, invitedByName: inviter?.name ?? null },
    });

    const url = acceptUrl(invite.token);
    if (shouldSend) {
      await sendEmail(
        orgInviteEmail({
          to: email,
          orgName: org?.name ?? "your team",
          role,
          acceptUrl: url,
          inviterName: inviter?.name,
        })
      );
    }

    res.status(201).json({
      invite: { id: invite.id, email: invite.email, role: invite.role, createdAt: invite.createdAt, acceptUrl: url },
    });
  })
);

// DELETE /org/invites/:id — cancel a pending invite (overseer only).
orgRouter.delete(
  "/invites/:id",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    requireOverseer(req);
    const invite = await prisma.orgInvite.findUnique({ where: { id: req.params.id } });
    if (!invite || invite.organizationId !== orgId) throw new HttpError(404, "Invite not found");
    await prisma.orgInvite.delete({ where: { id: invite.id } });
    res.status(204).end();
  })
);

const roleSchema = z.object({ orgRole: z.enum(["ADMIN", "MEMBER"]) });

// PATCH /org/members/:userId — promote/demote a member (overseer only). The
// OWNER's role can't be changed, and you can't change your own.
orgRouter.patch(
  "/members/:userId",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    requireOverseer(req);
    const { orgRole } = roleSchema.parse(req.body);
    if (req.params.userId === req.user!.sub) {
      throw new HttpError(400, "You can't change your own role");
    }
    const member = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!member || member.organizationId !== orgId) throw new HttpError(404, "Member not found");
    if (member.orgRole === "OWNER") throw new HttpError(400, "The owner's role can't be changed");

    const updated = await prisma.user.update({
      where: { id: member.id },
      data: { orgRole },
    });
    res.json({ member: { id: updated.id, name: updated.name, email: updated.email, orgRole: updated.orgRole } });
  })
);

// DELETE /org/members/:userId — remove a PM from the organization (overseer
// only). Their projects stay theirs but leave the org's oversight. The OWNER
// can't be removed, and you can't remove yourself here.
orgRouter.delete(
  "/members/:userId",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    requireOverseer(req);
    if (req.params.userId === req.user!.sub) {
      throw new HttpError(400, "You can't remove yourself from the organization");
    }
    const member = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!member || member.organizationId !== orgId) throw new HttpError(404, "Member not found");
    if (member.orgRole === "OWNER") throw new HttpError(400, "The organization owner can't be removed");

    await prisma.user.update({
      where: { id: member.id },
      data: { organizationId: null, orgRole: "MEMBER" },
    });
    res.status(204).end();
  })
);

const renameSchema = z.object({ name: z.string().min(1).max(120) });

// PATCH /org — rename the organization (overseer only).
orgRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const orgId = requireOrgId(req);
    requireOverseer(req);
    const { name } = renameSchema.parse(req.body);
    const org = await prisma.organization.update({ where: { id: orgId }, data: { name } });
    res.json({ organization: { id: org.id, name: org.name } });
  })
);
