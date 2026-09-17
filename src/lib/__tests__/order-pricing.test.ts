import { describe, it, expect } from "vitest";
import {
  getOrderTotal,
  getOrderBaseDisplayPrice,
  getEventRevenue,
  computeOrderTotalAtPurchase,
  computePlatformFeeAtPurchase,
  getPlatformFeeForOrder,
} from "../order-pricing";

describe("getOrderTotal", () => {
  it("returns totalSnapshot when present, ignoring current ticketType values", () => {
    const order = {
      status: "approved",
      totalSnapshot: 55,
      priceSnapshot: 50,
      feeAmountSnapshot: 5,
    };
    const tt = { price: 999, feePercent: 50, feeFixed: 100 };
    expect(getOrderTotal(order, tt)).toBe(55);
  });

  it("falls back to current tt+phase when snapshot is absent", () => {
    const order = {
      status: "approved",
      phaseId: "p1",
    };
    const tt = {
      price: 25,
      feePercent: 10,
      feeFixed: 0,
      phases: [{ id: "p1", price: 20 }],
    };
    expect(getOrderTotal(order, tt)).toBe(22);
  });

  it("uses tt.price when phaseId is missing or unknown", () => {
    const order = { status: "approved" };
    const tt = { price: 30, feePercent: 0, feeFixed: 0 };
    expect(getOrderTotal(order, tt)).toBe(30);
  });

  it("subtracts coupon and payment-method discounts in fallback path", () => {
    const order = {
      status: "approved",
      discountAmount: 5,
      paymentMethodDiscount: 2,
    };
    const tt = { price: 30, feePercent: 0, feeFixed: 0 };
    expect(getOrderTotal(order, tt)).toBe(23);
  });

  it("clamps negative totals to 0 in fallback path", () => {
    const order = {
      status: "approved",
      discountAmount: 1000,
    };
    const tt = { price: 30, feePercent: 0, feeFixed: 0 };
    expect(getOrderTotal(order, tt)).toBe(0);
  });

  it("returns 0 when neither snapshot nor ticketType is provided", () => {
    expect(getOrderTotal({ status: "approved" })).toBe(0);
  });
});

describe("getOrderBaseDisplayPrice", () => {
  it("returns priceSnapshot + feeAmountSnapshot when both present", () => {
    const order = {
      status: "approved",
      priceSnapshot: 20,
      feeAmountSnapshot: 2,
    };
    expect(getOrderBaseDisplayPrice(order, { price: 999 })).toBe(22);
  });

  it("falls back to current tt+phase price + fee", () => {
    const order = { status: "approved", phaseId: "p1" };
    const tt = {
      price: 25,
      feePercent: 10,
      feeFixed: 1,
      phases: [{ id: "p1", price: 20 }],
    };
    expect(getOrderBaseDisplayPrice(order, tt)).toBe(23);
  });
});

describe("getEventRevenue", () => {
  it("sums approved-only orders using snapshots when present", () => {
    const concert = {
      ticketTypes: [
        {
          price: 999,
          phases: [],
          orders: [
            { status: "approved", totalSnapshot: 25 },
            { status: "approved", totalSnapshot: 25 },
            { status: "pending", totalSnapshot: 25 },
            { status: "rejected", totalSnapshot: 25 },
          ],
        },
      ],
    };
    expect(getEventRevenue(concert)).toBe(50);
  });

  it("matches detail-view per-order math when no snapshot exists (legacy parity)", () => {
    const concert = {
      ticketTypes: [
        {
          price: 25,
          feePercent: 10,
          feeFixed: 0,
          phases: [{ id: "p1", price: 20 }],
          orders: [
            { status: "approved", phaseId: "p1" },
            { status: "approved", phaseId: "p1", discountAmount: 1 },
            { status: "approved" },
          ],
        },
      ],
    };
    // p1: 20 + 2 = 22; with 1 discount = 21; tt.price 25 + 2.5 = 27.5
    // total: 22 + 21 + 27.5 = 70.5
    expect(getEventRevenue(concert)).toBeCloseTo(70.5, 5);
  });

  it("supports custom status filter (e.g. include pending)", () => {
    const concert = {
      ticketTypes: [
        {
          price: 0,
          phases: [],
          orders: [
            { status: "approved", totalSnapshot: 10 },
            { status: "pending", totalSnapshot: 10 },
          ],
        },
      ],
    };
    const includePending = (s: string) => s === "approved" || s === "pending";
    expect(getEventRevenue(concert, includePending)).toBe(20);
  });
});

describe("computeOrderTotalAtPurchase", () => {
  it("computes feeAmount and total per attendee with prorated discounts", () => {
    const result = computeOrderTotalAtPurchase({
      basePrice: 20,
      feePercent: 10,
      feeFixed: 0,
      couponDiscount: 1,
      paymentMethodDiscount: 0.5,
    });
    expect(result.feeAmount).toBe(2);
    expect(result.total).toBe(20.5);
  });

  it("clamps total to 0 if discounts exceed price+fee", () => {
    const result = computeOrderTotalAtPurchase({
      basePrice: 5,
      feePercent: 0,
      feeFixed: 0,
      couponDiscount: 10,
      paymentMethodDiscount: 0,
    });
    expect(result.total).toBe(0);
  });

  it("handles zero-fee tickets cleanly", () => {
    const result = computeOrderTotalAtPurchase({
      basePrice: 0,
      feePercent: 10,
      feeFixed: 0,
      couponDiscount: 0,
      paymentMethodDiscount: 0,
    });
    expect(result.feeAmount).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe("immutability against organizer edits", () => {
  it("getOrderTotal stays the same after ticketType price/fee mutation", () => {
    const order = {
      status: "approved",
      totalSnapshot: 27,
      priceSnapshot: 25,
      feePercentSnapshot: 8,
      feeFixedSnapshot: 0,
      feeAmountSnapshot: 2,
    };
    const ttBefore = { price: 25, feePercent: 8, feeFixed: 0 };
    const ttAfter = { price: 999, feePercent: 50, feeFixed: 100 };
    expect(getOrderTotal(order, ttBefore)).toBe(27);
    expect(getOrderTotal(order, ttAfter)).toBe(27);
    expect(getOrderBaseDisplayPrice(order, ttBefore)).toBe(27);
    expect(getOrderBaseDisplayPrice(order, ttAfter)).toBe(27);
  });
});

describe("computePlatformFeeAtPurchase", () => {
  it("computes percent + fixed and rounds to cents", () => {
    expect(
      computePlatformFeeAtPurchase({ basePrice: 25, feePercent: 5, feeFixed: 0 }),
    ).toBe(1.25);
    expect(
      computePlatformFeeAtPurchase({ basePrice: 30.33, feePercent: 7, feeFixed: 0.5 }),
    ).toBe(2.62);
  });

  it("returns 0 when both percent and fixed are 0", () => {
    expect(
      computePlatformFeeAtPurchase({ basePrice: 100, feePercent: 0, feeFixed: 0 }),
    ).toBe(0);
  });
});

describe("getPlatformFeeForOrder", () => {
  const tt = { price: 25, feePercent: 0, feeFixed: 0, phases: [] };
  const cfg = { feePercent: 5, feeFixed: 0 };

  it("returns the snapshot when present, ignoring current config", () => {
    const order = { platformFeeAmountSnapshot: 1.25, priceSnapshot: 25 };
    const mutatedCfg = { feePercent: 99, feeFixed: 100 };
    expect(getPlatformFeeForOrder(order, tt, mutatedCfg)).toBe(1.25);
  });

  it("falls back to current config + priceSnapshot when amount snapshot missing", () => {
    const order = { priceSnapshot: 25 };
    expect(getPlatformFeeForOrder(order, tt, cfg)).toBe(1.25);
  });

  it("falls back to current ticketType price when no priceSnapshot", () => {
    const order = {};
    expect(getPlatformFeeForOrder(order, tt, cfg)).toBe(1.25);
  });

  it("uses phase price when order points to a phase", () => {
    const ttWithPhases = {
      price: 999,
      phases: [{ id: "p1", price: 20 }],
    };
    const order = { phaseId: "p1" };
    expect(getPlatformFeeForOrder(order, ttWithPhases, cfg)).toBe(1.0);
  });

  it("returns 0 if no config and no snapshot", () => {
    const order = { priceSnapshot: 25 };
    expect(getPlatformFeeForOrder(order, tt, null)).toBe(0);
  });

  it("survives platformFeeConfig mutation when snapshot is set", () => {
    const order = { platformFeeAmountSnapshot: 1.25, priceSnapshot: 25 };
    expect(getPlatformFeeForOrder(order, tt, { feePercent: 5, feeFixed: 0 })).toBe(1.25);
    expect(getPlatformFeeForOrder(order, tt, { feePercent: 50, feeFixed: 10 })).toBe(1.25);
    expect(getPlatformFeeForOrder(order, tt, null)).toBe(1.25);
  });
});

describe("computePlatformFeeAtPurchase — extras", () => {
  const CONFIG = { basePrice: 20, feePercent: 10, feeFixed: 0.5 };

  it("without extrasBase, behaves exactly as before", () => {
    expect(computePlatformFeeAtPurchase(CONFIG)).toBe(2.5);
    expect(computePlatformFeeAtPurchase({ ...CONFIG, extrasBase: 0 })).toBe(2.5);
  });

  it("extras only feed the PERCENTAGE part — the fixed fee stays per ticket", () => {
    // 10% of (20 + 24) + 0.50 = 4.90, not 4.90 + a second fixed charge.
    expect(computePlatformFeeAtPurchase({ ...CONFIG, extrasBase: 24 })).toBe(4.9);
  });

  it("a pure-percentage config charges the same on tickets and extras", () => {
    expect(
      computePlatformFeeAtPurchase({
        basePrice: 0,
        feePercent: 10,
        feeFixed: 0,
        extrasBase: 24,
      }),
    ).toBe(2.4);
  });

  it("rounds to cents", () => {
    expect(
      computePlatformFeeAtPurchase({
        basePrice: 0,
        feePercent: 7,
        feeFixed: 0,
        extrasBase: 13.37,
      }),
    ).toBe(0.94);
  });
});
