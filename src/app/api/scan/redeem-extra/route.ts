import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { extraRedemptionId } from "@/lib/deterministicId";
import { resolveScanActor, actorCanCheckIn, actorLogFields } from "@/lib/scanAuth";
import { errorResponse } from "@/lib/serverI18n";
import { concertCurrency } from "@/lib/currency";
import { freeUnitIndices, type ExtraSource } from "@/lib/extras";
import { loadEntitlements } from "@/lib/extrasServer";

export const dynamic = "force-dynamic";

// A losing racer only needs to step over the units another device just took, so
// a handful of attempts is plenty; past that the pool is genuinely exhausted.
const MAX_ATTEMPTS = 3;

/**
 * Redeems N units of one extra from the QR being scanned.
 *
 * Deliberately disjoint from /api/mark-visited: this route NEVER writes
 * `visited`, and mark-visited never touches extras. A valet can hand over the
 * parking spot before the person walks through the door.
 *
 * Concurrency: each redeemed unit is one row whose id is
 * `extraRedemptionId(poolKey, unitIndex)` — a pure function of the pool and the
 * unit number — written with `.create()`, which throws when the id already
 * exists. A pool of N units therefore has exactly N possible row ids, so it is
 * structurally impossible to redeem more than N even with two scanners writing
 * at the same instant. The loser's whole (atomic) transaction rolls back, it
 * re-reads and either takes the next free index or reports "no balance".
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, extraId, source, clientRequestId } = body;
    const units = body.units == null ? 1 : body.units;

    if (!orderId || typeof orderId !== "string") {
      return errorResponse(req, "ORDER_ID_REQUIRED", 400);
    }
    if (!extraId || typeof extraId !== "string") {
      return errorResponse(req, "EXTRA_NOT_FOUND", 400);
    }
    if (source !== "included" && source !== "purchased") {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (!Number.isInteger(units) || units < 1 || units > 99) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (clientRequestId != null && typeof clientRequestId !== "string") {
      return errorResponse(req, "INVALID_INPUT", 400);
    }

    const auth = await resolveScanActor(req, body);
    if ("error" in auth) return auth.error;

    const loaded = await loadEntitlements(orderId);
    if (!loaded.order) {
      return errorResponse(req, "ORDER_NOT_FOUND", 404);
    }
    if (!actorCanCheckIn(auth.actor, loaded.concert)) {
      return errorResponse(
        req,
        auth.actor.kind === "scanner" ? "WRONG_EVENT" : "UNAUTHORIZED",
        auth.actor.kind === "scanner" ? 403 : 401,
      );
    }
    // Entering is one thing, holding a right is another: only an approved order
    // owns anything. `visited` is intentionally NOT consulted.
    if (loaded.order.status !== "approved") {
      return errorResponse(req, "TICKET_NOT_APPROVED", 403);
    }

    const entitlement = loaded.entitlements.find(
      (e) => e.extraId === extraId && e.source === (source as ExtraSource),
    );
    if (!entitlement) {
      return errorResponse(req, "EXTRA_NOT_FOUND", 404);
    }

    // Idempotency: a retried request (flaky signal at the door) must not burn a
    // second unit. Same shape as create-order's submissionId short-circuit.
    if (clientRequestId) {
      const { extraRedemptions: prior } = await adminDb.query({
        extraRedemptions: {
          $: { where: { clientRequestId, poolKey: entitlement.poolKey } },
        },
      });
      if (prior.length > 0) {
        const fresh = await loadEntitlements(orderId);
        return NextResponse.json({
          success: true,
          redeemed: prior.length,
          alreadyApplied: true,
          entitlements: fresh.entitlements,
          currency: concertCurrency(loaded.concert),
        });
      }
    }

    const logFields = actorLogFields(auth.actor);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Re-read the pool on every attempt: this is the authoritative balance.
      const { extraRedemptions } = await adminDb.query({
        extraRedemptions: {
          $: { where: { poolKey: entitlement.poolKey } },
        },
      });
      const taken = (extraRedemptions as { unitIndex: number }[]).map(
        (r) => r.unitIndex,
      );
      const indices = freeUnitIndices(taken, entitlement.total, units);
      if (indices.length < units) {
        return errorResponse(req, "EXTRA_NO_BALANCE", 409, {
          extra: {
            extraId,
            total: entitlement.total,
            remaining: Math.max(0, entitlement.total - taken.length),
          },
        });
      }

      const now = Date.now();
      try {
        await adminDb.transact(
          indices.map((unitIndex) =>
            adminDb.tx.extraRedemptions[
              extraRedemptionId(entitlement.poolKey, unitIndex)
            ]
              .create({
                poolKey: entitlement.poolKey,
                unitIndex,
                source,
                ...(clientRequestId ? { clientRequestId } : {}),
                redeemedAt: now,
                ...logFields,
                createdAt: now,
              })
              .link({ extra: extraId, fromOrder: orderId }),
          ),
        );
      } catch (err) {
        // Another device took at least one of these units. The transaction is
        // atomic, so nothing was written; re-read and try the next free ones.
        if (attempt === MAX_ATTEMPTS - 1) {
          console.warn("[scan/redeem-extra] Lost the race after retries:", err);
          return errorResponse(req, "EXTRA_CONFLICT", 409);
        }
        continue;
      }

      const fresh = await loadEntitlements(orderId);
      return NextResponse.json({
        success: true,
        redeemed: units,
        entitlements: fresh.entitlements,
        currency: concertCurrency(loaded.concert),
      });
    }

    return errorResponse(req, "EXTRA_CONFLICT", 409);
  } catch (err) {
    console.error("[scan/redeem-extra] Error:", err);
    return errorResponse(req, "REDEEM_EXTRA_FAILED", 500);
  }
}
