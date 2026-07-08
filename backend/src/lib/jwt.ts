import jwt from "jsonwebtoken";
import { config } from "../config";

export type UserRole = "PM" | "COMPANY_ADMIN" | "PARTICIPANT";

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
