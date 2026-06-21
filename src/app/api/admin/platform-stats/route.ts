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

// Platform-wide stats that are derived from ORDERS. These must be computed on
// the server with the admin SDK: the equivalent nested client query
// (concerts → ticketTypes → orders) pulls thousands of order rows and does not
// reliably deliver them to the browser, which silently produced a $0
// "Potential Debt". The admin SDK returns the full dataset.
//
// Balance/deposit-derived stats stay client-side (small dataset) in
// SuperAdminStats.

type OrderRow = OrderPricing &
  PlatformFeeOrderShape & {
    status: string;
    createdAt: number;
  };

type TicketTypeRow = TicketTypePricing & {
  id: string;
  orders?: OrderRow[];
};

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
  ticketTypes: TicketTypeRow[];
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

    const { concerts } = (await adminDb.query({
      concerts: {
        platformFeeConfig: {},
        ticketTypes: { orders: {}, phases: {} },
      },
    })) as { concerts: ConcertRow[] };

    // Exclude demo events and the super admin's own (internal/test) events.
    const realConcerts = concerts.filter(
      (c) =>
        !c.isDemo &&
        c.organizerEmail.toLowerCase() !== SUPER_ADMIN_EMAIL,
    );

    // ── Potential Debt: pending fees that will become debt once approved.
    //    Snapshot (not date-filtered). Skips finalized events; only postpaid
    //    or overdraft-enabled events can leave pending fees as future debt.
    let potentialDebt = 0;
    for (const concert of realConcerts) {
      if (concert.status === "finalized") continue;
      const fc = concert.platformFeeConfig as unknown;
      const cfg = (Array.isArray(fc) ? fc[0] : fc) as FeeConfig | null | undefined;
      const isPostpaidLike =
        cfg?.billingMode === "postpaid" || cfg?.allowOverdraft === true;
      if (!isPostpaidLike) continue;
      const liveCfg = {
        feePercent: cfg?.feePercent || 0,
        feeFixed: cfg?.feeFixed || 0,
      };
      for (const tt of concert.ticketTypes) {
        for (const order of tt.orders || []) {
          if (order.status !== "pending") continue;
          potentialDebt += getPlatformFeeForOrder(order, tt, liveCfg);
        }
      }
    }
    potentialDebt = Math.round(potentialDebt * 100) / 100;

    // ── Per-event approved tickets sold + gross revenue, filtered to period.
    const perEvent = realConcerts.map((concert) => {
      let ticketsSold = 0;
      let grossRevenue = 0;
      for (const tt of concert.ticketTypes) {
        for (const order of tt.orders || []) {
          if (order.status !== "approved") continue;
          if (!inPeriod(order.createdAt)) continue;
          ticketsSold += 1;
          grossRevenue += getOrderTotal(order, tt);
        }
      }
      return {
        id: concert.id,
        ticketsSold,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
      };
    });

    return NextResponse.json({ potentialDebt, perEvent });
  } catch (err) {
    console.error("[admin/platform-stats] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
