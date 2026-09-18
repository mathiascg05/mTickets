// Candidatas para el paso de sugerencias y validacion server-side de lo que
// devuelve el modelo. Puro. El modelo solo ve ids locales ("g1", "g2"...):
// nunca ids reales, y nada de lo que devuelve se usa sin pasar por aqui.
import { ReconcileAiError } from "./errors";
import { normalizeMemos } from "./movements";
import {
  bankLast4,
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

// Pagos parciales PROHIBIDOS: por debajo del esperado solo se tolera ruido de
// redondeo/tasa (1%); por encima, hasta 5% (el comprador redondeo hacia
// arriba o uso otra tasa). La diferencia siempre se muestra.
export const SUGGESTION_UNDERPAY_RATIO = 0.01;
export const SUGGESTION_OVERPAY_RATIO = 0.05;

/** ¿El monto del banco cubre el esperado dentro de la tolerancia asimetrica? */
export function withinSuggestionTolerance(bankAmount: number, expected: number): boolean {
  const difference = bankAmount - expected;
  return difference >= 0
    ? difference <= expected * SUGGESTION_OVERPAY_RATIO + 1e-9
    : -difference <= expected * SUGGESTION_UNDERPAY_RATIO + 1e-9;
}
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

// ── Candidatas por movimiento ───────────────────────────────────────────────
// El modelo economico no es fiable buscando entre TODAS las compras a la vez
// (en pruebas reales alternaba que pareos encontraba). El server preselecciona
// por monto (la misma tolerancia que luego valida) y precalcula las senales;
// el modelo solo elige entre pocas opciones y explica por que.

export type RowCandidate = {
  id: string;
  groupIds: string[];
  names: string[];
  expected: number;
  difference: number;
  /** Palabras del nombre del comprador que aparecen en el concepto. */
  nameMatches: number;
  /** Posiciones distintas entre los ultimos 4 del banco y los de la compra. */
  digitsDiff: number | null;
  /** Los 4 digitos del comprador aparecen en otra parte de la referencia del
   * banco (ej. tecleo los PRIMEROS 4 en vez de los ultimos). */
  digitsElsewhere: boolean;
  memoInConcept: boolean;
  memo: string | null;
  reference: string | null;
  date: string | null;
};

export type RowWithCandidates = { row: SuggestRow; candidates: RowCandidate[] };

const MAX_CANDIDATES_PER_ROW = 8;

function normalizeWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3);
}

function hamming(a: string, b: string): number | null {
  if (a.length !== 4 || b.length !== 4) return null;
  let d = 0;
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function buildRowCandidates(
  rows: SuggestRow[],
  groups: CandidateGroup[],
  type: ReconcilePaymentType,
): RowWithCandidates[] {
  // Combinaciones de 2 compras del mismo comprador (mismo nombre): una sola
  // transferencia que cubre dos checkouts.
  const combos: CandidateGroup[][] = groups.map((g) => [g]);
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groups[i].names.some((n) => groups[j].names.includes(n))) {
        combos.push([groups[i], groups[j]]);
      }
    }
  }

  const result: RowWithCandidates[] = [];
  for (const row of rows) {
    const concept = normalizeMemos(`${row.description ?? ""} ${row.reference ?? ""}`);
    const conceptWords = new Set(normalizeWords(concept));
    const conceptUpper = concept.toUpperCase();
    const rowLast4 = type === "pago_movil" && row.reference ? bankLast4(row.reference) : "";
    const rowDigits = type === "pago_movil" && row.reference ? row.reference.replace(/\D/g, "") : "";
    const candidates: RowCandidate[] = [];
    for (const combo of combos) {
      const expected = round2(combo.reduce((sum, g) => sum + g.expected, 0));
      const difference = round2(row.amount - expected);
      if (!withinSuggestionTolerance(row.amount, expected)) continue;
      const names = Array.from(new Set(combo.flatMap((g) => g.names)));
      const nameMatches = Math.max(
        ...names.map((n) => normalizeWords(n).filter((w) => conceptWords.has(w)).length),
      );
      const refs = combo.map((g) => g.refDigits).filter((r): r is string => !!r);
      const digitsDiff =
        combo.length === 1 && rowLast4 && refs[0] ? hamming(rowLast4, refs[0]) : null;
      const digitsElsewhere =
        combo.length === 1 && !!refs[0] && refs[0].length === 4 && digitsDiff !== 0 &&
        rowDigits.slice(0, -4).includes(refs[0]);
      const memos = combo.map((g) => g.memo).filter((m): m is string => !!m);
      candidates.push({
        id: "",
        groupIds: combo.map((g) => g.localId),
        names,
        expected,
        difference,
        nameMatches,
        digitsDiff,
        digitsElsewhere,
        memoInConcept: memos.some((m) => conceptUpper.includes(m)),
        memo: memos[0] ?? null,
        reference: refs[0] ?? null,
        date: combo[0].createdAt ? new Date(combo[0].createdAt).toISOString().slice(0, 10) : null,
      });
    }
    if (candidates.length === 0) continue;
    // Las mas prometedoras primero: memo, nombre, digitos, cercania de monto.
    candidates.sort(
      (a, b) =>
        Number(b.memoInConcept) - Number(a.memoInConcept) ||
        b.nameMatches - a.nameMatches ||
        Number(b.digitsElsewhere) - Number(a.digitsElsewhere) ||
        (a.digitsDiff ?? 5) - (b.digitsDiff ?? 5) ||
        Math.abs(a.difference) - Math.abs(b.difference),
    );
    result.push({
      row,
      candidates: candidates
        .slice(0, MAX_CANDIDATES_PER_ROW)
        .map((c, i) => ({ ...c, id: `r${row.index}c${i + 1}` })),
    });
  }
  return result;
}

/**
 * Traduce la eleccion del modelo ({bankRowIndex, candidateId}) al formato
 * {bankRowIndex, groupIds} que valida validateSuggestions. Un candidateId que
 * no pertenece a ESA fila se traduce a groupIds vacio y se descarta.
 */
export function resolveCandidateChoices(
  raw: unknown,
  withCandidates: RowWithCandidates[],
): unknown {
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return raw;
  const byRow = new Map(withCandidates.map((w) => [w.row.index, w.candidates]));
  return {
    suggestions: list.map((item) => {
      const s = (item ?? {}) as Record<string, unknown>;
      const candidate = byRow
        .get(s.bankRowIndex as number)
        ?.find((c) => c.id === s.candidateId);
      return { ...s, groupIds: candidate ? candidate.groupIds : [] };
    }),
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

  // Las de confianza alta primero: una "media" no debe bloquear a una "alta"
  // que comparte fila o compra.
  const ordered = list
    .slice(0, MAX_SUGGEST_ROWS)
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const rank = (x: unknown) => ((x as { confidence?: unknown })?.confidence === "alta" ? 0 : 1);
      return rank(a.item) - rank(b.item) || a.i - b.i;
    })
    .map((x) => x.item);
  for (const item of ordered) {
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
    if (!withinSuggestionTolerance(row.amount, expected)) {
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
