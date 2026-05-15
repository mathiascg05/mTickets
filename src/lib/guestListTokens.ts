import { randomBytes } from "crypto";

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function generateOrderToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isValidToken(val: unknown): val is string {
  return typeof val === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(val);
}
