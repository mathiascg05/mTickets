import { describe, it, expect } from "vitest";
import {
  runDeterministicMatch,
  expectedGroupAmount,
  expectedOrderUsd,
  type ReconcileOrder,
  type BankRow,
} from "@/lib/reconcile";

const PM = "Pago Móvil Banesco";
const ZELLE = "Zelle";

let seq = 0;
function order(o: Partial<ReconcileOrder>): ReconcileOrder {
  seq++;
  return {
    id: `o${seq}`,
    orderNumber: `TST-${seq}`,
    firstName: "Ana",
    lastName: "Pérez",
    paymentMethod: PM,
    ...o,
  };
}
function rows(...r: [string, number][]): BankRow[] {
  return r.map(([reference, amount], index) => ({ index, reference, amount }));
}

describe("reconcile — Pago Móvil", () => {
  it("matches a single order by last-4 + Bs amount", () => {
    const o = order({ proofReferenceNumber: "MT-ABCDE-1234", purchaseAmountBs: 3650 });
    const r = runDeterministicMatch("pago_movil", rows(["000981234", 3650]), [o], [PM]);
    expect(r.matched.map((m) => m.orderId)).toEqual([o.id]);
    expect(r.unmatched).toEqual([]);
  });

  it("includes extras (extrasAmountBs on the anchor) in the group total", () => {
    const anchor = order({
      proofReferenceNumber: "MT-EXTRA-5555",
      purchaseAmountBs: 3650,
      extrasAmountBs: 730,
    });
    const r = runDeterministicMatch("pago_movil", rows(["12345555", 4380]), [anchor], [PM]);
    expect(r.matched).toHaveLength(1);
    // Sin extras el mismo movimiento NO cuadra
    const r2 = runDeterministicMatch("pago_movil", rows(["12345555", 3650]), [anchor], [PM]);
    expect(r2.matched).toHaveLength(0);
  });

  it("sums a multi-order checkout (N orders, one transfer)", () => {
    const ref = "MT-MULTI-7777";
    const group = [1, 2, 3].map(() => order({ proofReferenceNumber: ref, purchaseAmountBs: 1000 }));
    const r = runDeterministicMatch("pago_movil", rows(["7777", 3000]), group, [PM]);
    expect(r.matched.map((m) => m.orderId).sort()).toEqual(group.map((g) => g.id).sort());
  });

  it("approves area companions together with the primary (fix)", () => {
    const ref = "MT-AREAX-4321";
    const primary = order({ proofReferenceNumber: ref, purchaseAmountBs: 7300 });
    const c1 = order({ proofReferenceNumber: ref }); // companion: sin purchaseAmountBs
    const c2 = order({ proofReferenceNumber: ref });
    const r = runDeterministicMatch("pago_movil", rows(["994321", 7300]), [primary, c1, c2], [PM]);
    expect(r.matched.map((m) => m.orderId).sort()).toEqual([primary.id, c1.id, c2.id].sort());
    expect(r.totalPending).toBe(3);
  });

  it("respects the 0.5 Bs tolerance boundary", () => {
    const o = order({ proofReferenceNumber: "MT-TOLER-1111", purchaseAmountBs: 100 });
    expect(runDeterministicMatch("pago_movil", rows(["1111", 100.5]), [o], [PM]).matched).toHaveLength(1);
    expect(runDeterministicMatch("pago_movil", rows(["1111", 100.51]), [o], [PM]).matched).toHaveLength(0);
  });

  it("reports ambiguity instead of guessing between groups", () => {
    const a = order({ proofReferenceNumber: "MT-AAAAA-2222", purchaseAmountBs: 500 });
    const b = order({ proofReferenceNumber: "MT-BBBBB-2222", purchaseAmountBs: 500 });
    const r = runDeterministicMatch("pago_movil", rows(["2222", 500]), [a, b], [PM]);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched[0].reason).toMatch(/Multiples coincidencias/);
  });

  it("never matches an order without reference digits (MT-XXXXX-)", () => {
    const o = order({ proofReferenceNumber: "MT-NOREF-", purchaseAmountBs: 500 });
    const r = runDeterministicMatch("pago_movil", rows(["88880000", 500]), [o], [PM]);
    expect(r.matched).toHaveLength(0);
  });

  it("ignores orders of other payment methods", () => {
    const o = order({ proofReferenceNumber: "MT-OTHER-3333", purchaseAmountBs: 500, paymentMethod: "Otro" });
    const r = runDeterministicMatch("pago_movil", rows(["3333", 500]), [o], [PM]);
    expect(r.matched).toHaveLength(0);
    expect(r.totalPending).toBe(0);
  });
});

describe("reconcile — Zelle", () => {
  const tt = { price: 50, feePercent: 10, feeFixed: 0 };

  it("matches a Zelle purchase WITH extras (the bug: live recalculation ignored extras)", () => {
    // Entrada $50 + fee $5 = $55; extras $20 sumados en el totalSnapshot de la ancla.
    const anchor = order({
      paymentMethod: ZELLE,
      proofReferenceNumber: "MT-ZXTRA",
      totalSnapshot: 75,
      ticketType: tt,
    });
    const r = runDeterministicMatch("zelle", rows(["Zelle from ANA MT-ZXTRA", 75]), [anchor], [ZELLE]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].orderAmount).toBe(75);
  });

  it("uses the snapshot even if prices changed mid-sale", () => {
    const o = order({
      paymentMethod: ZELLE,
      proofReferenceNumber: "MT-PRICE",
      totalSnapshot: 55,
      ticketType: { price: 80 }, // el organizador subio el precio despues
    });
    const r = runDeterministicMatch("zelle", rows(["MT-PRICE", 55]), [o], [ZELLE]);
    expect(r.matched).toHaveLength(1);
  });

  it("falls back to the live recalculation for legacy orders without snapshot", () => {
    const legacy = order({
      paymentMethod: ZELLE,
      proofReferenceNumber: "MT-LEGCY",
      discountAmount: 5,
      ticketType: tt,
    });
    expect(expectedOrderUsd(legacy)).toBe(50);
    const r = runDeterministicMatch("zelle", rows(["memo MT-LEGCY", 50]), [legacy], [ZELLE]);
    expect(r.matched).toHaveLength(1);
  });

  it("drops legacy orders whose amount cannot be determined", () => {
    const legacy = order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-NOTTT" });
    const r = runDeterministicMatch("zelle", rows(["MT-NOTTT", 50]), [legacy], [ZELLE]);
    expect(r.matched).toHaveLength(0);
    expect(r.totalPending).toBe(0);
  });

  it("sums a multi-order group and scales tolerance with group size", () => {
    const group = [1, 2, 3].map(() =>
      order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-GROUP", totalSnapshot: 55, ticketType: tt }),
    );
    expect(expectedGroupAmount(group, "zelle")).toBe(165);
    expect(runDeterministicMatch("zelle", rows(["MT-GROUP", 165.03]), group, [ZELLE]).matched).toHaveLength(3);
    expect(runDeterministicMatch("zelle", rows(["MT-GROUP", 165.04]), group, [ZELLE]).matched).toHaveLength(0);
  });

  it("area companions (totalSnapshot 0) do not inflate the expected amount", () => {
    const primary = order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-AREAZ", totalSnapshot: 200, ticketType: tt });
    const comp = order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-AREAZ", totalSnapshot: 0, ticketType: tt });
    const r = runDeterministicMatch("zelle", rows(["MT-AREAZ", 200]), [primary, comp], [ZELLE]);
    expect(r.matched).toHaveLength(2);
  });

  it("does not reuse a memo twice in the same file", () => {
    const o = order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-TWICE", totalSnapshot: 55 });
    const r = runDeterministicMatch("zelle", rows(["MT-TWICE", 55], ["MT-TWICE", 55]), [o], [ZELLE]);
    expect(r.matched).toHaveLength(1);
    expect(r.unmatched[0].reason).toMatch(/ya conciliado/);
  });

  it("reports rows without memo and amount mismatches", () => {
    const o = order({ paymentMethod: ZELLE, proofReferenceNumber: "MT-AMOUN", totalSnapshot: 55 });
    const r = runDeterministicMatch("zelle", rows(["sin memo", 55], ["MT-AMOUN", 40]), [o], [ZELLE]);
    expect(r.unmatched.map((u) => u.rowIndex)).toEqual([0, 1]);
    expect(r.unmatched[1].reason).toMatch(/esperado: \$55\.00/);
  });
});
