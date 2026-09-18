// Detecta movimientos que parecen pagos de lotes (ticketAllotments). Los lotes
// no son ordenes y su aprobacion tiene flujo propio: esto solo ETIQUETA.
import { bankLast4, type ReconcilePaymentType } from "@/lib/reconcile";

export type AllotmentCandidate = {
  id: string;
  schoolName: string;
  status: string;
  totalPrice: number;
  ticketCount: number;
  purchaseAmountBs?: number;
  proofReferenceNumber?: string;
};

export type AllotmentMatchReason = "reference_and_amount" | "reference" | "amount";

export type AllotmentMatch = {
  rowIndex: number;
  allotmentId: string;
  schoolName: string;
  ticketCount: number;
  expectedAmount: number | null;
  reason: AllotmentMatchReason;
};

// Solo lotes cuyo pago aun no se aprobo.
export const OPEN_ALLOTMENT_STATUSES = ["pending", "submitted"];
const AMOUNT_TOLERANCE_RATIO = 0.01;

type Row = { index: number; amount: number; reference: string | null; description: string | null };

export function allotmentExpectedAmount(
  a: AllotmentCandidate,
  type: ReconcilePaymentType,
): number | null {
  if (type === "zelle") return a.totalPrice > 0 ? a.totalPrice : null;
  return a.purchaseAmountBs != null && a.purchaseAmountBs > 0 ? a.purchaseAmountBs : null;
}

function referenceMatches(a: AllotmentCandidate, row: Row): boolean {
  const ref = a.proofReferenceNumber?.trim();
  if (!ref) return false;
  const digits = ref.replace(/\D/g, "");
  if (digits.length >= 4) {
    const rowLast4 = bankLast4(row.reference ?? "");
    if (rowLast4.length === 4 && digits.slice(-4) === rowLast4) return true;
  }
  // Referencia alfanumerica (ej. confirmacion Zelle) escrita en el concepto.
  if (ref.length >= 6) {
    const haystack = `${row.description ?? ""} ${row.reference ?? ""}`.toUpperCase();
    if (haystack.includes(ref.toUpperCase())) return true;
  }
  return false;
}

/**
 * Para cada fila, el mejor lote abierto que la explica (referencia y/o monto).
 * Un lote se asigna a una sola fila, priorizando las coincidencias mas fuertes.
 */
export function matchAllotments(
  rows: Row[],
  allotments: AllotmentCandidate[],
  type: ReconcilePaymentType,
): AllotmentMatch[] {
  const open = allotments.filter((a) => OPEN_ALLOTMENT_STATUSES.includes(a.status));
  const scored: (AllotmentMatch & { score: number })[] = [];

  for (const row of rows) {
    for (const a of open) {
      const expected = allotmentExpectedAmount(a, type);
      const amountOk =
        expected != null &&
        Math.abs(row.amount - expected) <= Math.max(expected * AMOUNT_TOLERANCE_RATIO, 0.01);
      const refOk = referenceMatches(a, row);
      if (!amountOk && !refOk) continue;
      const reason: AllotmentMatchReason =
        amountOk && refOk ? "reference_and_amount" : refOk ? "reference" : "amount";
      scored.push({
        rowIndex: row.index,
        allotmentId: a.id,
        schoolName: a.schoolName,
        ticketCount: a.ticketCount,
        expectedAmount: expected,
        reason,
        score: reason === "reference_and_amount" ? 3 : reason === "reference" ? 2 : 1,
      });
    }
  }

  scored.sort((x, y) => y.score - x.score);
  const usedRows = new Set<number>();
  const usedAllotments = new Set<string>();
  const result: AllotmentMatch[] = [];
  for (const s of scored) {
    if (usedRows.has(s.rowIndex) || usedAllotments.has(s.allotmentId)) continue;
    usedRows.add(s.rowIndex);
    usedAllotments.add(s.allotmentId);
    result.push({
      rowIndex: s.rowIndex,
      allotmentId: s.allotmentId,
      schoolName: s.schoolName,
      ticketCount: s.ticketCount,
      expectedAmount: s.expectedAmount,
      reason: s.reason,
    });
  }
  return result.sort((x, y) => x.rowIndex - y.rowIndex);
}
