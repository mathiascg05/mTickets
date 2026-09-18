// Candidatas para el paso de sugerencias y validacion server-side de lo que
// devuelve el modelo. Puro. El modelo solo ve ids locales ("g1", "g2"...):
// nunca ids reales, y nada de lo que devuelve se usa sin pasar por aqui.
import { ReconcileAiError } from "./errors";
import {
  expectedGroupAmount,
  expectedOrderBs,
  expectedOrderUsd,
  extractMemoCode,
  pmRefDigits,
  type ReconcileOrder,
  type ReconcilePaymentType,
} from "@/lib/reconcile";

export type SuggestOrder = ReconcileOrder & {
  createdAt?: number;
  idempotencyKey?: string;
  purchaseGroupId?: string;
};

export type SuggestRow = {
  index: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
};

export type CandidateGroup = {
  localId: string;
  orders: SuggestOrder[];
  names: string[];
  refDigits: string | null;
  memo: string | null;
  expected: number;
  createdAt: number | null;
};

export type ValidatedSuggestion = {
  rowIndex: number;
  bankAmount: number;
  expectedAmount: number;
  difference: number;
  confidence: "alta" | "media";
  reason: string;
  orders: {
    orderId: string;
    orderNumber: string;
    name: string;
    reference: string | null;
    amount: number;
  }[];
};

// Tolerancia amplia (ej. el comprador uso otra tasa). La diferencia se muestra.
export const SUGGESTION_TOLERANCE_RATIO = 0.05;
export const MAX_SUGGEST_ROWS = 300;
export const MAX_SUGGEST_GROUPS = 600;
const MAX_GROUPS_PER_SUGGESTION = 4;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Una compra = un checkout. Sin referencia, se agrupa por la submission. */
function groupKey(o: SuggestOrder): string {
  return o.proofReferenceNumber || o.idempotencyKey || o.purchaseGroupId || o.id;
}

export function groupPurchases(orders: SuggestOrder[]): SuggestOrder[][] {
  const byKey = new Map<string, SuggestOrder[]>();
  for (const o of orders) {
    const k = groupKey(o);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(o);
  }
  return Array.from(byKey.values());
}

/**
 * Agrupa las ordenes pendientes sin match (del metodo) en compras, INCLUIDAS
 * las que no tienen digitos de referencia. Se descartan las compras cuyo monto
 * esperado no se conoce. Mas recientes primero; se recorta a MAX_SUGGEST_GROUPS.
 */
export function buildCandidateGroups(
  orders: SuggestOrder[],
  type: ReconcilePaymentType,
): { groups: CandidateGroup[]; truncated: boolean } {
  const groups: Omit<CandidateGroup, "localId">[] = [];
  for (const members of groupPurchases(orders)) {
    const expected = expectedGroupAmount(members, type);
    if (expected == null || expected <= 0) continue;
    const ref = members[0].proofReferenceNumber ?? "";
    const digits = type === "pago_movil" && ref ? pmRefDigits(ref).replace(/\D/g, "") : "";
    const names = Array.from(
      new Set(members.map((o) => `${o.firstName} ${o.lastName}`.trim())),
    ).slice(0, 3);
    const created = members
      .map((o) => o.createdAt)
      .filter((n): n is number => typeof n === "number");
    groups.push({
      orders: members,
      names,
      refDigits: digits || null,
      memo: extractMemoCode(ref),
      expected,
      createdAt: created.length ? Math.min(...created) : null,
    });
  }

  groups.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const truncated = groups.length > MAX_SUGGEST_GROUPS;
  return {
    groups: groups.slice(0, MAX_SUGGEST_GROUPS).map((g, i) => ({ ...g, localId: `g${i + 1}` })),
    truncated,
  };
}

function orderAmount(o: ReconcileOrder, type: ReconcilePaymentType): number {
  return type === "zelle" ? (expectedOrderUsd(o) ?? 0) : expectedOrderBs(o);
}

/**
 * Valida cada sugerencia del modelo contra lo que el server sabe: fila y
 * compras existentes entre las candidatas, sin reutilizar filas ni compras, y
 * monto del conjunto dentro de la tolerancia. Una compra siempre entra
 * completa (todas sus ordenes). Lo que no pasa se descarta.
 */
export function validateSuggestions(
  raw: unknown,
  rows: SuggestRow[],
  groups: CandidateGroup[],
  type: ReconcilePaymentType,
): { accepted: ValidatedSuggestion[]; discarded: number } {
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) throw new ReconcileAiError("AI_BAD_OUTPUT");

  const rowByIndex = new Map(rows.map((r) => [r.index, r]));
  const groupById = new Map(groups.map((g) => [g.localId, g]));
  const usedRows = new Set<number>();
  const usedGroups = new Set<string>();
  const accepted: ValidatedSuggestion[] = [];
  let discarded = 0;

  for (const item of list.slice(0, MAX_SUGGEST_ROWS)) {
    const s = item as Record<string, unknown> | null;
    const rowIndex = s?.bankRowIndex;
    const ids = s?.groupIds;
    const confidence = s?.confidence;
    const row = typeof rowIndex === "number" ? rowByIndex.get(rowIndex) : undefined;
    if (
      !row ||
      usedRows.has(row.index) ||
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_GROUPS_PER_SUGGESTION ||
      new Set(ids).size !== ids.length ||
      (confidence !== "alta" && confidence !== "media")
    ) {
      discarded++;
      continue;
    }
    const picked = ids.map((id) => (typeof id === "string" ? groupById.get(id) : undefined));
    if (picked.some((g) => !g || usedGroups.has(g.localId))) {
      discarded++;
      continue;
    }
    const chosen = picked as CandidateGroup[];
    const expected = round2(chosen.reduce((sum, g) => sum + g.expected, 0));
    const difference = round2(row.amount - expected);
    // Sin pagos parciales ni excesos grandes: fuera de tolerancia no es match.
    if (Math.abs(difference) > expected * SUGGESTION_TOLERANCE_RATIO) {
      discarded++;
      continue;
    }

    usedRows.add(row.index);
    chosen.forEach((g) => usedGroups.add(g.localId));
    accepted.push({
      rowIndex: row.index,
      bankAmount: row.amount,
      expectedAmount: expected,
      difference,
      confidence,
      reason: typeof s?.reason === "string" ? s.reason.replace(/\s+/g, " ").trim().slice(0, 240) : "",
      orders: chosen.flatMap((g) =>
        g.orders.map((o) => ({
          orderId: o.id,
          orderNumber: o.orderNumber || "---",
          name: `${o.firstName} ${o.lastName}`.trim(),
          reference: o.proofReferenceNumber ?? null,
          amount: orderAmount(o, type),
        })),
      ),
    });
  }

  accepted.sort((a, b) =>
    a.confidence === b.confidence ? a.rowIndex - b.rowIndex : a.confidence === "alta" ? -1 : 1,
  );
  return { accepted, discarded };
}
