import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyTicketViewToken } from "@/lib/ticketViewToken";

export async function POST(req: NextRequest) {
  try {
    const { orderId, email, viewToken } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ verified: false }, { status: 400 });
    }
    if (!viewToken && (!email || typeof email !== "string")) {
      return NextResponse.json({ verified: false }, { status: 400 });
    }

    const { orders } = await adminDb.query({
      orders: { $: { where: { id: orderId } } },
    });

    const order = orders[0];
    if (!order) {
      // Don't reveal whether the order exists — same response
      return NextResponse.json({ verified: false });
    }

    // Anonymous allotment tickets have no email; the HMAC view token from the
    // QR link unlocks them instead.
    if (viewToken) {
      const verified =
        Boolean(order.allotmentId) &&
        verifyTicketViewToken(orderId, viewToken);
      return NextResponse.json({ verified });
    }

    const verified =
      (order.email ?? "").trim().toLowerCase() ===
      (email as string).trim().toLowerCase();

    return NextResponse.json({ verified });
  } catch {
    return NextResponse.json({ verified: false }, { status: 500 });
  }
}
