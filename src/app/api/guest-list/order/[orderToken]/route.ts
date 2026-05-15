import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ orderToken: string }> },
) {
  try {
    const { orderToken } = await ctx.params;
    if (!isValidToken(orderToken)) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: {
        $: { where: { orderToken } },
        entry: { event: {} },
      },
    });
    const order = guestListOrders[0] as
      | {
          id: string;
          firstName: string;
          lastName: string;
          status: string;
          pricePaid: number;
          orderNumber?: string;
          visited: boolean;
          visitedAt?: number;
          entry: unknown;
        }
      | undefined;
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rawEntry = order.entry as unknown;
    const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
      | { event: unknown }
      | undefined;
    const rawEvent = entry?.event as unknown;
    const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
      | {
          name: string;
          date: string;
          venue?: string;
          venueMapUrl?: string;
          flyerUrl?: string;
          logoUrl?: string;
          primaryColor?: string;
        }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({
      order: {
        id: order.id,
        firstName: order.firstName,
        lastName: order.lastName,
        status: order.status,
        pricePaid: order.pricePaid,
        orderNumber: order.orderNumber || null,
        visited: order.visited,
        visitedAt: order.visitedAt || null,
      },
      event: {
        name: event.name,
        date: event.date,
        venue: event.venue || "",
        venueMapUrl: event.venueMapUrl || "",
        flyerUrl: event.flyerUrl || "",
        logoUrl: event.logoUrl || "",
        primaryColor: event.primaryColor || "#1a2b4a",
      },
    });
  } catch (err) {
    console.error("[guest-list/order] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
