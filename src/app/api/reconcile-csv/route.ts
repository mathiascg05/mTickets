import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";

type CsvRow = {
  reference: string;
  amount: number;
};

type MatchedOrder = {
  orderId: string;
  orderNumber: string;
  firstName: string;
  lastName: string;
  orderRef: string;
  orderAmount: number;
  currency: "USD" | "BS";
  csvRef: string;
  csvAmount: number;
};

type UnmatchedRow = {
  csvRef: string;
  csvAmount: number;
  reason: string;
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

    const { concertId, rows, paymentType } = (await req.json()) as {
      concertId: string;
      rows: CsvRow[];
      paymentType?: "pago_movil" | "zelle";
    };

    const effectivePaymentType = paymentType || "pago_movil";

    if (!concertId || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "concertId and rows are required" },
        { status: 400 },
      );
    }

    if (rows.length > 5000) {
      return NextResponse.json(
        { error: "Too many rows (max 5000)" },
        { status: 400 },
      );
    }

    // Fetch concert to verify authorization (incl. collaborators)
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        paymentMethods: {},
        collaborators: {},
      },
    });

    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }

    if (
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert.organizerEmail,
        collaborators: concert.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Find payment method names for this concert based on type
    const pmNames = (concert.paymentMethods || [])
      .filter(
        (pm: { type: string; name: string }) => pm.type === effectivePaymentType,
      )
      .map((pm: { name: string }) => pm.name);

    if (pmNames.length === 0) {
      const label = effectivePaymentType === "zelle" ? "Zelle" : "Pago Móvil";
      return NextResponse.json(
        { error: `No ${label} payment method configured for this concert` },
        { status: 400 },
      );
    }

    if (effectivePaymentType === "zelle") {
      return handleZelleReconciliation(concertId, rows, pmNames);
    } else {
      return handlePagoMovilReconciliation(concertId, rows, pmNames);
    }
  } catch (err) {
    console.error("[reconcile-csv] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── Pago Móvil reconciliation (existing logic) ──

async function handlePagoMovilReconciliation(
  concertId: string,
  rows: CsvRow[],
  pmNames: string[],
) {
  const { orders } = await adminDb.query({
    orders: {
      $: {
        where: {
          status: "pending",
          "ticketType.concert.id": concertId,
        },
      },
    },
  });

  const pendingPmOrders = orders.filter(
    (o) =>
      pmNames.includes(o.paymentMethod) &&
      o.proofReferenceNumber &&
      o.purchaseAmountBs != null,
  );

  function getOrderLast4(ref: string): string {
    const parts = ref.split("-");
    return parts[parts.length - 1] || "";
  }

  function getCsvLast4(ref: string): string {
    const cleaned = ref.replace(/\D/g, "");
    return cleaned.slice(-4);
  }

  const matched: MatchedOrder[] = [];
  const unmatched: UnmatchedRow[] = [];
  const matchedOrderIds = new Set<string>();

  for (const row of rows) {
    const csvLast4 = getCsvLast4(row.reference);
    if (!csvLast4 || csvLast4.length < 4) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Referencia muy corta",
      });
      continue;
    }

    const TOLERANCE = 0.5;
    const candidates = pendingPmOrders.filter((o) => {
      if (matchedOrderIds.has(o.id)) return false;
      const orderLast4 = getOrderLast4(o.proofReferenceNumber!);
      if (orderLast4 !== csvLast4) return false;
      const diff = Math.abs((o.purchaseAmountBs as number) - row.amount);
      return diff <= TOLERANCE;
    });

    if (candidates.length === 1) {
      const order = candidates[0];
      matchedOrderIds.add(order.id);
      matched.push({
        orderId: order.id,
        orderNumber: order.orderNumber || "---",
        firstName: order.firstName,
        lastName: order.lastName,
        orderRef: order.proofReferenceNumber!,
        orderAmount: order.purchaseAmountBs as number,
        currency: "BS",
        csvRef: row.reference,
        csvAmount: row.amount,
      });
    } else if (candidates.length > 1) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: `Multiples coincidencias (${candidates.length} ordenes)`,
      });
    } else {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Sin coincidencia",
      });
    }
  }

  return NextResponse.json({
    matched,
    unmatched,
    totalPending: pendingPmOrders.length,
  });
}

// ── Zelle reconciliation ──

function extractMemoCode(description: string): string | null {
  const match = description.match(/MT-[A-Z0-9]{5}/);
  return match ? match[0] : null;
}

function getExpectedUsdAmount(
  order: { discountAmount?: number; paymentMethodDiscount?: number; phaseId?: string },
  ticketType: {
    price: number;
    feePercent?: number;
    feeFixed?: number;
    phases?: { id: string; price: number }[];
  },
  groupSize = 1,
): number {
  let price = ticketType.price;
  if (order.phaseId && ticketType.phases) {
    const phase = ticketType.phases.find(
      (p: { id: string }) => p.id === order.phaseId,
    );
    if (phase) price = phase.price;
  }
  // Include organizer fees (these are charged to the buyer)
  const feePercent = ticketType.feePercent ?? 0;
  const feeFixed = ticketType.feeFixed ?? 0;
  const fee = (price * feePercent) / 100 + feeFixed;
  // discountAmount and paymentMethodDiscount on each order are TOTAL group discounts, so divide by groupSize
  const perOrderDiscount = (order.discountAmount || 0) / groupSize;
  const perOrderPmDiscount = (order.paymentMethodDiscount || 0) / groupSize;
  const amount = price + fee - perOrderDiscount - perOrderPmDiscount;
  return Math.round(amount * 100) / 100;
}

async function handleZelleReconciliation(
  concertId: string,
  rows: CsvRow[],
  zelleNames: string[],
) {
  // Query orders WITH ticketType to calculate expected USD amount
  const { orders } = await adminDb.query({
    orders: {
      $: {
        where: {
          status: "pending",
          "ticketType.concert.id": concertId,
        },
      },
      ticketType: {
        phases: {},
      },
    },
  });

  type TicketTypeInfo = { price: number; feePercent?: number; feeFixed?: number; phases?: { id: string; price: number }[] };

  // Admin SDK returns has-one relations as arrays
  function getTicketType(order: (typeof orders)[number]): TicketTypeInfo | null {
    const raw = order.ticketType as unknown;
    const tt = Array.isArray(raw) ? raw[0] : raw;
    return tt as TicketTypeInfo | null;
  }

  const pendingZelleOrders = orders.filter(
    (o) =>
      zelleNames.includes(o.paymentMethod) &&
      o.proofReferenceNumber &&
      getTicketType(o) != null,
  );

  // Group pending orders by memo code (same memo = same purchase group)
  const ordersByMemo = new Map<string, (typeof pendingZelleOrders)[number][]>();
  for (const o of pendingZelleOrders) {
    const memo = o.proofReferenceNumber!;
    if (!ordersByMemo.has(memo)) ordersByMemo.set(memo, []);
    ordersByMemo.get(memo)!.push(o);
  }

  const matched: MatchedOrder[] = [];
  const unmatched: UnmatchedRow[] = [];
  const matchedMemos = new Set<string>();

  for (const row of rows) {
    const memoCode = extractMemoCode(row.reference);
    if (!memoCode) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "No se encontró código memo (MT-XXXXX)",
      });
      continue;
    }

    if (matchedMemos.has(memoCode)) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Memo ya conciliado en esta sesión",
      });
      continue;
    }

    const group = ordersByMemo.get(memoCode);
    if (!group || group.length === 0) {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: "Sin coincidencia",
      });
      continue;
    }

    // Calculate total expected amount for all orders in this memo group
    // Note: discountAmount stored on each order is the TOTAL discount for the
    // entire purchase group, not per-order. We pass groupSize so it can be
    // divided correctly.
    const groupSize = group.length;
    let groupTotal = 0;
    for (const o of group) {
      const tt = getTicketType(o)!;
      groupTotal += getExpectedUsdAmount(o, tt, groupSize);
    }
    groupTotal = Math.round(groupTotal * 100) / 100;

    const TOLERANCE = 0.01 * group.length; // scale tolerance with group size
    const diff = Math.abs(groupTotal - row.amount);

    if (diff <= TOLERANCE) {
      matchedMemos.add(memoCode);
      // Add all orders from this group as matched
      for (const order of group) {
        const tt = getTicketType(order)!;
        const orderAmount = getExpectedUsdAmount(order, tt, groupSize);
        matched.push({
          orderId: order.id,
          orderNumber: order.orderNumber || "---",
          firstName: order.firstName,
          lastName: order.lastName,
          orderRef: memoCode,
          orderAmount,
          currency: "USD",
          csvRef: row.reference,
          csvAmount: row.amount,
        });
      }
    } else {
      unmatched.push({
        csvRef: row.reference,
        csvAmount: row.amount,
        reason: `Monto no coincide (esperado: $${groupTotal.toFixed(2)})`,
      });
    }
  }

  return NextResponse.json({
    matched,
    unmatched,
    totalPending: pendingZelleOrders.length,
  });
}
