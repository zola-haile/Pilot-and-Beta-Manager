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

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

// Extensions we render inline when served (everything else downloads). Kept to
// safe, non-scriptable types — no SVG/HTML, so an upload can't run in our origin.
export const INLINE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
export const IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp)$/;

// Preferred extension for well-known content types; otherwise we derive one from
// the original filename (sanitized), falling back to ".bin".
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function pickExtension(mime: string, originalName: string | undefined): string {
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  const raw = (originalName ?? "").split(".").pop() ?? "";
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return ext || "bin";
}

export interface SavedFile {
  url: string;
  name: string | null;
  mime: string;
}

/**
 * Decodes a base64 data URL of any type, writes it to the uploads dir, and returns
 * the public path plus the original name + mime. Throws on invalid/oversized data.
 */
export async function saveDataUrlFile(dataUrl: string, originalName?: string): Promise<SavedFile> {
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new HttpError(400, "Unsupported or malformed file");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0) throw new HttpError(400, "Empty file");
  if (buffer.length > MAX_BYTES) throw new HttpError(400, "File too large (max 10 MB)");

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${pickExtension(mime, originalName)}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return { url: `/uploads/${filename}`, name: originalName?.slice(0, 200) ?? null, mime };
}
