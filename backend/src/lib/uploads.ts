import { randomBytes } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { HttpError } from "./http";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");

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
