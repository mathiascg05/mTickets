// Matching determinista de pagos contra un extracto bancario. Modulo puro (sin
// DB) compartido por /api/reconcile-csv y /api/reconcile-ai.
//
// Formato de proofReferenceNumber que escribe el checkout (buy/[ticketTypeId]):
//   - Zelle:      "MT-XXXXX"          (el memo, siempre)
//   - Pago Movil: "MT-XXXXX-1234"     (memo + ultimos 4 digitos tecleados)
//                 "MT-XXXXX-"         (el metodo no pidio referencia)
// Todas las ordenes de un checkout comparten la misma referencia.

export type ReconcilePaymentType = "pago_movil" | "zelle";

export type BankRow = {
  /** Posicion de la fila en el extracto; identifica la fila en la respuesta. */
  index: number;
  /** Pago Movil: la referencia. Zelle: el texto donde buscar el memo. */
  reference: string;
  amount: number;
};

export type TicketTypeInfo = {
  price: number;
  feePercent?: number;
  feeFixed?: number;
  phases?: { id: string; price: number }[];
};

export type ReconcileOrder = {
  id: string;
  orderNumber?: string;
  firstName: string;
  lastName: string;
  paymentMethod: string;
  proofReferenceNumber?: string;
  purchaseAmountBs?: number;
  extrasAmountBs?: number;
  totalSnapshot?: number;
  discountAmount?: number;
  paymentMethodDiscount?: number;
  phaseId?: string;
  ticketType?: TicketTypeInfo | null;
};

export type MatchedOrder = {
  orderId: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  orderRef: string;
  orderAmount: number;
  currency: "USD" | "BS";
  csvRef: string;
  csvAmount: number;
  rowIndex: number;
};

export type UnmatchedCode =
  | "REF_TOO_SHORT"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "NO_MEMO"
  | "MEMO_ALREADY_USED"
  | "AMOUNT_MISMATCH";

export type UnmatchedRow = {
  csvRef: string;
  csvAmount: number;
  reason: string;
  code: UnmatchedCode;
  /** Solo AMOUNT_MISMATCH: el total que se esperaba. */
  expectedAmount?: number;
  rowIndex: number;
};

export type MatchResult = {
  matched: MatchedOrder[];
  unmatched: UnmatchedRow[];
  /** Ordenes pendientes que el matcher considero (para el contador de la UI). */
  totalPending: number;
  /** Referencias (proofReferenceNumber) de los grupos conciliados. */
  matchedRefs: Set<string>;
};

export const PAGO_MOVIL_TOLERANCE_BS = 0.5;
export const ZELLE_TOLERANCE_USD_PER_ORDER = 0.01;

// Absorbe ruido de punto flotante en el borde de la tolerancia
// (165.03 - 165 = 0.030000000000001137).
const EPS = 1e-9;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Digitos que tecleo el comprador: el ultimo segmento tras "-". */
export function pmRefDigits(ref: string): string {
  const parts = ref.split("-");
  return parts[parts.length - 1] || "";
}

/** Ultimos 4 digitos de la referencia del banco. */
export function bankLast4(ref: string): string {
  return ref.replace(/\D/g, "").slice(-4);
}

export function extractMemoCode(text: string): string | null {
  const match = text.match(/MT-[A-Z0-9]{5}/);
  return match ? match[0] : null;
}

/**
 * Recalculo en vivo del monto USD de UNA orden desde su ticketType. Solo para
 * ordenes legacy creadas antes de los snapshots: no conoce extras ni el fee del
 * metodo de pago, y se descuadra si cambian los precios.
 */
export function getExpectedUsdAmount(
  order: { discountAmount?: number; paymentMethodDiscount?: number; phaseId?: string },
  ticketType: TicketTypeInfo,
): number {
  let price = ticketType.price;
  if (order.phaseId && ticketType.phases) {
    const phase = ticketType.phases.find((p) => p.id === order.phaseId);
    if (phase) price = phase.price;
  }
  // Include organizer fees (these are charged to the buyer)
  const feePercent = ticketType.feePercent ?? 0;
  const feeFixed = ticketType.feeFixed ?? 0;
  const fee = (price * feePercent) / 100 + feeFixed;
  // discountAmount and paymentMethodDiscount on each order are already PER-TICKET
  // (stored per order row at purchase time), so use them directly.
  const perOrderDiscount = order.discountAmount || 0;
  const perOrderPmDiscount = order.paymentMethodDiscount || 0;
  return round2(price + fee - perOrderDiscount - perOrderPmDiscount);
}

/**
 * Monto USD que el comprador debia transferir por esta orden. Prefiere
 * totalSnapshot (fijado al comprar; en la orden ancla ya incluye los extras y
 * en las companions de un area es 0). Solo las ordenes legacy sin snapshot
 * caen al recalculo en vivo. null = no hay forma de saberlo.
 */
export function expectedOrderUsd(order: ReconcileOrder): number | null {
  if (order.totalSnapshot != null) return round2(order.totalSnapshot);
  if (!order.ticketType) return null;
  return getExpectedUsdAmount(order, order.ticketType);
}

/** Monto Bs por orden: la entrada + los extras del checkout (solo en la ancla). */
export function expectedOrderBs(order: ReconcileOrder): number {
  return round2((order.purchaseAmountBs ?? 0) + (order.extrasAmountBs ?? 0));
}

/**
 * Total esperado de un grupo de ordenes (una transferencia). null si alguna
 * orden no tiene monto conocido (Zelle legacy sin ticketType) o si, en Pago
 * Movil, ninguna orden del grupo tiene monto en Bs.
 */
export function expectedGroupAmount(
  group: ReconcileOrder[],
  type: ReconcilePaymentType,
): number | null {
  if (type === "pago_movil") {
    if (!group.some((o) => o.purchaseAmountBs != null)) return null;
    return round2(group.reduce((sum, o) => sum + expectedOrderBs(o), 0));
  }
  let total = 0;
  for (const o of group) {
    const amount = expectedOrderUsd(o);
    if (amount == null) return null;
    total += amount;
  }
  return round2(total);
}

/** Agrupa por proofReferenceNumber completo (una referencia = un checkout). */
export function groupByReference(
  orders: ReconcileOrder[],
): Map<string, ReconcileOrder[]> {
  const groups = new Map<string, ReconcileOrder[]>();
  for (const o of orders) {
    const ref = o.proofReferenceNumber;
    if (!ref) continue;
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref)!.push(o);
  }
  return groups;
}

/**
 * Grupos de ordenes pendientes del metodo que el matcher determinista puede
 * conciliar. Pago Movil: el grupo entra si alguna orden trae purchaseAmountBs;
 * las companions de un area (sin monto propio) viajan dentro de su grupo para
 * aprobarse junto con la primary. Zelle: se descartan las ordenes cuyo monto
 * no se puede determinar.
 */
export function reconcilableGroups(
  pendingOrders: ReconcileOrder[],
  type: ReconcilePaymentType,
  methodNames: string[],
): Map<string, ReconcileOrder[]> {
  const ofMethod = pendingOrders.filter(
    (o) => methodNames.includes(o.paymentMethod) && o.proofReferenceNumber,
  );
  if (type === "pago_movil") {
    const groups = groupByReference(ofMethod);
    for (const [ref, group] of groups) {
      if (!group.some((o) => o.purchaseAmountBs != null)) groups.delete(ref);
    }
    return groups;
  }
  return groupByReference(
    ofMethod.filter((o) => expectedOrderUsd(o) != null),
  );
}

function countOrders(groups: Map<string, ReconcileOrder[]>): number {
  let n = 0;
  for (const g of groups.values()) n += g.length;
  return n;
}

export function matchPagoMovil(
  rows: BankRow[],
  groups: Map<string, ReconcileOrder[]>,
): MatchResult {
  const matched: MatchedOrder[] = [];
  const unmatched: UnmatchedRow[] = [];
  const matchedRefs = new Set<string>();

  for (const row of rows) {
    const rowLast4 = bankLast4(row.reference);
    if (!rowLast4 || rowLast4.length < 4) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Referencia muy corta",
        code: "REF_TOO_SHORT",
        rowIndex: row.index,
      });
      continue;
    }

    const candidates: { ref: string; group: ReconcileOrder[] }[] = [];
    for (const [ref, group] of groups) {
      if (matchedRefs.has(ref)) continue;
      if (pmRefDigits(ref) !== rowLast4) continue;
      // Los extras van en la orden ancla y forman parte de la MISMA
      // transferencia, asi que entran en el total del grupo.
      const groupTotal = expectedGroupAmount(group, "pago_movil");
      if (groupTotal == null) continue;
      if (Math.abs(groupTotal - row.amount) <= PAGO_MOVIL_TOLERANCE_BS + EPS) {
        candidates.push({ ref, group });
      }
    }

    if (candidates.length === 1) {
      const { ref, group } = candidates[0];
      matchedRefs.add(ref);
      for (const order of group) {
        matched.push({
          orderId: order.id,
          orderNumber: order.orderNumber || "---",
          firstName: order.firstName,
          lastName: order.lastName,
          orderRef: ref,
          orderAmount: order.purchaseAmountBs ?? 0,
          currency: "BS",
          csvRef: row.reference,
          csvAmount: row.amount,
          rowIndex: row.index,
        });
      }
    } else if (candidates.length > 1) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: `Multiples coincidencias (${candidates.length} grupos)`,
        code: "AMBIGUOUS",
        rowIndex: row.index,
      });
    } else {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Sin coincidencia",
        code: "NO_MATCH",
        rowIndex: row.index,
      });
    }
  }

  return { matched, unmatched, totalPending: countOrders(groups), matchedRefs };
}

export function matchZelle(
  rows: BankRow[],
  groups: Map<string, ReconcileOrder[]>,
): MatchResult {
  const matched: MatchedOrder[] = [];
  const unmatched: UnmatchedRow[] = [];
  const matchedRefs = new Set<string>();

  for (const row of rows) {
    const memoCode = extractMemoCode(row.reference);
    if (!memoCode) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "No se encontró código memo (MT-XXXXX)",
        code: "NO_MEMO",
        rowIndex: row.index,
      });
      continue;
    }

    if (matchedRefs.has(memoCode)) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Memo ya conciliado en esta sesión",
        code: "MEMO_ALREADY_USED",
        rowIndex: row.index,
      });
      continue;
    }

    const group = groups.get(memoCode);
    const groupTotal = group?.length ? expectedGroupAmount(group, "zelle") : null;
    if (!group || group.length === 0 || groupTotal == null) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Sin coincidencia",
        code: "NO_MATCH",
        rowIndex: row.index,
      });
      continue;
    }

    const tolerance = ZELLE_TOLERANCE_USD_PER_ORDER * group.length;
    if (Math.abs(groupTotal - row.amount) <= tolerance + EPS) {
      matchedRefs.add(memoCode);
      for (const order of group) {
        matched.push({
          orderId: order.id,
          orderNumber: order.orderNumber || "---",
          firstName: order.firstName,
          lastName: order.lastName,
          orderRef: memoCode,
          orderAmount: expectedOrderUsd(order) ?? 0,
          currency: "USD",
          csvRef: row.reference,
          csvAmount: row.amount,
          rowIndex: row.index,
        });
      }
    } else {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: `Monto no coincide (esperado: $${groupTotal.toFixed(2)})`,
        code: "AMOUNT_MISMATCH",
        expectedAmount: groupTotal,
        rowIndex: row.index,
      });
    }
  }

  return { matched, unmatched, totalPending: countOrders(groups), matchedRefs };
}

export function runDeterministicMatch(
  type: ReconcilePaymentType,
  rows: BankRow[],
  pendingOrders: ReconcileOrder[],
  methodNames: string[],
): MatchResult {
  const groups = reconcilableGroups(pendingOrders, type, methodNames);
  return type === "zelle" ? matchZelle(rows, groups) : matchPagoMovil(rows, groups);
}

/**
 * Normaliza una orden del admin SDK (has-one llega como array) al shape del
 * matcher.
 */
export function toReconcileOrder(raw: Record<string, unknown>): ReconcileOrder {
  const rawTT = raw.ticketType as unknown;
  const tt = (Array.isArray(rawTT) ? rawTT[0] : rawTT) as TicketTypeInfo | undefined;
  return {
    ...(raw as unknown as ReconcileOrder),
    ticketType: tt ?? null,
  };
}
