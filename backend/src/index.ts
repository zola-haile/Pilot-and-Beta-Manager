import express from "express";
import cors from "cors";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { applicationRouter } from "./routes/application";
import { pilotsRouter } from "./routes/pilots";
import { adminRouter } from "./routes/admin";
import { orgRouter } from "./routes/org";
import { joinRouter } from "./routes/join";
import { participantRouter } from "./routes/participant";
import path from "path";
import { errorHandler } from "./middleware/error";
import { UPLOAD_DIR, verifyUploadRequest, INLINE_EXT } from "./lib/uploads";

const app = express();

app.use(cors({ origin: config.corsOrigins }));
// Raised limit so base64 file attachments in comments/messages fit in the body.
app.use(express.json({ limit: "40mb" }));

// Serve uploaded attachments, but only via a valid signed URL (minted inside
// authenticated API responses). Blocks unauthenticated hot-linking and traversal.
app.get("/uploads/:file", (req, res) => {
  const { file } = req.params;
  if (!verifyUploadRequest(file, req.query.e, req.query.s)) {
    return res.status(403).json({ error: "This link is invalid or has expired" });
  }
  // Never let the browser sniff a content type, and force non-inline file types
  // to download rather than render (so an uploaded file can't execute inline).
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!INLINE_EXT.has(path.extname(file).toLowerCase())) {
    res.setHeader("Content-Disposition", "attachment");
  }
  res.sendFile(path.join(UPLOAD_DIR, file));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/", applicationRouter); // /applications, /companies, /features
app.use("/pilots", pilotsRouter);
app.use("/admin", adminRouter);
app.use("/org", orgRouter);
app.use("/join", joinRouter);
app.use("/my", participantRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Pilotboard API listening on http://localhost:${config.port}`);
});
