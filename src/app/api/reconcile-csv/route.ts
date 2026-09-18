import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { runDeterministicMatch } from "@/lib/reconcile";
import { loadPendingConcertOrders } from "@/lib/reconcileServer";

type CsvRow = {
  reference: string;
  amount: number;
};

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken).catch(() => null);
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

    const pendingOrders = await loadPendingConcertOrders(
      concertId,
      effectivePaymentType,
    );
    const { matched, unmatched, totalPending } = runDeterministicMatch(
      effectivePaymentType,
      rows.map((r, index) => ({
        index,
        reference: String(r.reference ?? ""),
        amount: Number(r.amount),
      })),
      pendingOrders,
      pmNames,
    );

    return NextResponse.json({ matched, unmatched, totalPending });
  } catch (err) {
    console.error("[reconcile-csv] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
