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
  orderAmountBs: number;
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

    const { concertId, rows } = (await req.json()) as {
      concertId: string;
      rows: CsvRow[];
    };

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

    // Fetch concert to verify authorization
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        paymentMethods: {},
      },
    });

    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }

    if (!isAuthorizedForConcert(user.email, concert.organizerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Find pago_movil payment method names for this concert
    const pmNames = (concert.paymentMethods || [])
      .filter(
        (pm: { type: string; name: string }) => pm.type === "pago_movil",
      )
      .map((pm: { name: string }) => pm.name);

    if (pmNames.length === 0) {
      return NextResponse.json(
        { error: "No Pago Movil payment method configured for this concert" },
        { status: 400 },
      );
    }

    // Fetch all pending orders for this concert's ticket types
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

    // Filter to only pago_movil orders that have a reference number and amount in Bs
    const pendingPmOrders = orders.filter(
      (o) =>
        pmNames.includes(o.paymentMethod) &&
        o.proofReferenceNumber &&
        o.purchaseAmountBs != null,
    );

    // Extract last 4 digits from order reference (format: MT-XXXXX-1234)
    function getOrderLast4(ref: string): string {
      const parts = ref.split("-");
      return parts[parts.length - 1] || "";
    }

    // Extract last 4 digits from CSV reference
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

      // Find matching orders: last 4 digits match + amount within tolerance
      const TOLERANCE = 0.5; // Bs tolerance for rounding
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
          orderAmountBs: order.purchaseAmountBs as number,
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
  } catch (err) {
    console.error("[reconcile-csv] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
