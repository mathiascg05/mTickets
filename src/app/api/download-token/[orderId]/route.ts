import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { generateDownloadToken } from "@/lib/downloadToken";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const body = await request.json();
  const { email } = body;

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  // Verify the email matches the order
  const { orders } = await adminDb.query({
    orders: { $: { where: { id: orderId } } },
  });

  const order = orders[0];
  if (!order || order.status !== "approved") {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const token = generateDownloadToken(orderId);
  return NextResponse.json({ token });
}
