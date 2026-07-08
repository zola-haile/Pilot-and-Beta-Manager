import express from "express";
import cors from "cors";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { applicationRouter } from "./routes/application";
import { pilotsRouter } from "./routes/pilots";
import { adminRouter } from "./routes/admin";
import { joinRouter } from "./routes/join";
import { participantRouter } from "./routes/participant";
import { errorHandler } from "./middleware/error";
import { UPLOAD_DIR } from "./lib/uploads";

const app = express();

app.use(cors({ origin: config.corsOrigins }));
// Raised limit so base64 image attachments in comments fit in the JSON body.
app.use(express.json({ limit: "12mb" }));

// Serve uploaded comment images.
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/", applicationRouter); // /applications, /companies, /features
app.use("/pilots", pilotsRouter);
app.use("/admin", adminRouter);
app.use("/join", joinRouter);
app.use("/my", participantRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Pilot Manager API listening on http://localhost:${config.port}`);
});
