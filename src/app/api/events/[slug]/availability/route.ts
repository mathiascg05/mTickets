import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import {
  getAvailability,
  getTodayString,
  committedAllotmentQty,
} from "@/lib/phases";
import type { Phase, Availability } from "@/lib/phases";
import { extraSoldQty, extraAvailableStock } from "@/lib/extras";

// Public availability for an event's ticket types WITHOUT exposing order PII.
// Replaces the client-side `orders` query the event/buy pages used to run: with
// orders.view locked to owners, availability must be computed server-side (the
// admin SDK bypasses perms) and only the resulting counts/prices are returned.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    // The buy page excludes its OWN active reservation so its hold doesn't
    // reduce the availability shown to itself (otherwise the last N tickets a
    // buyer reserved would read as sold out to them).
    const excludeReservation = req.nextUrl.searchParams.get("excludeReservation");

    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { slug } },
        ticketTypes: {
          orders: {
            $: { where: { or: [{ status: "approved" }, { status: "pending" }] } },
          },
          phases: { $: { order: { sortOrder: "asc" } } },
          reservations: {},
          allotmentItems: {},
        },
        // Extras stock, for the same reason as ticket availability: the rows it
        // is derived from (purchase lines and their orders) are not readable by
        // the buyer, so the count has to be computed here.
        extras: {
          purchaseItems: {
            group: { orders: {} },
          },
        },
      },
    });

    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const today = getTodayString();
    const now = Date.now();
    const availability: Record<string, Availability> = {};

    for (const tt of concert.ticketTypes) {
      const orders = (tt.orders ?? []) as {
        id: string;
        status: string;
        phaseId?: string;
        priceSnapshot?: number;
        allotmentId?: string;
      }[];
      const reservations = ((tt.reservations ?? []) as {
        id: string;
        quantity: number;
        expiresAt: number;
        phaseId?: string;
      }[]).filter(
        (r) => r.expiresAt > now && r.id !== excludeReservation,
      );
      const phases = (tt.phases ?? []) as Phase[];
      const committed = committedAllotmentQty(
        (tt.allotmentItems ?? []) as { quantity: number; status?: string }[],
      );

      availability[tt.id] = getAvailability(
        tt,
        phases,
        orders,
        today,
        reservations,
        committed,
      );
    }

    const extrasAvailability: Record<string, number | null> = {};
    for (const extra of (concert.extras ?? []) as {
      id: string;
      stock?: number;
      purchaseItems?: {
        quantity: number;
        group?: { orders?: { status?: string }[] } | { orders?: { status?: string }[] }[];
      }[];
    }[]) {
      const left = extraAvailableStock(extra, extraSoldQty(extra.purchaseItems));
      // null = unlimited; JSON has no Infinity.
      extrasAvailability[extra.id] = Number.isFinite(left) ? left : null;
    }

    return NextResponse.json({ availability, extras: extrasAvailability });
  } catch (err) {
    console.error("[events/availability] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
