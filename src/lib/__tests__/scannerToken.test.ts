import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TEST_SCANNER_SECRET = "test-scanner-secret-for-hmac";

beforeEach(() => {
  process.env.SCANNER_TOKEN_SECRET = TEST_SCANNER_SECRET;
});

afterEach(() => {
  delete process.env.SCANNER_TOKEN_SECRET;
});

describe("scannerToken", () => {
  it("round-trips: create then verify returns concertId", async () => {
    const { createScannerToken, verifyScannerToken } = await import(
      "../scannerToken"
    );
    const concertId = "concert-123";
    const token = createScannerToken(concertId);

    const result = verifyScannerToken(token);
    expect(result).not.toBeNull();
    expect(result!.concertId).toBe(concertId);
  });

  it("returns null for expired token", async () => {
    const { verifyScannerToken } = await import("../scannerToken");

    // Manually create an expired token
    const crypto = await import("crypto");
    const payload = { concertId: "concert-456", exp: Date.now() - 1000 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const sig = crypto
      .createHmac("sha256", Buffer.from(TEST_SCANNER_SECRET, "utf-8"))
      .update(payloadB64)
      .digest("base64url");
    const expiredToken = `${payloadB64}.${sig}`;

    const result = verifyScannerToken(expiredToken);
    expect(result).toBeNull();
  });

  it("returns null for tampered token", async () => {
    const { createScannerToken, verifyScannerToken } = await import(
      "../scannerToken"
    );
    const token = createScannerToken("concert-789");

    // Tamper with the payload
    const [, sig] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ concertId: "hacked", exp: Date.now() + 999999999 }),
    ).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${sig}`;

    const result = verifyScannerToken(tamperedToken);
    expect(result).toBeNull();
  });

  it("returns null for malformed tokens", async () => {
    const { verifyScannerToken } = await import("../scannerToken");

    expect(verifyScannerToken("")).toBeNull();
    expect(verifyScannerToken("not-a-token")).toBeNull();
    expect(verifyScannerToken("a.b.c")).toBeNull();
  });
});
