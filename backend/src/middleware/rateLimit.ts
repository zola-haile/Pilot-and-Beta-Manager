import { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/http";

/**
 * A minimal in-memory fixed-window rate limiter. Good enough to blunt brute
 * force and spam on a single-process deployment; swap for a shared store
 * (Redis) if you run multiple instances. No external dependencies.
 */
interface Options {
  windowMs: number;
  max: number;
  /** How to bucket requests. Defaults to client IP. */
  key?: (req: Request) => string;
  message?: string;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodically drop expired buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimit(opts: Options) {
  const keyFn = opts.key ?? clientIp;
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const id = `${req.method}:${req.baseUrl}${req.path}:${keyFn(req)}`;
    const entry = buckets.get(id);
    if (!entry || entry.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > opts.max) {
      throw new HttpError(429, opts.message ?? "Too many requests, please try again later");
    }
    next();
  };
}

/** Buckets by the authenticated user id (falls back to IP). Use after authenticate. */
export function byUser(req: Request): string {
  return req.user?.sub ?? clientIp(req);
}
