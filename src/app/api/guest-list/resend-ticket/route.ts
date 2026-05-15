import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListOrder } from "@/lib/guestListAuth";
import { sendGuestListTicketEmail } from "@/lib/guestListTicketSender";

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }

    const auth = await assertOrganizerCanAccessGuestListOrder(user.email, orderId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: { $: { where: { id: orderId } } },
    });
    const order = guestListOrders[0];
    if (!order || order.status !== "approved") {
      return NextResponse.json(
        { error: "Order not approved" },
        { status: 400 },
      );
    }

    const result = await sendGuestListTicketEmail(orderId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[guest-list/resend-ticket] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
