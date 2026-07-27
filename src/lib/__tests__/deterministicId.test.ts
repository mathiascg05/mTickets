import { describe, it, expect } from "vitest";
import {
  deterministicUuid,
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
