import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin, SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import {
  getOrderTotal,
  getPlatformFeeForOrder,
  type OrderPricing,
  type PlatformFeeOrderShape,
  type TicketTypePricing,
} from "@/lib/order-pricing";

// Platform-wide stats derived from ORDERS, computed on the server with the
// admin SDK (the equivalent nested client query does not reliably deliver
// thousands of order rows to the browser).
//
// Performance: the nested query concerts→ticketTypes→orders takes ~6s for
// ~2000 orders. Instead we run two FLAT queries in parallel — light concerts
// (no orders) for metadata, and status-filtered top-level orders — and join in
// memory. That cuts the endpoint to ~1.8s.

type OrderRow = OrderPricing &
  PlatformFeeOrderShape & {
    id: string;
    status: string;
    createdAt: number;
    ticketType?: unknown;
  };

type TicketTypePricingRow = TicketTypePricing & { id: string };

type FeeConfig = {
  billingMode?: string;
  feePercent?: number;
  feeFixed?: number;
  allowOverdraft?: boolean;
};

type ConcertRow = {
  id: string;
  status: string;
  organizerEmail: string;
  isDemo?: boolean;
  platformFeeConfig: unknown;
  ticketTypes: TicketTypePricingRow[];
};

export async function GET(req: NextRequest) {
  try {
    const authToken = req.headers
      .get("authorization")
      ?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const from = fromParam
      ? new Date(fromParam + "T00:00:00").getTime()
      : null;
    const to = toParam ? new Date(toParam + "T23:59:59").getTime() : null;
    const inPeriod = (ts: number) =>
      (from === null || ts >= from) && (to === null || ts <= to);

    // Two flat queries in parallel: light concert/ticketType metadata, and
    // status-filtered orders (we only need pending + approved).
    const [{ concerts }, { orders }] = await Promise.all([
      adminDb.query({
        concerts: { platformFeeConfig: {}, ticketTypes: { phases: {} } },
      }) as Promise<{ concerts: ConcertRow[] }>,
      adminDb.query({
        orders: {
          $: { where: { status: { $in: ["pending", "approved"] } } },
          ticketType: {},
        },
      }) as Promise<{ orders: OrderRow[] }>,
    ]);

    // Concert metadata + per-ticketType pricing maps. Exclude demo events and
    // the super admin's own (internal/test) events.
    const concertById = new Map<
      string,
      {
        status: string;
        cfg: FeeConfig | null | undefined;
        isPostpaidLike: boolean;
      }
    >();
    const ttToConcert = new Map<string, string>();
    const ttPricing = new Map<string, TicketTypePricingRow>();
    for (const c of concerts) {
      if (c.isDemo || c.organizerEmail.toLowerCase() === SUPER_ADMIN_EMAIL) {
        continue;
      }
      const fc = c.platformFeeConfig as unknown;
      const cfg = (Array.isArray(fc) ? fc[0] : fc) as
        | FeeConfig
        | null
        | undefined;
      concertById.set(c.id, {
        status: c.status,
        cfg,
        isPostpaidLike:
          cfg?.billingMode === "postpaid" || cfg?.allowOverdraft === true,
      });
      for (const tt of c.ticketTypes || []) {
        ttToConcert.set(tt.id, c.id);
        ttPricing.set(tt.id, tt);
      }
    }

    let potentialDebt = 0;
    const perEventMap = new Map<
      string,
      { ticketsSold: number; grossRevenue: number }
    >();

    for (const order of orders) {
      const rawTT = order.ticketType as unknown;
      const tt = (Array.isArray(rawTT) ? rawTT[0] : rawTT) as
        | { id: string }
        | undefined;
      if (!tt?.id) continue;
      const concertId = ttToConcert.get(tt.id);
      if (!concertId) continue; // excluded (demo/super admin) or missing
      const concert = concertById.get(concertId);
      if (!concert) continue;
      const pricing = ttPricing.get(tt.id);

      if (order.status === "pending") {
        // Potential Debt snapshot: future debt from pending approvals on
        // non-finalized postpaid/overdraft events.
        if (concert.status === "finalized" || !concert.isPostpaidLike) continue;
        const liveCfg = {
          feePercent: concert.cfg?.feePercent || 0,
          feeFixed: concert.cfg?.feeFixed || 0,
        };
        potentialDebt += getPlatformFeeForOrder(order, pricing, liveCfg);
      } else if (order.status === "approved") {
        if (!inPeriod(order.createdAt)) continue;
        const entry = perEventMap.get(concertId) || {
          ticketsSold: 0,
          grossRevenue: 0,
        };
        entry.ticketsSold += 1;
        entry.grossRevenue += getOrderTotal(order, pricing);
        perEventMap.set(concertId, entry);
      }
    }

    potentialDebt = Math.round(potentialDebt * 100) / 100;
    const perEvent = [...perEventMap.entries()].map(([id, e]) => ({
      id,
      ticketsSold: e.ticketsSold,
      grossRevenue: Math.round(e.grossRevenue * 100) / 100,
    }));

    return NextResponse.json({ potentialDebt, perEvent });
  } catch (err) {
    console.error("[admin/platform-stats] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
