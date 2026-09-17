/**
 * Pure logic for the "Extras" feature (concerts only).
 *
 * An extra is something on top of the entry itself: a t-shirt, a drinks combo, a
 * complimentary drink, valet parking. There are two ways to hold one, and they
 * differ in WHO the entitlement belongs to:
 *
 *   - included  -> per TICKET/QR. The ticket type declares "VIP includes 1
 *                  drink", so every order of that type is born with the right.
 *                  In area tickets each companion QR gets its own.
 *   - purchased -> per CHECKOUT. The buyer picks quantities once at checkout and
 *                  they form a pool that ANY QR of that checkout can redeem.
 *
 * The remaining balance is NEVER stored. It is always
 * `total entitlement - COUNT(extraRedemptions rows of the pool)`, which is what
 * makes a redemption safe to retry and impossible to double-spend.
 */

/** Order statuses that no longer hold anything: they free stock and entitlements. */
export const DEAD_ORDER_STATUSES = ["rejected", "cancelled"] as const;

export function isLiveOrderStatus(status: string | undefined): boolean {
  return !!status && !DEAD_ORDER_STATUSES.includes(status as "rejected");
}

export type ExtraSource = "included" | "purchased";

export type ExtraCatalogEntry = {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock?: number;
  active?: boolean;
  purchasable?: boolean;
  sortOrder?: number;
};

export type ExtraRedemptionRow = {
  id?: string;
  poolKey: string;
  unitIndex: number;
  source?: string;
  redeemedAt?: number;
  redeemedByEmail?: string;
};

export type IncludedExtraLink = {
  includedQty: number;
  extra?: ExtraCatalogEntry | ExtraCatalogEntry[] | null;
};

export type PurchasedExtraItem = {
  id?: string;
  quantity: number;
  unitPriceSnapshot?: number;
  subtotalSnapshot?: number;
  extraNameSnapshot?: string;
  extra?: ExtraCatalogEntry | ExtraCatalogEntry[] | null;
};

/** The Admin SDK returns has-one relations as arrays at runtime. */
export function unwrapOne<T>(rel: unknown): T | undefined {
  return (Array.isArray(rel) ? rel[0] : rel) as T | undefined;
}

// ── Pool keys ──────────────────────────────────────────────────────────────
// The key identifies WHICH counter a redemption belongs to, and is what the
// deterministic row id is derived from. Changing these strings invalidates
// every existing balance, so they are versioned by construction (the prefix).

export function poolKeyIncluded(orderId: string, extraId: string): string {
  return `inc:${orderId}:${extraId}`;
}

export function poolKeyPurchased(groupId: string, extraId: string): string {
  return `grp:${groupId}:${extraId}`;
}

export function poolKeyFor(
  source: ExtraSource,
  ownerId: string,
  extraId: string,
): string {
  return source === "included"
    ? poolKeyIncluded(ownerId, extraId)
    : poolKeyPurchased(ownerId, extraId);
}

// ── Stock ──────────────────────────────────────────────────────────────────

export type SoldItemShape = {
  quantity: number;
  group?:
    | { orders?: { status?: string }[] }
    | { orders?: { status?: string }[] }[]
    | null;
};

/**
 * Units of an extra already committed to buyers. A line counts while at least
 * one order of its checkout is still alive: rejecting or cancelling the whole
 * purchase gives the stock back.
 */
export function extraSoldQty(items: SoldItemShape[] | undefined): number {
  if (!items?.length) return 0;
  let sold = 0;
  for (const item of items) {
    const group = unwrapOne<{ orders?: { status?: string }[] }>(item.group);
    const orders = group?.orders ?? [];
    // A group with no orders linked yet (mid-write) is treated as live so we
    // never oversell during the window where the rows are still being created.
    const live = orders.length === 0 || orders.some((o) => isLiveOrderStatus(o.status));
    if (live) sold += item.quantity;
  }
  return sold;
}

/** `Infinity` when the extra has no stock cap. Never negative. */
export function extraAvailableStock(
  extra: { stock?: number | null },
  soldQty: number,
): number {
  if (extra.stock == null) return Infinity;
  return Math.max(0, extra.stock - soldQty);
}

// ── Checkout pricing ───────────────────────────────────────────────────────

export type ExtraSelection = { extraId: string; quantity: number };

export type PricedExtraLine = {
  extraId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

/**
 * Prices a checkout's extra selection against the catalog. Prices always come
 * from the catalog, never from the client — same rule as the ticket price.
 */
export function priceExtraSelection(
  selection: ExtraSelection[],
  catalog: ExtraCatalogEntry[],
): { lines: PricedExtraLine[]; subtotal: number } {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const lines: PricedExtraLine[] = [];
  let subtotal = 0;
  for (const sel of selection) {
    if (!sel || sel.quantity <= 0) continue;
    const extra = byId.get(sel.extraId);
    if (!extra) continue;
    const lineSubtotal = Math.round(extra.price * sel.quantity * 100) / 100;
    lines.push({
      extraId: extra.id,
      name: extra.name,
      quantity: sel.quantity,
      unitPrice: extra.price,
      subtotal: lineSubtotal,
    });
    subtotal += lineSubtotal;
  }
  return { lines, subtotal: Math.round(subtotal * 100) / 100 };
}

// ── Entitlements ───────────────────────────────────────────────────────────

export type Entitlement = {
  extraId: string;
  name: string;
  source: ExtraSource;
  poolKey: string;
  total: number;
  redeemed: number;
  remaining: number;
};

/**
 * Everything the person holding THIS QR can still redeem: the extras included
 * with their own ticket plus the pool bought by their checkout. Purchased lines
 * are labelled as shared so the scanner can say "1 de 2 del grupo".
 */
export function buildEntitlements(args: {
  orderId: string;
  includedLinks?: IncludedExtraLink[];
  group?: { id: string; items?: PurchasedExtraItem[] } | null;
  redemptions: ExtraRedemptionRow[];
}): Entitlement[] {
  const redeemedByPool = new Map<string, number>();
  for (const r of args.redemptions) {
    redeemedByPool.set(r.poolKey, (redeemedByPool.get(r.poolKey) ?? 0) + 1);
  }

  const out: Entitlement[] = [];

  const push = (
    extraId: string,
    name: string,
    source: ExtraSource,
    ownerId: string,
    total: number,
  ) => {
    if (total <= 0) return;
    const poolKey = poolKeyFor(source, ownerId, extraId);
    const redeemed = Math.min(total, redeemedByPool.get(poolKey) ?? 0);
    out.push({
      extraId,
      name,
      source,
      poolKey,
      total,
      redeemed,
      remaining: total - redeemed,
    });
  };

  for (const link of args.includedLinks ?? []) {
    const extra = unwrapOne<ExtraCatalogEntry>(link.extra);
    if (!extra) continue;
    push(extra.id, extra.name, "included", args.orderId, link.includedQty);
  }

  if (args.group) {
    for (const item of args.group.items ?? []) {
      const extra = unwrapOne<ExtraCatalogEntry>(item.extra);
      const extraId = extra?.id;
      if (!extraId) continue;
      const name = extra?.name || item.extraNameSnapshot || "";
      push(extraId, name, "purchased", args.group.id, item.quantity);
    }
  }

  return out;
}

/** The lowest `count` unit indices not yet taken in a pool. */
export function freeUnitIndices(
  taken: Iterable<number>,
  total: number,
  count: number,
): number[] {
  const used = new Set(taken);
  const free: number[] = [];
  for (let i = 0; i < total && free.length < count; i++) {
    if (!used.has(i)) free.push(i);
  }
  return free;
}
