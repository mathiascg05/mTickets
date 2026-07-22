import crypto from "crypto";

// Namespace so allotment-derived ids never collide with other deterministic ids.
const ALLOTMENT_NAMESPACE = "matickets:allotment-order:v1";

// Deterministic UUID (v5-style) from a string. Minting an allotment order with
// a stable id derived from (allotmentId, seq) makes the mint idempotent: a
// double-click or retry re-writes the SAME row via upsert instead of creating a
// duplicate. Same input always yields the same canonical UUID.
export function deterministicUuid(namespace: string, input: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${namespace}:${input}`)
    .digest("hex");
  // Build a canonical UUID string and stamp version (5) + RFC-4122 variant bits.
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "5"; // version
  const variantNibble = parseInt(hash[16], 16);
  bytes[16] = ((variantNibble & 0x3) | 0x8).toString(16); // variant 10xx
  const h = bytes.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function allotmentOrderId(allotmentId: string, seq: number): string {
  return deterministicUuid(ALLOTMENT_NAMESPACE, `${allotmentId}:${seq}`);
}
