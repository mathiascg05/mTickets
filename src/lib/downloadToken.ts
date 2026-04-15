import crypto from "crypto";

const SECRET = process.env.DOWNLOAD_TOKEN_SECRET || "matickets-download-default-secret";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateDownloadToken(orderId: string): string {
  const timestamp = Date.now().toString(36);
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${orderId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);
  return `${timestamp}.${signature}`;
}

export function verifyDownloadToken(orderId: string, token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [timestamp, signature] = parts;

  const ts = parseInt(timestamp, 36);
  if (isNaN(ts) || Date.now() - ts > MAX_AGE_MS) return false;

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${orderId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
