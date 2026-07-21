import { OrgRole } from "@prisma/client";

// The subset of the authenticated user needed for ownership decisions. `req.user`
// (set by the authenticate middleware) satisfies this shape.
export type Actor = {
  sub: string;
  organizationId: string | null;
  orgRole: OrgRole;
};

/**
 * True when the actor has org-wide oversight: an OWNER or ADMIN of an org. Such
 * a PM can see and manage every org member's projects, not just their own.
 */
export function isOrgOverseer(a: Actor): boolean {
  return a.organizationId !== null && (a.orgRole === "OWNER" || a.orgRole === "ADMIN");
}

/**
 * Decides whether `actor` may manage a resource created by `ownerId`, whose
 * owner belongs to org `ownerOrgId`. Allowed when the actor owns it directly, or
 * is an overseer in the same org as the owner.
 */
export function canManage(actor: Actor, ownerId: string, ownerOrgId: string | null): boolean {
  if (ownerId === actor.sub) return true;
  return isOrgOverseer(actor) && ownerOrgId !== null && ownerOrgId === actor.organizationId;
}

/**
 * A Prisma `where` fragment (for Application/Company, which both have `ownerId`
 * and an `owner` relation) selecting the resources this actor may see: an
 * overseer sees everything owned by their org's members; anyone else sees only
 * their own.
 */
export function ownedByWhere(
  actor: Actor
): { ownerId: string } | { owner: { organizationId: string } } {
  if (isOrgOverseer(actor)) {
    return { owner: { organizationId: actor.organizationId! } };
  }
  return { ownerId: actor.sub };
}
