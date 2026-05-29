import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";
import { approveGuestListOrderInternal } from "@/lib/approveGuestListOrder";
import { recordAuditLog } from "@/lib/auditLog";

type Body = { orderId: string; action: "approve" | "reject" | "cancel" };

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

    const { orderId, action }: Body = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }
    if (!["approve", "reject", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: {
        $: { where: { id: orderId } },
        entry: { event: {} },
      },
    });
    const order = guestListOrders[0] as
      | { id: string; status: string; entry: unknown }
      | undefined;
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rawEntry = order.entry as unknown;
    const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
      | { id: string; event: unknown }
      | undefined;
    const rawEvent = entry?.event as unknown;
    const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
      | { id: string; name: string; organizerEmail: string }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const lower = user.email.toLowerCase();
    if (event.organizerEmail.toLowerCase() !== lower && !isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "approve") {
      if (order.status !== "pending") {
        return NextResponse.json(
          { error: "Only pending orders can be approved" },
          { status: 400 },
        );
      }
      const result = await approveGuestListOrderInternal(orderId, {
        skipEmail: true,
        skipAssignNumber: true,
      });
      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error || "Approve failed",
            errorCode: result.errorCode,
            requiredFee: result.requiredFee,
            currentBalance: result.currentBalance,
          },
          { status: result.errorCode === "INSUFFICIENT_BALANCE" || result.errorCode === "NO_BALANCE" ? 402 : 400 },
        );
      }
      after(async () => {
        try {
          const { assignGuestListOrderNumber } = await import(
            "@/lib/guestListOrderNumber"
          );
          const { sendGuestListTicketEmail } = await import(
            "@/lib/guestListTicketSender"
          );
          await assignGuestListOrderNumber(orderId, event.id, event.name);
          await sendGuestListTicketEmail(orderId);
        } catch (err) {
          console.error("[guest-list/approve-order] post-send:", err);
        }
      });
      await recordAuditLog({
        action: "glorder.approve",
        actorEmail: user.email,
        entityType: "guestListOrder",
        entityId: orderId,
        guestListEventId: event.id,
        summary: `Aprobó orden de guest list en ${event.name}`,
        metadata: { platformFee: result.platformFee },
      });
      return NextResponse.json({ success: true, platformFee: result.platformFee });
    }

    if (action === "reject" || action === "cancel") {
      if (order.status === "cancelled" || order.status === "rejected") {
        return NextResponse.json(
          { error: "Order already terminal" },
          { status: 400 },
        );
      }
      const newStatus = action === "reject" ? "rejected" : "cancelled";
      const txns: Parameters<typeof adminDb.transact>[0] = [
        adminDb.tx.guestListOrders[orderId].update({ status: newStatus }),
      ];
      if (entry) {
        txns.push(
          adminDb.tx.guestListEntries[entry.id].update({
            status: "invited",
            registeredAt: null,
          }),
        );
      }
      await adminDb.transact(txns);
      await recordAuditLog({
        action: `glorder.${action}`,
        actorEmail: user.email,
        entityType: "guestListOrder",
        entityId: orderId,
        guestListEventId: event.id,
        summary: `${action === "reject" ? "Rechazó" : "Canceló"} orden de guest list en ${event.name}`,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[guest-list/approve-order] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
