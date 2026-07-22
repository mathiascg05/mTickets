import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

const PROOF_PATH_RE = /^payment-proofs\/\d+-[a-zA-Z0-9._-]+$/;

type Body = {
  paymentMethodId?: string;
  paymentProofPath?: string;
  proofReferenceNumber?: string;
  purchaseRate?: number;
  purchaseRateCurrency?: string;
  purchaseAmountBs?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
    }
    const body = (await req.json()) as Body;

    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: {
        $: { where: { manageToken: token } },
        items: {},
        concert: { paymentMethods: {} },
      },
    });
    const a = ticketAllotments[0];
    if (!a || !a.manageToken) {
      return NextResponse.json({ error: "TOKEN_REVOKED" }, { status: 410 });
    }
    if (a.tokenExpiresAt && a.tokenExpiresAt < Date.now()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED" }, { status: 410 });
    }
    if (a.status !== "pending" && a.status !== "submitted") {
      return NextResponse.json(
        { error: "ALREADY_PROCESSED" },
        { status: 409 },
      );
    }

    if (body.paymentProofPath && !PROOF_PATH_RE.test(body.paymentProofPath)) {
      return NextResponse.json({ error: "INVALID_PROOF_PATH" }, { status: 400 });
    }
    if (!body.paymentProofPath && !body.proofReferenceNumber) {
      return NextResponse.json(
        { error: "PROOF_OR_REFERENCE_REQUIRED" },
        { status: 400 },
      );
    }

    // Resolve payment method name (must belong to the concert).
    const concert = firstOf<{ paymentMethods?: { id: string; name: string }[] }>(
      a.concert,
    );
    let paymentMethodName: string | undefined;
    if (body.paymentMethodId) {
      const pm = (concert?.paymentMethods || []).find(
        (m) => m.id === body.paymentMethodId,
      );
      if (!pm) {
        return NextResponse.json({ error: "INVALID_PAYMENT_METHOD" }, { status: 400 });
      }
      paymentMethodName = pm.name;
    }

    const now = Date.now();
    const items = (a.items || []) as { id: string }[];
    await adminDb.transact([
      adminDb.tx.ticketAllotments[a.id].update({
        status: "submitted",
        submittedAt: now,
        paymentMethodId: body.paymentMethodId || undefined,
        paymentMethod: paymentMethodName,
        paymentProofPath: body.paymentProofPath || undefined,
        proofReferenceNumber: body.proofReferenceNumber || undefined,
        purchaseRate: body.purchaseRate,
        purchaseRateCurrency: body.purchaseRateCurrency,
        purchaseAmountBs: body.purchaseAmountBs,
      }),
      ...items.map((it) =>
        adminDb.tx.ticketAllotmentItems[it.id].update({ status: "submitted" }),
      ),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[allotments:proof] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
