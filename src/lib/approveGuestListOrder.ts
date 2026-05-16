import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { sendGuestListTicketEmail } from "@/lib/guestListTicketSender";
import { assignGuestListOrderNumber } from "@/lib/guestListOrderNumber";

type ApproveResult = {
  success: boolean;
  platformFee?: number;
  error?: string;
  errorCode?: string;
  requiredFee?: number;
  currentBalance?: number;
};

type ApproveOptions = {
  skipEmail?: boolean;
  skipAssignNumber?: boolean;
};

export async function approveGuestListOrderInternal(
  orderId: string,
  options?: ApproveOptions,
): Promise<ApproveResult> {
  const { guestListOrders } = await adminDb.query({
    guestListOrders: {
      $: { where: { id: orderId } },
      entry: { event: { platformFeeConfig: {} } },
      ticketType: {},
    },
  });

  const order = guestListOrders[0] as
    | {
        id: string;
        status: string;
        orderNumber?: string;
        priceSnapshot?: number;
        platformFeeAmountSnapshot?: number;
        entry: unknown;
        ticketType?: unknown;
      }
    | undefined;
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

  const rawEntry = order.entry as unknown;
  const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
    | { id: string; event: unknown }
    | undefined;
  const rawEvent = entry?.event as unknown;
  const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
    | {
        id: string;
        name: string;
        organizerEmail: string;
        isDemo?: boolean;
        platformFeeConfig: unknown;
      }
    | undefined;
  if (!event) {
    return { success: false, error: "Event not found", errorCode: "NOT_FOUND" };
  }

  if (event.isDemo) {
    await adminDb.transact([
      adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
    ]);
    if (!options?.skipAssignNumber) {
      try {
        await assignGuestListOrderNumber(orderId, event.id, event.name);
      } catch (err) {
        console.error("[approveGuestList] number assign failed:", err);
      }
    }
    if (!options?.skipEmail) {
      try {
        await sendGuestListTicketEmail(orderId);
      } catch (err) {
        console.error("[approveGuestList] Email failed:", err);
      }
    }
    return { success: true, platformFee: 0 };
  }

  const rawFeeConfig = event.platformFeeConfig as unknown;
  const feeConfig = (
    Array.isArray(rawFeeConfig) ? rawFeeConfig[0] : rawFeeConfig
  ) as
    | { feePercent: number; feeFixed: number; billingMode: string }
    | null;

  const billingMode = feeConfig?.billingMode || "prepaid";

  let platformFee = 0;
  if (typeof order.platformFeeAmountSnapshot === "number") {
    platformFee = Math.round(order.platformFeeAmountSnapshot * 100) / 100;
  } else if (feeConfig) {
    const rawTt = order.ticketType as unknown;
    const ticketType = (Array.isArray(rawTt) ? rawTt[0] : rawTt) as
      | { price: number }
      | undefined;
    const base =
      typeof order.priceSnapshot === "number"
        ? order.priceSnapshot
        : ticketType?.price ?? 0;
    platformFee =
      Math.round(
        ((base * feeConfig.feePercent) / 100 + feeConfig.feeFixed) * 100,
      ) / 100;
  }

  async function finalizeApproved() {
    if (!event) return;
    if (!options?.skipAssignNumber) {
      try {
        await assignGuestListOrderNumber(orderId, event.id, event.name);
      } catch (err) {
        console.error("[approveGuestList] number assign failed:", err);
      }
    }
    if (!options?.skipEmail) {
      try {
        await sendGuestListTicketEmail(orderId);
      } catch (err) {
        console.error("[approveGuestList] Email failed:", err);
      }
    }
  }

  if (platformFee <= 0) {
    await adminDb.transact([
      adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
    ]);
    await finalizeApproved();
    return { success: true, platformFee: 0 };
  }

  const { organizerBalances } = await adminDb.query({
    organizerBalances: {
      $: { where: { email: event.organizerEmail.toLowerCase() } },
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
        requiredFee: platformFee,
        currentBalance: balance.balance,
      };
    }
    const newBalance = Math.round((balance.balance - platformFee) * 100) / 100;
    const txnId = genId();
    await adminDb.transact([
      adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
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
          description: `Platform fee for guest list order ${order.orderNumber || orderId}`,
          orderId,
          createdAt: Date.now(),
        })
        .link({ organizerBalance: balance.id }),
    ]);
  } else {
    const currentBalance = balance?.balance || 0;
    const newBalance = Math.round((currentBalance - platformFee) * 100) / 100;
    const txnId = genId();
    if (balance) {
      await adminDb.transact([
        adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
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
            description: `Platform fee for guest list order ${order.orderNumber || orderId}`,
            orderId,
            createdAt: Date.now(),
          })
          .link({ organizerBalance: balance.id }),
      ]);
    } else {
      const balanceId = genId();
      await adminDb.transact([
        adminDb.tx.guestListOrders[orderId].update({ status: "approved" }),
        adminDb.tx.organizerBalances[balanceId].update({
          email: event.organizerEmail.toLowerCase(),
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
            description: `Platform fee for guest list order ${order.orderNumber || orderId}`,
            orderId,
            createdAt: Date.now(),
          })
          .link({ organizerBalance: balanceId }),
      ]);
    }
  }

  await finalizeApproved();
  return { success: true, platformFee };
}
