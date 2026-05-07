import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";

type CancelResult = {
  success: boolean;
  feeReversed?: boolean;
  feeAmount?: number;
  error?: string;
  errorCode?: string;
};

export async function cancelOrderInternal(
  orderId: string,
): Promise<CancelResult> {
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
    return { success: false, error: "Order not found", errorCode: "NOT_FOUND" };
  }

  if (order.status !== "pending" && order.status !== "approved") {
    return {
      success: false,
      error: "Only pending or approved orders can be cancelled",
      errorCode: "INVALID_STATUS",
    };
  }

  if (order.status === "pending") {
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    ]);
    return { success: true, feeReversed: false };
  }

  // Demo events never charge fees, so there is nothing to reverse.
  const rawTicketTypeForDemo = order.ticketType as unknown;
  const ticketTypeForDemo = (
    Array.isArray(rawTicketTypeForDemo) ? rawTicketTypeForDemo[0] : rawTicketTypeForDemo
  ) as { concert: unknown } | undefined;
  const rawConcertForDemo = ticketTypeForDemo?.concert as unknown;
  const concertForDemo = (
    Array.isArray(rawConcertForDemo) ? rawConcertForDemo[0] : rawConcertForDemo
  ) as { isDemo?: boolean } | undefined;
  if (concertForDemo?.isDemo) {
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    ]);
    return { success: true, feeReversed: false };
  }

  const { balanceTransactions: feeTxns } = await adminDb.query({
    balanceTransactions: {
      $: { where: { orderId, type: "fee" } },
    },
  });

  const feeTxn = [...feeTxns].sort((a, b) => b.createdAt - a.createdAt)[0];

  if (!feeTxn) {
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    ]);
    return { success: true, feeReversed: false };
  }

  const { balanceTransactions: adjustments } = await adminDb.query({
    balanceTransactions: {
      $: { where: { orderId, type: "adjustment" } },
    },
  });
  // Filter in JS: `amount` is not indexed so $gt isn't available.
  const alreadyReversed = adjustments.some((a) => a.amount > 0);

  if (alreadyReversed) {
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    ]);
    return { success: true, feeReversed: false };
  }

  const rawTicketType = order.ticketType as unknown;
  const ticketType = (
    Array.isArray(rawTicketType) ? rawTicketType[0] : rawTicketType
  ) as { concert: unknown } | undefined;
  const rawConcert = ticketType?.concert as unknown;
  const concert = (
    Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
  ) as { id: string; organizerEmail: string } | undefined;

  if (!concert) {
    return {
      success: false,
      error: "Concert not found",
      errorCode: "NOT_FOUND",
    };
  }

  const originalFee = -feeTxn.amount;

  const { organizerBalances } = await adminDb.query({
    organizerBalances: {
      $: { where: { email: concert.organizerEmail.toLowerCase() } },
    },
  });
  const balance = organizerBalances[0];

  if (!balance) {
    console.warn(
      `[cancelOrder] Fee txn ${feeTxn.id} exists for order ${orderId} but no balance for ${concert.organizerEmail}`,
    );
    await adminDb.transact([
      adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    ]);
    return { success: true, feeReversed: false };
  }

  const newBalance = Math.round((balance.balance + originalFee) * 100) / 100;
  const txnId = genId();

  await adminDb.transact([
    adminDb.tx.orders[orderId].update({ status: "cancelled" }),
    adminDb.tx.organizerBalances[balance.id].update({
      balance: newBalance,
      updatedAt: Date.now(),
    }),
    adminDb.tx.balanceTransactions[txnId]
      .update({
        type: "adjustment",
        amount: originalFee,
        balanceBefore: balance.balance,
        balanceAfter: newBalance,
        description: `Reversal: order ${order.orderNumber || orderId} cancelled`,
        orderId,
        concertId: concert.id,
        createdAt: Date.now(),
      })
      .link({ organizerBalance: balance.id }),
  ]);

  return { success: true, feeReversed: true, feeAmount: originalFee };
}
