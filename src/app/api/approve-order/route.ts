import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { sendTicketEmailForOrder } from "@/lib/ticketEmailSender";

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
          concert: {
            platformFeeConfig: {},
          },
          phases: {},
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

    // Navigate relations (admin SDK returns has-one as arrays)
    const rawTicketType = order.ticketType as unknown;
    const ticketType = (
      Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType
    ) as {
      id: string;
      price: number;
      concert: unknown;
      phases: { id: string; price: number }[];
    };
    if (!ticketType) {
      return NextResponse.json(
        { error: "Ticket type not found" },
        { status: 404 },
      );
    }

    const rawConcert = ticketType.concert as unknown;
    const concert = (
      Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
    ) as {
      id: string;
      organizerEmail: string;
      platformFeeConfig: unknown;
    };
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

    // ── Approve flow: calculate and deduct platform fee ──

    // Get platform fee config for this concert
    const rawFeeConfig = concert.platformFeeConfig as unknown;
    const feeConfig = (
      Array.isArray(rawFeeConfig) ? rawFeeConfig[0] : rawFeeConfig
    ) as {
      feePercent: number;
      feeFixed: number;
      billingMode: string;
    } | null;

    const billingMode = feeConfig?.billingMode || "prepaid";

    // Calculate platform fee
    const effectivePrice = order.phaseId
      ? (ticketType.phases || []).find(
          (p: { id: string }) => p.id === order.phaseId,
        )?.price ?? ticketType.price
      : ticketType.price;

    let platformFee = 0;
    if (feeConfig) {
      const percentFee = effectivePrice * (feeConfig.feePercent / 100);
      platformFee = percentFee + feeConfig.feeFixed;
      platformFee = Math.round(platformFee * 100) / 100;
    }

    if (platformFee > 0) {
      const { organizerBalances } = await adminDb.query({
        organizerBalances: {
          $: { where: { email: concert.organizerEmail.toLowerCase() } },
        },
      });

      const balance = organizerBalances[0];

      if (billingMode === "prepaid") {
        // ── Prepaid: require sufficient balance ──
        if (!balance) {
          return NextResponse.json(
            {
              error: "NO_BALANCE",
              message: "No balance found. Please top up your account.",
              requiredFee: platformFee,
            },
            { status: 402 },
          );
        }

        if (balance.balance < platformFee) {
          return NextResponse.json(
            {
              error: "INSUFFICIENT_BALANCE",
              message: "Insufficient balance to approve this order.",
              currentBalance: balance.balance,
              requiredFee: platformFee,
            },
            { status: 402 },
          );
        }

        // Atomically: approve + deduct balance + log transaction
        const newBalance =
          Math.round((balance.balance - platformFee) * 100) / 100;
        const txnId = genId();

        await adminDb.transact([
          adminDb.tx.orders[orderId].update({ status: "approved" }),
          adminDb.tx.organizerBalances[balance.id].update({
            balance: newBalance,
            updatedAt: Date.now(),
          }),
          adminDb.tx.balanceTransactions[txnId]
            .update({
              type: "fee",
              amount: -platformFee,
              balanceBefore: balance.balance,
              balanceAfter: newBalance,
              description: `Platform fee for order ${order.orderNumber || orderId}`,
              orderId,
              concertId: concert.id,
              createdAt: Date.now(),
            })
            .link({ organizerBalance: balance.id }),
        ]);
      } else {
        // ── Postpaid: approve freely, log fee as pending debt ──
        const currentBalance = balance?.balance || 0;
        const newBalance = Math.round((currentBalance - platformFee) * 100) / 100;
        const txnId = genId();

        if (balance) {
          await adminDb.transact([
            adminDb.tx.orders[orderId].update({ status: "approved" }),
            adminDb.tx.organizerBalances[balance.id].update({
              balance: newBalance,
              updatedAt: Date.now(),
            }),
            adminDb.tx.balanceTransactions[txnId]
              .update({
                type: "fee",
                amount: -platformFee,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                description: `Platform fee for order ${order.orderNumber || orderId}`,
                orderId,
                concertId: concert.id,
                createdAt: Date.now(),
              })
              .link({ organizerBalance: balance.id }),
          ]);
        } else {
          // Create balance record (will go negative)
          const balanceId = genId();
          await adminDb.transact([
            adminDb.tx.orders[orderId].update({ status: "approved" }),
            adminDb.tx.organizerBalances[balanceId].update({
              email: concert.organizerEmail.toLowerCase(),
              balance: -platformFee,
              currency: "USD",
              updatedAt: Date.now(),
            }),
            adminDb.tx.balanceTransactions[txnId]
              .update({
                type: "fee",
                amount: -platformFee,
                balanceBefore: 0,
                balanceAfter: -platformFee,
                description: `Platform fee for order ${order.orderNumber || orderId}`,
                orderId,
                concertId: concert.id,
                createdAt: Date.now(),
              })
              .link({ organizerBalance: balanceId }),
          ]);
        }
      }
    } else {
      // No fee configured — just approve
      await adminDb.transact([
        adminDb.tx.orders[orderId].update({ status: "approved" }),
      ]);
    }

    // Send ticket email
    try {
      await sendTicketEmailForOrder(orderId);
    } catch (err) {
      console.error("[approve-order] Email failed:", err);
    }

    return NextResponse.json({
      success: true,
      platformFee,
    });
  } catch (err) {
    console.error("[approve-order] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
