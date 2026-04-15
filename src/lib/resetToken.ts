import { createHmac, timingSafeEqual } from "crypto";

const RESET_TTL = 30 * 60 * 1000; // 30 minutes

function getSecret(): string {
  const secret = process.env.RESET_TOKEN_SECRET;
  if (!secret) throw new Error("RESET_TOKEN_SECRET is not set");
  return secret;
}

/** Generate a password reset token that expires in 30 minutes */
export function generateResetToken(email: string): { token: string; expires: number } {
  const expires = Date.now() + RESET_TTL;
  const payload = `${email.trim().toLowerCase()}:${expires}`;
  const hmac = createHmac("sha256", getSecret());
  hmac.update(payload);
  const token = `${expires}.${hmac.digest("base64url")}`;
  return { token, expires };
}

/** Verify a reset token — returns true if valid and not expired */
export function verifyResetToken(email: string, token: string): boolean {
  try {
    const [expiresStr, signature] = token.split(".");
    if (!expiresStr || !signature) return false;

    const expires = parseInt(expiresStr, 10);
    if (isNaN(expires) || Date.now() > expires) return false;

    const payload = `${email.trim().toLowerCase()}:${expires}`;
    const hmac = createHmac("sha256", getSecret());
    hmac.update(payload);
    const expected = hmac.digest("base64url");

    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

/** Build the full reset URL */
export function buildResetUrl(email: string): string {
  const normalized = email.trim().toLowerCase();
  const { token } = generateResetToken(normalized);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.net";
  return `${baseUrl}/admin/reset-password?email=${encodeURIComponent(normalized)}&token=${encodeURIComponent(token)}`;
}
