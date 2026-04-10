import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.INSTANT_APP_ADMIN_TOKEN || "fallback-secret";
}

export function generateUnsubscribeToken(email: string): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(email.trim().toLowerCase());
  return hmac.digest("base64url");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(token, "utf8"),
    );
  } catch {
    return false;
  }
}

export function buildUnsubscribeUrl(email: string): string {
  const normalized = email.trim().toLowerCase();
  const token = generateUnsubscribeToken(normalized);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.net";
  return `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(normalized)}&token=${encodeURIComponent(token)}`;
}
