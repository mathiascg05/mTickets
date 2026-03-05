import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assignOrderNumber } from "@/lib/orderNumber";

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // Query order with its concert info
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: {
          concert: {},
        },
      },
    });

    const order = orders[0];
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const rawTT = order.ticketType as unknown;
    const ticketType = Array.isArray(rawTT) ? rawTT[0] : rawTT;
    const rawConcert = (ticketType as { concert?: unknown })?.concert as unknown;
    const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;

    if (!concert) {
      return NextResponse.json({ error: "Concert not found for order" }, { status: 404 });
    }

    const orderNumber = await assignOrderNumber(
      adminDb,
      orderId,
      (concert as { id: string }).id,
      (concert as { name: string }).name,
    );

    return NextResponse.json({ success: true, orderNumber });
  } catch (err) {
    console.error("[assign-order-number] error:", err);
    return NextResponse.json({ error: "Failed to assign order number" }, { status: 500 });
  }
}
