import dotenv from "dotenv";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Like required(), but the fallback is only allowed outside production. This
 * prevents shipping with a well-known default secret (which would let anyone
 * forge tokens).
 */
function requiredSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (!value) {
    if (isProd) {
      throw new Error(`Refusing to start: ${name} must be set in production`);
    }
    return devFallback;
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: requiredSecret("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  email: {
    transport: (process.env.EMAIL_TRANSPORT ?? "console") as "console" | "smtp",
    from: process.env.EMAIL_FROM ?? "Pilotboard <no-reply@pilots.local>",
  },
};
