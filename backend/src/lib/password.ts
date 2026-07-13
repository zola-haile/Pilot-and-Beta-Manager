import bcrypt from "bcryptjs";
import { HttpError } from "./http";

const ROUNDS = 10;

// A tiny stop-list of the most obviously weak choices. Not a substitute for a
// real breach-list check, but blocks the worst offenders for free.
const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwertyuiop",
  "11111111",
  "iloveyou",
  "letmein1",
  "welcome1",
]);

/**
 * Enforces a minimum password quality: at least 8 chars, not a well-known weak
 * password, and not trivially derived from the account email. Throws a 400
 * HttpError otherwise. (Length is also enforced by the zod schemas.)
 */
export function assertStrongPassword(plain: string, email?: string): void {
  if (plain.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters");
  }
  if (COMMON.has(plain.toLowerCase())) {
    throw new HttpError(400, "That password is too common — please choose another");
  }
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && plain.toLowerCase().includes(local)) {
    throw new HttpError(400, "Password must not contain your email name");
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
