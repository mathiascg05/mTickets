import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyScannerToken } from "@/lib/scannerToken";

// Read-only lookup of a single scanned order for the concert scanner display
// (marking still goes through /api/mark-visited). Behind the door PIN token.
// If the scanned order belongs to a DIFFERENT concert than the token, we return
// only { wrongEvent, concertName } — enough for the "wrong event" warning
// without leaking another event's attendee PII.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;
    const { orderId } = await req.json();
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 401 });
    }
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }
    const result = verifyScannerToken(token);
    if (!result) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: { concert: {} },
      },
    });
    const order = orders[0];
    if (!order) {
      return NextResponse.json({ found: false });
    }

    const rawTt = order.ticketType as unknown;
    const tt = (Array.isArray(rawTt) ? rawTt[0] : rawTt) as
      | { id: string; name: string; concert: unknown }
      | undefined;
    const rawConcert = tt?.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
      | { id: string; name: string }
      | undefined;

    if (!concert || concert.id !== result.concertId) {
      // Belongs to another event — warn without exposing its PII.
      return NextResponse.json({
        found: true,
        wrongEvent: true,
        concertName: concert?.name ?? null,
      });
    }

    return NextResponse.json({
      found: true,
      wrongEvent: false,
      order: {
        id: order.id,
        firstName: order.firstName,
        lastName: order.lastName,
        email: order.email,
        cedula: order.cedula,
        status: order.status,
        visited: order.visited,
        orderNumber: order.orderNumber ?? null,
        ticketTypeName: tt?.name ?? null,
        concertId: concert.id,
        concertName: concert.name,
      },
    });
  } catch (err) {
    console.error("[scan/validate] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
