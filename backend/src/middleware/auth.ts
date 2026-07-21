import { NextFunction, Request, Response } from "express";
import { OrgRole } from "@prisma/client";
import { verifyToken, JwtPayload } from "../lib/jwt";
import { HttpError, asyncHandler } from "../lib/http";
import { prisma } from "../prisma";

// Augment Express Request with the authenticated user. `verified` reflects the
// account's current email-verification state (from the DB, not the token), and
// the org fields carry the PM's current organization + standing for authz.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        verified: boolean;
        organizationId: string | null;
        orgRole: OrgRole;
      };
    }
  }
}

/**
 * Requires a valid Bearer token AND that it still matches the live account:
 * the user must exist and the token's version must equal the user's current
 * tokenVersion (so bumping tokenVersion revokes every prior token). Role and
 * verification state are read fresh from the DB so privilege/verification
 * changes take effect immediately, never going stale in a long-lived token.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      tokenVersion: true,
      emailVerifiedAt: true,
      organizationId: true,
      orgRole: true,
    },
  });
  if (!user || user.tokenVersion !== payload.tv) {
    throw new HttpError(401, "Session is no longer valid, please sign in again");
  }

  req.user = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tv: user.tokenVersion,
    verified: user.emailVerifiedAt !== null,
    organizationId: user.organizationId,
    orgRole: user.orgRole,
  };
  next();
});

/** Guards a route to email-verified accounts only. Use after authenticate. */
export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, "Not authenticated");
  if (!req.user.verified) {
    throw new HttpError(403, "Please verify your email address to do this");
  }
  next();
}

/** Requires the authenticated user to hold one of the given roles. */
export function requireRole(...roles: Array<"PM" | "COMPANY_ADMIN" | "PARTICIPANT">) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, "Not authenticated");
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, "You do not have access to this resource");
    }
    next();
  };
}
