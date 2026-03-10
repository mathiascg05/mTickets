import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyScannerToken } from "@/lib/scannerToken";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";

export async function POST(req: NextRequest) {
  try {
    const { orderId, userEmail, scannerToken } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // Auth: either admin email or scanner token
    let scopedConcertId: string | null = null;

    if (scannerToken) {
      const result = verifyScannerToken(scannerToken);
      if (!result) {
        return NextResponse.json({ error: "Invalid or expired scanner token" }, { status: 401 });
      }
      scopedConcertId = result.concertId;
    } else if (ADMIN_EMAIL && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      // Admin — no concert scope restriction
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch order — needed for both scope check and visited/status guard
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: { concert: {} },
      },
    });
    const order = orders[0] as { id: string; visited?: boolean; status?: string; ticketType?: { concert?: { id: string } } } | undefined;
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // If scanner token, verify the order belongs to the scoped concert
    if (scopedConcertId) {
      const concertId = order.ticketType?.concert?.id;
      if (concertId !== scopedConcertId) {
        return NextResponse.json({ error: "Wrong event" }, { status: 403 });
      }
    }

    // Double-scan guard
    if (order.visited) {
      return NextResponse.json({ error: "Already scanned" }, { status: 409 });
    }
    if (order.status !== "approved") {
      return NextResponse.json({ error: "Ticket not approved" }, { status: 403 });
    }

    await adminDb.transact(
      adminDb.tx.orders[orderId].update({ visited: true }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[mark-visited] Error:", err);
    return NextResponse.json(
      { error: "Failed to mark as visited" },
      { status: 500 },
    );
  }
}
