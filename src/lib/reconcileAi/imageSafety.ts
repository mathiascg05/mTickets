// Salvaguarda para extractos leidos de IMAGEN (capturas, fotos, PDFs
// escaneados), donde un digito puede leerse mal de forma consistente. Si una
// referencia leida calza exacto pero existe OTRA compra pendiente del mismo
// monto a un solo digito/caracter de distancia, no se puede saber cual pago
// es: el pareo baja de "exacto" a revision humana.
import {
  bankLast4,
  expectedGroupAmount,
  extractMemoCode,
  pmRefDigits,
  PAGO_MOVIL_TOLERANCE_BS,
  ZELLE_TOLERANCE_USD_PER_ORDER,
  type BankRow,
  type MatchedOrder,
  type ReconcileOrder,
  type ReconcilePaymentType,
} from "@/lib/reconcile";

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Filas conciliadas exacto cuya identidad tiene un "vecino" ambiguo. */
export function ambiguousExactRows(
  matched: MatchedOrder[],
  rows: BankRow[],
  groups: Map<string, ReconcileOrder[]>,
  type: ReconcilePaymentType,
): Set<number> {
  const rowByIndex = new Map(rows.map((r) => [r.index, r]));
  const matchedRefByRow = new Map<number, string>();
  for (const m of matched) matchedRefByRow.set(m.rowIndex, m.orderRef);

  const ambiguous = new Set<number>();
  for (const [rowIndex, ownRef] of matchedRefByRow) {
    const row = rowByIndex.get(rowIndex);
    if (!row) continue;
    const readKey = type === "zelle" ? extractMemoCode(row.reference) ?? "" : bankLast4(row.reference);
    for (const [ref, group] of groups) {
      if (ref === ownRef) continue;
      const key = type === "zelle" ? ref : pmRefDigits(ref);
      if (!key || hamming(readKey, key) > 1) continue;
      const expected = expectedGroupAmount(group, type);
      if (expected == null) continue;
      const tolerance =
        type === "zelle" ? ZELLE_TOLERANCE_USD_PER_ORDER * group.length : PAGO_MOVIL_TOLERANCE_BS;
      if (Math.abs(expected - row.amount) <= tolerance + 1e-9) {
        ambiguous.add(rowIndex);
        break;
      }
    }
  }
  return ambiguous;
}
