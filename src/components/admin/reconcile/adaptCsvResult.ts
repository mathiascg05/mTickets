// Convierte la respuesta de /api/reconcile-csv (matcher determinista) al
// modelo de la pantalla de revision, para que ambos caminos compartan UNA sola
// pantalla. Puro.
import type { CsvRow } from "./sheet";
import type { Bank, Exact, PaymentType, ReviewResult } from "./types";

export type CsvApiResponse = {
  matched: {
    orderId: string;
    orderNumber: string;
    firstName: string;
    lastName: string;
    orderRef: string;
    orderAmount: number;
    rowIndex: number;
  }[];
  unmatched: { code?: string; expectedAmount?: number; rowIndex: number }[];
  totalPending: number;
};

export function adaptCsvResult(
  res: CsvApiResponse,
  rows: CsvRow[],
  ignored: number,
  paymentType: PaymentType,
): ReviewResult {
  const bank = (rowIndex: number): Bank => ({
    rowIndex,
    date: null,
    description: null,
    reference: rows[rowIndex]?.reference ?? null,
    amount: rows[rowIndex]?.amount ?? 0,
  });

  const byRow = new Map<number, Exact>();
  for (const m of res.matched) {
    if (!byRow.has(m.rowIndex)) byRow.set(m.rowIndex, { bank: bank(m.rowIndex), orders: [] });
    byRow.get(m.rowIndex)!.orders.push({
      orderId: m.orderId,
      orderNumber: m.orderNumber,
      name: `${m.firstName} ${m.lastName}`.trim(),
      reference: m.orderRef,
      amount: m.orderAmount,
    });
  }

  return {
    source: "csv",
    paymentType,
    currency: paymentType === "zelle" ? "USD" : "BS",
    exactos: Array.from(byRow.values()).sort((a, b) => a.bank.rowIndex - b.bank.rowIndex),
    sugerencias: [],
    posiblesLotes: [],
    sinMatch: res.unmatched.map((u) => ({
      bank: bank(u.rowIndex),
      code: u.code ?? "NO_MATCH",
      expectedAmount: u.expectedAmount ?? null,
    })),
    ordenesSinMatch: [],
    pendingLeft: Math.max(0, res.totalPending - res.matched.length),
    counts: {
      credits: rows.length,
      creditsTotal: Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100,
      debitsIgnored: ignored,
    },
    warnings: [],
  };
}
