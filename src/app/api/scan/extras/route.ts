import { NextRequest, NextResponse } from "next/server";
import { resolveScanActor, actorCanCheckIn } from "@/lib/scanAuth";
import { errorResponse } from "@/lib/serverI18n";
import { concertCurrency } from "@/lib/currency";
import { loadEntitlements, type ScanExtrasResponse } from "@/lib/extrasServer";

export const dynamic = "force-dynamic";

/**
 * Read-only companion to /api/scan/validate for the Extras panel.
 *
 * It is a separate route on purpose: /api/scan/validate stays byte-for-byte the
 * endpoint it has always been, and the scanner fires both in parallel so the
 * ticket card renders at the same speed as before. An order with no extras
 * returns an empty list and the scanner shows nothing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId } = body;
    if (!orderId || typeof orderId !== "string") {
      return errorResponse(req, "ORDER_ID_REQUIRED", 400);
    }

    const auth = await resolveScanActor(req, body);
    if ("error" in auth) return auth.error;

    const { entitlements, order, concert } = await loadEntitlements(orderId);
    if (!order) {
      return errorResponse(req, "ORDER_NOT_FOUND", 404);
    }
    if (!actorCanCheckIn(auth.actor, concert)) {
      return errorResponse(
        req,
        auth.actor.kind === "scanner" ? "WRONG_EVENT" : "UNAUTHORIZED",
        auth.actor.kind === "scanner" ? 403 : 401,
      );
    }

    return NextResponse.json({
      entitlements,
      currency: concertCurrency(concert),
      approved: order.status === "approved",
    } satisfies ScanExtrasResponse);
  } catch (err) {
    console.error("[scan/extras] Error:", err);
    return errorResponse(req, "SCAN_EXTRAS_FAILED", 500);
  }
}
