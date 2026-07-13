import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { HttpError } from "./http";
import { config } from "../config";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Signed-URL access control for uploads. The server is the only party that can
// mint a valid URL, and it only does so inside authenticated API responses — so
// possessing an image URL is proof you were authorized to see it. URLs carry an
// expiry, after which they must be re-issued (the SPA re-fetches on load).
const URL_TTL_MS = 7 * 24 * 3600 * 1000;
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;

function sign(file: string, exp: number): string {
  return createHmac("sha256", config.jwtSecret).update(`${file}:${exp}`).digest("hex");
}

/** Turns "/uploads/x.png" into a signed, expiring "/uploads/x.png?e=…&s=…". */
export function signUploadPath(publicPath: string): string {
  const file = publicPath.replace(/^\/uploads\//, "");
  const exp = Date.now() + URL_TTL_MS;
  return `/uploads/${file}?e=${exp}&s=${sign(file, exp)}`;
}

/** Validates a filename + expiry + signature from an upload request. */
export function verifyUploadRequest(file: string, e: unknown, s: unknown): boolean {
  if (!FILENAME_RE.test(file)) return false; // blocks path traversal / odd names
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (typeof s !== "string") return false;
  const expected = sign(file, exp);
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Decodes a base64 image data URL, writes it to the uploads dir, and returns the
 * public path (served from /uploads). Throws HttpError on invalid/oversized data.
 */
export async function saveDataUrlImage(dataUrl: string): Promise<string> {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new HttpError(400, "Unsupported image (use PNG, JPEG, GIF or WebP)");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) throw new HttpError(400, "Empty image");
  if (buffer.length > MAX_BYTES) throw new HttpError(400, "Image too large (max 5 MB)");

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${EXT[mime]}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}
