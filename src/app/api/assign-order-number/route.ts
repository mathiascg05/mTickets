import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assignOrderNumber } from "@/lib/orderNumber";
import { isAuthorizedForConcert } from "@/lib/authHelpers";

export async function POST(req: NextRequest) {
  try {
    // Require auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let authenticatedEmail: string;
    try {
      const user = await adminDb.auth.verifyToken(authHeader.slice(7));
      if (!user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      authenticatedEmail = user.email.toLowerCase();
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // Query order with its concert info (including collaborators)
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: {
          concert: {
            collaborators: {},
          },
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

    // Verify the caller is authorized for this concert (organizer or collaborator)
    const concertAuth = concert as {
      organizerEmail?: string;
      collaborators?: { email: string }[];
    };
    if (
      !isAuthorizedForConcert(authenticatedEmail, {
        organizerEmail: concertAuth.organizerEmail ?? "",
        collaborators: concertAuth.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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
