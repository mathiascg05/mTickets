import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { approveOrderInternal } from "@/lib/approveOrder";

type RequestBody = {
  orderId: string;
  action: "approve" | "reject" | "cancel";
};

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

    const { orderId, action }: RequestBody = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "orderId is required" },
        { status: 400 },
      );
    }
    if (!["approve", "reject", "cancel"].includes(action)) {
      return NextResponse.json(
        { error: "action must be approve, reject, or cancel" },
        { status: 400 },
      );
    }

    // Fetch order with its ticket type and concert
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

    // Validate status transitions
    if (action === "approve" && order.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending orders can be approved" },
        { status: 400 },
      );
    }
    if (action === "reject" && order.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending orders can be rejected" },
        { status: 400 },
      );
    }
    if (
      action === "cancel" &&
      order.status !== "pending" &&
      order.status !== "approved"
    ) {
      return NextResponse.json(
        { error: "Only pending or approved orders can be cancelled" },
        { status: 400 },
      );
    }

    // Navigate relations to get concert for auth check
    const rawTicketType = order.ticketType as unknown;
    const ticketType = (
      Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType
    ) as { concert: unknown } | undefined;

    const rawConcert = ticketType?.concert as unknown;
    const concert = (
      Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
    ) as { organizerEmail: string } | undefined;

    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }

    // Verify the caller is authorized for this concert
    if (!isAuthorizedForConcert(user.email, concert.organizerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Handle reject and cancel — simple status updates, no fee logic
    if (action === "reject") {
      await adminDb.transact([
        adminDb.tx.orders[orderId].update({ status: "rejected" }),
      ]);
      return NextResponse.json({ success: true });
    }

    if (action === "cancel") {
      await adminDb.transact([
        adminDb.tx.orders[orderId].update({ status: "cancelled" }),
      ]);
      return NextResponse.json({ success: true });
    }

    // Approve flow — delegate to shared function
    const result = await approveOrderInternal(orderId);

    if (!result.success) {
      const statusCode =
        result.errorCode === "NO_BALANCE" ||
        result.errorCode === "INSUFFICIENT_BALANCE"
          ? 402
          : result.errorCode === "NOT_FOUND"
            ? 404
            : 400;
      return NextResponse.json(
        { error: result.errorCode, message: result.error },
        { status: statusCode },
      );
    }

    return NextResponse.json({
      success: true,
      platformFee: result.platformFee,
    });
  } catch (err) {
    console.error("[approve-order] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
