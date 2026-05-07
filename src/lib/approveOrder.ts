import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { sendTicketEmailForOrder } from "@/lib/ticketEmailSender";

type ApproveResult = {
  success: boolean;
  platformFee?: number;
  error?: string;
  errorCode?: string;
};

type ApproveOptions = {
  skipEmail?: boolean;
};

export async function approveOrderInternal(
  orderId: string,
  options?: ApproveOptions,
): Promise<ApproveResult> {
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
    return { success: false, error: "Order not found", errorCode: "NOT_FOUND" };
  }

  if (order.status !== "pending") {
    return {
      success: false,
      error: "Only pending orders can be approved",
      errorCode: "INVALID_STATUS",
    };
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
    return {
      success: false,
      error: "Ticket type not found",
      errorCode: "NOT_FOUND",
    };
  }

  const rawConcert = ticketType.concert as unknown;
  const concert = (
    Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
  ) as {
    id: string;
    organizerEmail: string;
    platformFeeConfig: unknown;
    isDemo?: boolean;
  };
  if (!concert) {
    return {
      success: false,
      error: "Concert not found",
      errorCode: "NOT_FOUND",
    };
  }

  // Demo events: approve without touching fees, balance, or transactions.
  if (concert.isDemo) {
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "approved" }),
    ]);
    if (!options?.skipEmail) {
      try {
        await sendTicketEmailForOrder(orderId);
      } catch (err) {
        console.error("[approveOrder] Email failed:", err);
      }
    }
    return { success: true, platformFee: 0 };
  }

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
      if (!balance) {
        return {
          success: false,
          error: "No balance found. Please top up your account.",
          errorCode: "NO_BALANCE",
        };
      }

      if (balance.balance < platformFee) {
        return {
          success: false,
          error: "Insufficient balance to approve this order.",
          errorCode: "INSUFFICIENT_BALANCE",
        };
      }

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
      // Postpaid: approve freely, log fee as pending debt
      const currentBalance = balance?.balance || 0;
      const newBalance =
        Math.round((currentBalance - platformFee) * 100) / 100;
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

  // Send ticket email (unless caller handles it separately)
  if (!options?.skipEmail) {
    try {
      await sendTicketEmailForOrder(orderId);
    } catch (err) {
      console.error("[approveOrder] Email failed:", err);
    }
  }

  return { success: true, platformFee };
}
