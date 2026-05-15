import crypto from "crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret(): Buffer {
  const secret = process.env.SCANNER_TOKEN_SECRET;
  if (!secret) throw new Error("SCANNER_TOKEN_SECRET is not set");
  return Buffer.from(secret, "utf-8");
}

export function createGuestScannerToken(eventId: string): string {
  const payload = { glEventId: eventId, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifyGuestScannerToken(
  token: string,
): { eventId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  const sigBuf = Buffer.from(sig, "utf-8");
  const expectedBuf = Buffer.from(expectedSig, "utf-8");
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.glEventId !== "string") return null;
    return { eventId: payload.glEventId };
  } catch {
    return null;
  }
}
