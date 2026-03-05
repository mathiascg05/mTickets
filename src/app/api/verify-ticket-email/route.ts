import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

export async function POST(req: NextRequest) {
  try {
    const { orderId, email } = await req.json();

    if (!orderId || !email || typeof email !== "string") {
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

    const verified =
      order.email.trim().toLowerCase() === email.trim().toLowerCase();

    return NextResponse.json({ verified });
  } catch {
    return NextResponse.json({ verified: false }, { status: 500 });
  }
}
