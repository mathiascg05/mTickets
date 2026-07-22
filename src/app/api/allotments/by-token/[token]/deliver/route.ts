import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";

type Body = { orderId: string; delivered: boolean };

// Internal, organizational checklist for the school: mark a QR as handed out.
// Purely informational — does not affect scanning or inventory.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }
    const { orderId, delivered } = (await req.json()) as Body;
    if (!orderId || typeof delivered !== "boolean") {
      return NextResponse.json({ error: "orderId and delivered required" }, { status: 400 });
    }

    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: { $: { where: { manageToken: token } } },
    });
    const a = ticketAllotments[0];
    if (!a || !a.manageToken) {
      return NextResponse.json({ error: "TOKEN_REVOKED" }, { status: 410 });
    }
    if (a.tokenExpiresAt && a.tokenExpiresAt < Date.now()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }

    // The order must belong to this allotment.
    const { orders } = await adminDb.query({
      orders: { $: { where: { allotmentId: a.id, id: orderId } } },
    });
    if (!orders[0]) {
      return NextResponse.json({ error: "ORDER_NOT_IN_ALLOTMENT" }, { status: 404 });
    }

    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ delivered }),
    ]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[allotments:deliver] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
