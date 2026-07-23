import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { allotmentOrderId } from "@/lib/deterministicId";
import { generateOrderCode, generatePrefix } from "@/lib/orderNumber";
import { computePlatformFeeAtPurchase } from "@/lib/order-pricing";

type MintResult = {
  success: boolean;
  minted?: number;
  platformFee?: number;
  alreadyGenerated?: boolean;
  error?: string;
  errorCode?: string;
  requiredFee?: number;
  currentBalance?: number;
};

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

// Split a total price across N tickets in integer cents (remainder on the first
// orders) so per-order priceSnapshots sum exactly to what the school paid.
function splitPrice(totalPrice: number, n: number): number[] {
  if (n <= 0) return [];
  const totalCents = Math.round(totalPrice * 100);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) =>
    Math.round((base + (i < remainder ? 1 : 0))) / 100,
  );
}

const MINT_BATCH_SIZE = 100;

/**
 * Idempotently mint one approved, anonymous `orders` row per ticket in an
 * allotment. Uses deterministic order ids derived from (allotmentId, seq) so a
 * double-click or retry re-writes the SAME N rows (upsert) instead of creating
 * 2N. Charges the platform fee once (sum of per-ticket fees) as a single
 * balance transaction, mirroring approveOrderInternal's billing rules, and
 * flips the allotment + its items to "approved".
 *
 * The caller (approve route) is responsible for auth and the audit log.
 */
export async function mintAllotmentOrders(
  allotmentId: string,
): Promise<MintResult> {
  const { ticketAllotments } = await adminDb.query({
    ticketAllotments: {
      $: { where: { id: allotmentId } },
      items: { ticketType: {} },
      concert: { platformFeeConfig: {} },
    },
  });

  const allotment = ticketAllotments[0] as
    | {
        id: string;
        status: string;
        totalPrice: number;
        ticketCount: number;
        paymentMethod?: string;
        ordersGeneratedAt?: number;
        items: {
          id: string;
          quantity: number;
          ticketType: unknown;
        }[];
        concert: unknown;
      }
    | undefined;

  if (!allotment) {
    return { success: false, error: "Allotment not found", errorCode: "NOT_FOUND" };
  }

  // Idempotency: already minted → no-op (do not re-mint or re-charge).
  if (allotment.ordersGeneratedAt) {
    return { success: true, alreadyGenerated: true };
  }

  if (allotment.status !== "submitted" && allotment.status !== "pending") {
    return {
      success: false,
      error: "Only a pending/submitted allotment can be approved",
      errorCode: "INVALID_STATUS",
    };
  }

  const concert = firstOf<{
    id: string;
    name: string;
    organizerEmail: string;
    orderNumberPrefix?: string;
    isDemo?: boolean;
    platformFeeConfig: unknown;
  }>(allotment.concert);
  if (!concert) {
    return { success: false, error: "Concert not found", errorCode: "NOT_FOUND" };
  }

  const items = (allotment.items || []).map((it) => ({
    id: it.id,
    quantity: it.quantity,
    ticketType: firstOf<{ id: string; price: number }>(it.ticketType),
  }));
  if (items.some((it) => !it.ticketType)) {
    return { success: false, error: "Ticket type missing on item", errorCode: "NOT_FOUND" };
  }

  // Flatten items into a per-ticket list, numbered 1..N across the whole lot.
  const tickets: { ticketTypeId: string }[] = [];
  for (const it of items) {
    for (let k = 0; k < it.quantity; k++) {
      tickets.push({ ticketTypeId: it.ticketType!.id });
    }
  }
  const n = tickets.length;
  if (n !== allotment.ticketCount) {
    // ticketCount is denormalized; trust the items but keep them consistent.
    console.warn(
      `[allotmentMint] ticketCount ${allotment.ticketCount} != items sum ${n}`,
    );
  }

  const prices = splitPrice(allotment.totalPrice, n);

  // Platform fee config (skipped entirely for demo events).
  const feeConfig = firstOf<{
    feePercent: number;
    feeFixed: number;
    billingMode: string;
    allowOverdraft?: boolean;
  }>(concert.platformFeeConfig);
  const isDemo = concert.isDemo === true;

  // Per-ticket platform fee (your income) — "N × fee": fixed part per ticket,
  // percent part on each ticket's split price.
  const perOrderPlatformFee = prices.map((p) =>
    isDemo || !feeConfig
      ? 0
      : computePlatformFeeAtPurchase({
          basePrice: p,
          feePercent: feeConfig.feePercent,
          feeFixed: feeConfig.feeFixed,
        }),
  );
  const totalFee =
    Math.round(perOrderPlatformFee.reduce((s, f) => s + f, 0) * 100) / 100;

  // Prepaid gate BEFORE minting anything.
  const billingMode = feeConfig?.billingMode || "prepaid";
  const strictPrepaid =
    billingMode === "prepaid" && feeConfig?.allowOverdraft !== true;

  let balanceRow:
    | { id: string; balance: number }
    | undefined;
  if (!isDemo && totalFee > 0) {
    const { organizerBalances } = await adminDb.query({
      organizerBalances: {
        $: { where: { email: concert.organizerEmail.toLowerCase() } },
      },
    });
    balanceRow = organizerBalances[0];
    if (strictPrepaid) {
      if (!balanceRow) {
        return {
          success: false,
          error: "No balance found. Please top up your account.",
          errorCode: "NO_BALANCE",
          requiredFee: totalFee,
        };
      }
      if (balanceRow.balance < totalFee) {
        return {
          success: false,
          error: "Insufficient balance to approve this allotment.",
          errorCode: "INSUFFICIENT_BALANCE",
          requiredFee: totalFee,
          currentBalance: balanceRow.balance,
        };
      }
    }
  }

  const prefix = concert.orderNumberPrefix || generatePrefix(concert.name);
  const now = Date.now();

  // Guarantee no in-batch orderNumber collision.
  const usedCodes = new Set<string>();
  const nextOrderNumber = () => {
    let code = generateOrderCode();
    while (usedCodes.has(code)) code = generateOrderCode();
    usedCodes.add(code);
    return `${prefix}-${code}`;
  };

  // Mint orders in batches with deterministic ids (idempotent upsert).
  let minted = 0;
  for (let start = 0; start < n; start += MINT_BATCH_SIZE) {
    const batch = tickets.slice(start, start + MINT_BATCH_SIZE);
    const txs = batch.map((t, j) => {
      const seq = start + j + 1; // 1..N
      const oid = allotmentOrderId(allotment.id, seq);
      const price = prices[seq - 1];
      return adminDb.tx.orders[oid]
        .update({
          firstName: "",
          lastName: "",
          email: "",
          cedula: "",
          paymentMethod: allotment.paymentMethod || "allotment",
          status: "approved",
          visited: false,
          allotmentId: allotment.id,
          allotmentSeq: seq,
          orderNumber: nextOrderNumber(),
          priceSnapshot: price,
          feePercentSnapshot: 0,
          feeFixedSnapshot: 0,
          feeAmountSnapshot: 0,
          totalSnapshot: price,
          platformFeeAmountSnapshot: perOrderPlatformFee[seq - 1],
          createdAt: now,
        })
        .link({ ticketType: t.ticketTypeId });
    });
    await adminDb.transact(txs);
    minted += batch.length;
  }

  // Finalize atomically: fee/balance + allotment status + items status.
  const finalize: unknown[] = [];

  if (!isDemo && totalFee > 0) {
    const txnId = genId();
    if (balanceRow) {
      const newBalance = Math.round((balanceRow.balance - totalFee) * 100) / 100;
      finalize.push(
        adminDb.tx.organizerBalances[balanceRow.id].update({
          balance: newBalance,
          updatedAt: now,
        }),
        adminDb.tx.balanceTransactions[txnId]
          .update({
            type: "fee",
            amount: -totalFee,
            balanceBefore: balanceRow.balance,
            balanceAfter: newBalance,
            description: `Platform fee for allotment ${allotment.id} (${n} tickets)`,
            concertId: concert.id,
            createdAt: now,
          })
          .link({ organizerBalance: balanceRow.id }),
      );
    } else {
      // Postpaid/overdraft with no balance row yet → create one (goes negative).
      const balanceId = genId();
      finalize.push(
        adminDb.tx.organizerBalances[balanceId].update({
          email: concert.organizerEmail.toLowerCase(),
          balance: -totalFee,
          currency: "USD",
          updatedAt: now,
        }),
        adminDb.tx.balanceTransactions[txnId]
          .update({
            type: "fee",
            amount: -totalFee,
            balanceBefore: 0,
            balanceAfter: -totalFee,
            description: `Platform fee for allotment ${allotment.id} (${n} tickets)`,
            concertId: concert.id,
            createdAt: now,
          })
          .link({ organizerBalance: balanceId }),
      );
    }
  }

  finalize.push(
    adminDb.tx.ticketAllotments[allotment.id].update({
      status: "approved",
      approvedAt: now,
      ordersGeneratedAt: now,
      feeAmountSnapshot: totalFee,
    }),
    ...items.map((it) =>
      adminDb.tx.ticketAllotmentItems[it.id].update({ status: "approved" }),
    ),
  );

  await adminDb.transact(finalize as never);

  return { success: true, minted, platformFee: totalFee };
}
