import { NextFunction, Request, Response } from "express";
import { verifyToken, JwtPayload } from "../lib/jwt";
import { HttpError } from "../lib/http";

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Requires a valid Bearer token; attaches req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
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
