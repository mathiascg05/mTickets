import { describe, it, expect } from "vitest";
import {
  poolKeyIncluded,
  poolKeyPurchased,
  poolKeyFor,
  extraSoldQty,
  extraAvailableStock,
  priceExtraSelection,
  buildEntitlements,
  freeUnitIndices,
  isLiveOrderStatus,
} from "@/lib/extras";

const TRAGO = { id: "x-trago", name: "Trago", price: 0 };
const FRANELA = { id: "x-franela", name: "Franela", price: 12 };

describe("pool keys", () => {
  it("separates the per-ticket pool from the per-checkout pool", () => {
    expect(poolKeyIncluded("order-1", "x-trago")).toBe("inc:order-1:x-trago");
    expect(poolKeyPurchased("group-1", "x-trago")).toBe("grp:group-1:x-trago");
    expect(poolKeyIncluded("a", "b")).not.toBe(poolKeyPurchased("a", "b"));
  });

  it("gives every QR of an area its OWN included pool", () => {
    // A ticket type that includes one drink hands one to each companion.
    expect(poolKeyIncluded("qr-1", "x-trago")).not.toBe(
      poolKeyIncluded("qr-2", "x-trago"),
    );
  });

  it("gives every QR of a checkout the SAME purchased pool", () => {
    expect(poolKeyFor("purchased", "group-1", "x-franela")).toBe(
      poolKeyFor("purchased", "group-1", "x-franela"),
    );
  });
});

describe("stock", () => {
  const liveGroup = { orders: [{ status: "pending" }] };
  const deadGroup = { orders: [{ status: "rejected" }, { status: "cancelled" }] };

  it("counts lines whose checkout is still alive", () => {
    expect(
      extraSoldQty([
        { quantity: 2, group: liveGroup },
        { quantity: 3, group: { orders: [{ status: "approved" }] } },
      ]),
    ).toBe(5);
  });

  it("gives stock back when the whole purchase is rejected or cancelled", () => {
    expect(extraSoldQty([{ quantity: 4, group: deadGroup }])).toBe(0);
  });

  it("still counts a line if ANY order of the group survives", () => {
    expect(
      extraSoldQty([
        {
          quantity: 1,
          group: { orders: [{ status: "rejected" }, { status: "approved" }] },
        },
      ]),
    ).toBe(1);
  });

  it("unwraps the admin SDK's has-one-as-array quirk", () => {
    expect(extraSoldQty([{ quantity: 7, group: [liveGroup] }])).toBe(7);
  });

  it("treats a missing stock cap as unlimited", () => {
    expect(extraAvailableStock({}, 100)).toBe(Infinity);
    expect(extraAvailableStock({ stock: 10 }, 4)).toBe(6);
  });

  it("never reports negative availability", () => {
    expect(extraAvailableStock({ stock: 3 }, 9)).toBe(0);
  });

  it("isLiveOrderStatus only rejects the dead statuses", () => {
    expect(isLiveOrderStatus("approved")).toBe(true);
    expect(isLiveOrderStatus("pending")).toBe(true);
    expect(isLiveOrderStatus("rejected")).toBe(false);
    expect(isLiveOrderStatus("cancelled")).toBe(false);
    expect(isLiveOrderStatus(undefined)).toBe(false);
  });
});

describe("priceExtraSelection", () => {
  it("prices from the catalog, never from the client", () => {
    const { lines, subtotal } = priceExtraSelection(
      [{ extraId: "x-franela", quantity: 2 }],
      [{ ...FRANELA, price: 12 }],
    );
    expect(subtotal).toBe(24);
    expect(lines[0]).toMatchObject({ unitPrice: 12, subtotal: 24, name: "Franela" });
  });

  it("ignores unknown ids and non-positive quantities", () => {
    const { lines, subtotal } = priceExtraSelection(
      [
        { extraId: "ghost", quantity: 5 },
        { extraId: "x-franela", quantity: 0 },
      ],
      [FRANELA],
    );
    expect(lines).toEqual([]);
    expect(subtotal).toBe(0);
  });

  it("rounds to cents", () => {
    const { subtotal } = priceExtraSelection(
      [{ extraId: "p", quantity: 3 }],
      [{ id: "p", name: "P", price: 0.1 }],
    );
    expect(subtotal).toBe(0.3);
  });
});

describe("buildEntitlements", () => {
  it("mixes the ticket's included extras with the checkout's pool", () => {
    const result = buildEntitlements({
      orderId: "order-1",
      includedLinks: [{ includedQty: 1, extra: TRAGO }],
      group: { id: "group-1", items: [{ quantity: 2, extra: FRANELA }] },
      redemptions: [],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "Trago",
      source: "included",
      total: 1,
      redeemed: 0,
      remaining: 1,
    });
    expect(result[1]).toMatchObject({
      name: "Franela",
      source: "purchased",
      total: 2,
      remaining: 2,
    });
  });

  it("derives the balance by counting redemption rows, never a stored counter", () => {
    const [franela] = buildEntitlements({
      orderId: "order-1",
      group: { id: "group-1", items: [{ quantity: 2, extra: FRANELA }] },
      redemptions: [{ poolKey: "grp:group-1:x-franela", unitIndex: 0 }],
    });
    expect(franela).toMatchObject({ total: 2, redeemed: 1, remaining: 1 });
  });

  it("a redemption from a sibling QR reduces the shared balance", () => {
    // Both QRs read the same pool key, so QR #2 sees what QR #1 already took.
    const redemptions = [{ poolKey: "grp:group-1:x-franela", unitIndex: 0 }];
    for (const orderId of ["qr-1", "qr-2"]) {
      const [line] = buildEntitlements({
        orderId,
        group: { id: "group-1", items: [{ quantity: 2, extra: FRANELA }] },
        redemptions,
      });
      expect(line.remaining).toBe(1);
    }
  });

  it("keeps included pools independent per QR", () => {
    const redemptions = [{ poolKey: "inc:qr-1:x-trago", unitIndex: 0 }];
    const [used] = buildEntitlements({
      orderId: "qr-1",
      includedLinks: [{ includedQty: 1, extra: TRAGO }],
      redemptions,
    });
    const [fresh] = buildEntitlements({
      orderId: "qr-2",
      includedLinks: [{ includedQty: 1, extra: TRAGO }],
      redemptions,
    });
    expect(used.remaining).toBe(0);
    expect(fresh.remaining).toBe(1);
  });

  it("clamps a balance that somehow over-counted instead of going negative", () => {
    const [line] = buildEntitlements({
      orderId: "order-1",
      includedLinks: [{ includedQty: 1, extra: TRAGO }],
      redemptions: [
        { poolKey: "inc:order-1:x-trago", unitIndex: 0 },
        { poolKey: "inc:order-1:x-trago", unitIndex: 1 },
      ],
    });
    expect(line.remaining).toBe(0);
    expect(line.redeemed).toBe(1);
  });

  it("returns nothing for an order with no extras at all", () => {
    expect(
      buildEntitlements({ orderId: "order-1", redemptions: [] }),
    ).toEqual([]);
  });

  it("drops zero-quantity entitlements", () => {
    expect(
      buildEntitlements({
        orderId: "order-1",
        includedLinks: [{ includedQty: 0, extra: TRAGO }],
        redemptions: [],
      }),
    ).toEqual([]);
  });
});

describe("freeUnitIndices", () => {
  it("hands out the lowest free slots", () => {
    expect(freeUnitIndices([], 3, 2)).toEqual([0, 1]);
    expect(freeUnitIndices([0], 3, 2)).toEqual([1, 2]);
  });

  it("returns fewer than asked when the pool is exhausted — the caller's 409", () => {
    expect(freeUnitIndices([0, 1], 2, 1)).toEqual([]);
    expect(freeUnitIndices([0], 2, 2)).toEqual([1]);
  });

  it("steps over a gap left by a non-contiguous set", () => {
    expect(freeUnitIndices([1], 3, 2)).toEqual([0, 2]);
  });
});
