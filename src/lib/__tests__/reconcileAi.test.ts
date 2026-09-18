import { describe, it, expect } from "vitest";
import { validateExtraction, toBankRow, MAX_MOVEMENTS } from "@/lib/reconcileAi/movements";
import { matchAllotments, type AllotmentCandidate } from "@/lib/reconcileAi/allotments";
import {
  buildCandidateGroups,
  validateSuggestions,
  type SuggestOrder,
  type SuggestRow,
} from "@/lib/reconcileAi/suggestions";
import { ReconcileAiError } from "@/lib/reconcileAi/errors";

const mv = (o: Record<string, unknown>) => ({
  date: "01/09/2026",
  description: "PAGO MOVIL",
  reference: "00012345",
  amount: 100,
  direction: "credit",
  ...o,
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ReconcileAiError ? e.code : "OTHER";
  }
  return undefined;
}

describe("validateExtraction", () => {
  it("accepts well-formed movements and rounds amounts", () => {
    const { movements, invalid } = validateExtraction({
      movements: [mv({ amount: 10.456 }), mv({ direction: "debit" })],
    });
    expect(invalid).toBe(0);
    expect(movements[0].amount).toBe(10.46);
    expect(movements.map((m) => m.index)).toEqual([0, 1]);
  });

  it("drops rows with string/negative/null amounts or bad direction", () => {
    const good = Array.from({ length: 9 }, () => mv({}));
    const { movements, invalid } = validateExtraction({
      movements: [...good, mv({ amount: "1.234,56" })],
    });
    expect(invalid).toBe(1);
    expect(movements).toHaveLength(9);
    expect(codeOf(() => validateExtraction({ movements: [mv({ amount: -5 }), mv({ direction: "in" })] }))).toBe(
      "AI_BAD_OUTPUT",
    );
  });

  it("fails loudly on garbage, empty or oversized output", () => {
    expect(codeOf(() => validateExtraction("nope"))).toBe("AI_BAD_OUTPUT");
    expect(codeOf(() => validateExtraction({ movements: {} }))).toBe("AI_BAD_OUTPUT");
    expect(codeOf(() => validateExtraction({ movements: [] }))).toBe("NO_MOVEMENTS");
    const tooMany = Array.from({ length: MAX_MOVEMENTS + 1 }, () => mv({}));
    expect(codeOf(() => validateExtraction({ movements: tooMany }))).toBe("TOO_MANY_MOVEMENTS");
  });

  it("truncates huge strings", () => {
    const { movements } = validateExtraction({ movements: [mv({ description: "x".repeat(5000) })] });
    expect(movements[0].description!.length).toBe(300);
  });

  it("maps to bank rows: PM uses only the extracted reference; Zelle searches the memo in upper case", () => {
    const [m] = validateExtraction({
      movements: [mv({ description: "de ana mt-7k2qp 12/09", reference: null })],
    }).movements;
    expect(toBankRow(m, "pago_movil").reference).toBe("");
    expect(toBankRow(m, "zelle").reference).toContain("MT-7K2QP");
  });
});

describe("matchAllotments", () => {
  const lots: AllotmentCandidate[] = [
    { id: "a1", schoolName: "Colegio San José", status: "submitted", totalPrice: 400, ticketCount: 40, purchaseAmountBs: 146000, proofReferenceNumber: "0098765432" },
    { id: "a2", schoolName: "Colegio Aprobado", status: "approved", totalPrice: 400, ticketCount: 40, purchaseAmountBs: 146000 },
  ];
  const row = (index: number, amount: number, reference: string | null) => ({ index, amount, reference, description: null });

  it("labels by reference + amount and never returns approved lots", () => {
    const r = matchAllotments([row(0, 146000, "5432")], lots, "pago_movil");
    expect(r).toEqual([expect.objectContaining({ rowIndex: 0, allotmentId: "a1", reason: "reference_and_amount" })]);
  });

  it("labels by amount alone within 1%", () => {
    expect(matchAllotments([row(0, 145000, "1111")], lots, "pago_movil")[0]?.reason).toBe("amount");
    expect(matchAllotments([row(0, 140000, "1111")], lots, "pago_movil")).toEqual([]);
  });

  it("assigns a lot to only one row, preferring the stronger match", () => {
    const r = matchAllotments([row(0, 146000, "1111"), row(1, 146000, "5432")], lots, "pago_movil");
    expect(r).toHaveLength(1);
    expect(r[0].rowIndex).toBe(1);
  });

  it("uses totalPrice (USD) for Zelle", () => {
    expect(matchAllotments([row(0, 400, null)], lots, "zelle")[0]?.allotmentId).toBe("a1");
  });
});

describe("suggestions", () => {
  const PM = "Pago Móvil";
  const orders: SuggestOrder[] = [
    // compra sin digitos (metodo solo-captura)
    { id: "x1", orderNumber: "T-1", firstName: "Luis", lastName: "Mora", paymentMethod: PM, proofReferenceNumber: "MT-NOREF-", purchaseAmountBs: 730, createdAt: 2 },
    // area: primary + companion en la misma compra
    { id: "x2", orderNumber: "T-2", firstName: "Eva", lastName: "Ruiz", paymentMethod: PM, proofReferenceNumber: "MT-AREAS-4321", purchaseAmountBs: 2000, createdAt: 1 },
    { id: "x3", orderNumber: "T-3", firstName: "Leo", lastName: "Ruiz", paymentMethod: PM, proofReferenceNumber: "MT-AREAS-4321", createdAt: 1 },
    // legacy sin monto conocido: no es candidata
    { id: "x4", firstName: "Sin", lastName: "Monto", paymentMethod: PM, proofReferenceNumber: "MT-LEGAC-1", createdAt: 3 },
  ];
  const rows: SuggestRow[] = [
    { index: 5, date: null, description: "LUIS MORA", reference: "778899", amount: 730 },
    { index: 6, date: null, description: null, reference: "4329", amount: 2000 },
    { index: 7, date: null, description: null, reference: "1", amount: 100 },
  ];
  const { groups } = buildCandidateGroups(orders, "pago_movil");
  const idOf = (orderId: string) => groups.find((g) => g.orders.some((o) => o.id === orderId))!.localId;

  it("builds purchases including reference-less ones and skipping unknown amounts", () => {
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.orders.length === 2)!.expected).toBe(2000);
    expect(groups.find((g) => g.refDigits === null)!.memo).toBe("MT-NOREF");
  });

  it("accepts valid suggestions and expands a purchase to all its orders", () => {
    const { accepted, discarded } = validateSuggestions(
      {
        suggestions: [
          { bankRowIndex: 6, groupIds: [idOf("x2")], confidence: "media", reason: "Ref con un dígito distinto" },
          { bankRowIndex: 5, groupIds: [idOf("x1")], confidence: "alta", reason: "Monto y nombre" },
        ],
      },
      rows,
      groups,
      "pago_movil",
    );
    expect(discarded).toBe(0);
    expect(accepted.map((s) => s.confidence)).toEqual(["alta", "media"]);
    expect(accepted[1].orders.map((o) => o.orderId).sort()).toEqual(["x2", "x3"]);
  });

  it("discards unknown ids, reused rows/groups, bad confidence and out-of-tolerance amounts", () => {
    const g1 = idOf("x1");
    const { accepted, discarded } = validateSuggestions(
      {
        suggestions: [
          { bankRowIndex: 5, groupIds: ["x1"], confidence: "alta", reason: "id real inventado" },
          { bankRowIndex: 99, groupIds: [g1], confidence: "alta", reason: "fila inexistente" },
          { bankRowIndex: 5, groupIds: [g1], confidence: "segura", reason: "" },
          { bankRowIndex: 7, groupIds: [g1], confidence: "alta", reason: "pago parcial" },
          { bankRowIndex: 5, groupIds: [g1], confidence: "alta", reason: "ok" },
          { bankRowIndex: 5, groupIds: [idOf("x2")], confidence: "alta", reason: "fila repetida" },
          { bankRowIndex: 6, groupIds: [g1], confidence: "alta", reason: "grupo repetido" },
        ],
      },
      rows,
      groups,
      "pago_movil",
    );
    expect(accepted).toHaveLength(1);
    expect(discarded).toBe(6);
  });

  it("accepts within 5% and rejects beyond", () => {
    const g = idOf("x1"); // 730
    const ok = validateSuggestions({ suggestions: [{ bankRowIndex: 5, groupIds: [g], confidence: "media", reason: "" }] },
      [{ ...rows[0], amount: 766 }], groups, "pago_movil");
    expect(ok.accepted).toHaveLength(1);
    const bad = validateSuggestions({ suggestions: [{ bankRowIndex: 5, groupIds: [g], confidence: "media", reason: "" }] },
      [{ ...rows[0], amount: 690 }], groups, "pago_movil");
    expect(bad.accepted).toHaveLength(0);
  });

  it("throws on a malformed payload so the route can warn instead of guessing", () => {
    expect(codeOf(() => validateSuggestions({ foo: 1 }, rows, groups, "pago_movil"))).toBe("AI_BAD_OUTPUT");
  });
});
