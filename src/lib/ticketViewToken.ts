import crypto from "crypto";

// Reuse the same secret family as download tokens; falls back to the scanner
// secret so a single env var can cover both if desired.
function getSecret(): string {
  const secret =
    process.env.TICKET_VIEW_TOKEN_SECRET ||
    process.env.DOWNLOAD_TOKEN_SECRET ||
    process.env.SCANNER_TOKEN_SECRET;
  if (!secret) throw new Error("TICKET_VIEW_TOKEN_SECRET is not set");
  return secret;
}

// A non-expiring HMAC of the orderId. Allotment tickets are anonymous (no email
// to verify against), so their QR encodes /ticket/<orderId>?vt=<token>; this
// token lets the holder view the ticket without the email gate. The QR path is
// unchanged, so the existing PIN scanner still extracts the orderId normally.
export function generateTicketViewToken(orderId: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`view:${orderId}`)
    .digest("base64url");
}

export function verifyTicketViewToken(orderId: string, token: unknown): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const expected = generateTicketViewToken(orderId);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
