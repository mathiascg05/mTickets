import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListOrder } from "@/lib/guestListAuth";
import { sendGuestListTicketEmail } from "@/lib/guestListTicketSender";
import { assignGuestListOrderNumber } from "@/lib/guestListOrderNumber";

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

    const { orderIds } = await req.json();
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "orderIds required" }, { status: 400 });
    }
    if (orderIds.length > 200) {
      return NextResponse.json(
        { error: "Too many at once (max 200)" },
        { status: 400 },
      );
    }

    let approved = 0;
    let skipped = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const approvedForEmail: { orderId: string; eventId: string; eventName: string }[] = [];

    for (const orderId of orderIds) {
      try {
        const auth = await assertOrganizerCanAccessGuestListOrder(user.email, orderId);
        if (!auth.ok) {
          skipped++;
          continue;
        }
        const { guestListOrders } = await adminDb.query({
          guestListOrders: { $: { where: { id: orderId } } },
        });
        const order = guestListOrders[0];
        if (!order || order.status !== "pending") {
          skipped++;
          continue;
        }
        await adminDb.transact([
          adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
        ]);
        approved++;
        approvedForEmail.push({
          orderId,
          eventId: auth.data.event.id,
          eventName: auth.data.event.name,
        });
      } catch (err) {
        failed++;
        failedIds.push(orderId);
        console.warn(`[bulk-approve] Failed ${orderId}:`, err);
      }
    }

    after(async () => {
      for (const item of approvedForEmail) {
        try {
          await assignGuestListOrderNumber(item.orderId, item.eventId, item.eventName);
          await sendGuestListTicketEmail(item.orderId);
        } catch (err) {
          console.error(`[bulk-approve] post-send error for ${item.orderId}:`, err);
        }
      }
    });

    return NextResponse.json({ approved, skipped, failed, failedIds });
  } catch (err) {
    console.error("[guest-list/bulk-approve] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
