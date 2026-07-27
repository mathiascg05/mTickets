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

// Deterministic id for a platform-fee balanceTransaction, derived from the
// order it charges. Because the id is stable, two concurrent (or repeated)
// approvals of the same order upsert the SAME ledger row instead of inserting a
// second `fee` transaction — guaranteeing at most ONE fee charge per order even
// though InstantDB has no conditional writes. `kind` namespaces the different
// order types (concert order / guest-list order / allotment) so their ids never
// collide.
const FEE_TXN_NAMESPACE = "matickets:fee-txn:v1";
export function feeTxnId(
  kind: "order" | "guestListOrder" | "allotment",
  entityId: string,
): string {
  return deterministicUuid(FEE_TXN_NAMESPACE, `${kind}:${entityId}`);
}

// Deterministic id for the Nth order of a checkout submission. A retry or
// double-submit that reuses the same client-generated submissionId regenerates
// the SAME order ids, so the create upserts the same N rows instead of creating
// duplicates.
const ORDER_NAMESPACE = "matickets:order:v1";
export function orderIdFor(submissionId: string, index: number): string {
  return deterministicUuid(ORDER_NAMESPACE, `${submissionId}:${index}`);
}

// A guest-list entry redeems into exactly one order, so its order id is derived
// from the entry id: concurrent redemptions of one invite upsert the same row
// instead of creating duplicate orders.
const GUESTLIST_ORDER_NAMESPACE = "matickets:guestlist-order:v1";
export function guestListOrderIdFor(entryId: string): string {
  return deterministicUuid(GUESTLIST_ORDER_NAMESPACE, entryId);
}
