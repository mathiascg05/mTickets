import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyGuestScannerToken } from "@/lib/guestListScannerToken";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 401 });
    }
    const result = verifyGuestScannerToken(token);
    if (!result) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const eventId = result.eventId;

    const { guestListEvents } = await adminDb.query({
      guestListEvents: { $: { where: { id: eventId } } },
    });
    const event = guestListEvents[0] as
      | { id: string; name: string; date: string; venue?: string }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: {
        $: { where: { "entry.event.id": eventId } },
        ticketType: {},
      },
    });

    type RawOrder = {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      cedula: string;
      status: string;
      visited: boolean;
      visitedAt?: number;
      orderNumber?: string;
      ticketType?: unknown;
    };

    const orders = (guestListOrders as RawOrder[]).map((o) => {
      const rawTt = o.ticketType as unknown;
      const tt = (Array.isArray(rawTt) ? rawTt[0] : rawTt) as
        | { id: string; name: string }
        | undefined;
      return {
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        email: o.email,
        cedula: o.cedula,
        status: o.status,
        visited: o.visited,
        visitedAt: o.visitedAt ?? null,
        orderNumber: o.orderNumber ?? null,
        ticketType: tt ? { id: tt.id, name: tt.name } : null,
      };
    });

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue ?? "",
      },
      orders,
    });
  } catch (err) {
    console.error("[guest-list/scan/data] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
