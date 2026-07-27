import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyScannerToken } from "@/lib/scannerToken";

// Concert scanner data (counts + searchable attendee list) behind the door PIN.
// The scanner authenticates by PIN → HMAC token, NOT a user login, so with
// orders.view locked to owners it can no longer read orders client-side. This
// route (admin SDK bypasses perms) returns only scan-relevant fields for the
// concert the token is scoped to. Mirrors /api/guest-list/scan/data.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 401 });
    }
    const result = verifyScannerToken(token);
    if (!result) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const concertId = result.concertId;

    const { concerts } = await adminDb.query({
      concerts: { $: { where: { id: concertId } } },
    });
    const concert = concerts[0] as
      | { id: string; name: string; date: string; venue?: string }
      | undefined;
    if (!concert) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { orders: rawOrders } = await adminDb.query({
      orders: {
        $: { where: { "ticketType.concert.id": concertId } },
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

    const orders = (rawOrders as RawOrder[]).map((o) => {
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
        id: concert.id,
        name: concert.name,
        date: concert.date,
        venue: concert.venue ?? "",
      },
      orders,
    });
  } catch (err) {
    console.error("[scan/data] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
