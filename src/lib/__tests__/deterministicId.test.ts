import { describe, it, expect } from "vitest";
import {
  deterministicUuid,
  extraRedemptionId,
  extraGroupIdFor,
  extraItemIdFor,
  allotmentOrderId,
  feeTxnId,
  orderIdFor,
  guestListOrderIdFor,
} from "@/lib/deterministicId";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicId helpers", () => {
  it("produces canonical v5-style UUIDs", () => {
    expect(feeTxnId("order", "abc")).toMatch(UUID_RE);
    expect(orderIdFor("sub", 0)).toMatch(UUID_RE);
    expect(guestListOrderIdFor("entry-1")).toMatch(UUID_RE);
    expect(allotmentOrderId("lot-1", 3)).toMatch(UUID_RE);
  });

  it("is deterministic: same input → same id (idempotency invariant)", () => {
    expect(feeTxnId("order", "order-1")).toBe(feeTxnId("order", "order-1"));
    expect(orderIdFor("sub-1", 2)).toBe(orderIdFor("sub-1", 2));
    expect(guestListOrderIdFor("e1")).toBe(guestListOrderIdFor("e1"));
  });

  it("distinguishes different inputs, kinds and indices", () => {
    expect(feeTxnId("order", "a")).not.toBe(feeTxnId("order", "b"));
    // Same entity id, different order type → different fee-txn id.
    expect(feeTxnId("order", "x")).not.toBe(feeTxnId("guestListOrder", "x"));
    expect(feeTxnId("order", "x")).not.toBe(feeTxnId("allotment", "x"));
    // Different attendee index → different order id.
    expect(orderIdFor("sub", 0)).not.toBe(orderIdFor("sub", 1));
    // Different submission → different order id.
    expect(orderIdFor("s1", 0)).not.toBe(orderIdFor("s2", 0));
  });

  it("namespaces prevent collisions between helpers", () => {
    // A raw deterministicUuid in one namespace must not equal another helper's.
    expect(deterministicUuid("other", "order-1")).not.toBe(
      feeTxnId("order", "order-1"),
    );
    expect(orderIdFor("id", 0)).not.toBe(guestListOrderIdFor("id"));
  });
});

describe("extraRedemptionId — the anti-double-redeem mechanism", () => {
  const POOL = "grp:group-1:x-franela";

  it("is deterministic: the same unit always maps to the same row id", () => {
    expect(extraRedemptionId(POOL, 0)).toBe(extraRedemptionId(POOL, 0));
  });

  it("gives a different id to each unit of the pool", () => {
    expect(extraRedemptionId(POOL, 0)).not.toBe(extraRedemptionId(POOL, 1));
  });

  it("keeps pools apart", () => {
    expect(extraRedemptionId("grp:a:x", 0)).not.toBe(
      extraRedemptionId("grp:b:x", 0),
    );
    expect(extraRedemptionId("inc:order-1:x", 0)).not.toBe(
      extraRedemptionId("grp:order-1:x", 0),
    );
  });

  it("a pool of N units has EXACTLY N possible row ids", () => {
    // This is the whole safety argument: writes use .create(), which throws if
    // the id exists, so the size of the id space caps how many redemptions can
    // ever exist. Two scanners racing for unit 0 compute the same id — one wins.
    const N = 5;
    const ids = new Set(
      Array.from({ length: N }, (_, i) => extraRedemptionId(POOL, i)),
    );
    expect(ids.size).toBe(N);
  });

  it("two devices racing for the same unit produce the SAME id", () => {
    const deviceA = extraRedemptionId(POOL, 0);
    const deviceB = extraRedemptionId(POOL, 0);
    expect(deviceA).toBe(deviceB);
  });

  it("does not collide with the other deterministic id namespaces", () => {
    expect(extraRedemptionId("a", 0)).not.toBe(deterministicUuid("other", "a:0"));
    expect(extraGroupIdFor("sub-1")).not.toBe(extraItemIdFor("sub-1", "x"));
  });

  it("a retried checkout rebuilds the same extras pool instead of a second one", () => {
    expect(extraGroupIdFor("sub-1")).toBe(extraGroupIdFor("sub-1"));
    expect(extraGroupIdFor("sub-1")).not.toBe(extraGroupIdFor("sub-2"));
    expect(extraItemIdFor("g", "x")).toBe(extraItemIdFor("g", "x"));
    expect(extraItemIdFor("g", "x")).not.toBe(extraItemIdFor("g", "y"));
  });
});
