import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyScannerToken } from "@/lib/scannerToken";
import { canPerformOnConcert, type ConcertAuthInfo } from "@/lib/authHelpers";
import { errorResponse } from "@/lib/serverI18n";

export type ScanActor =
  | { kind: "scanner"; concertId: string }
  | { kind: "user"; email: string };

/**
 * The door-scanner auth pair, exactly as /api/mark-visited does it: either a
 * scannerToken (the PIN-issued HMAC, scoped to one concert) in the body, or a
 * Bearer Instant token whose verified email is an organizer/collaborator.
 * The `userEmail` in the body is never trusted — only the token's email is.
 *
 * Returns the actor, or a ready-to-return error Response.
 */
export async function resolveScanActor(
  req: NextRequest,
  body: { userEmail?: unknown; scannerToken?: unknown },
): Promise<{ actor: ScanActor } | { error: NextResponse }> {
  if (body.scannerToken) {
    if (typeof body.scannerToken !== "string") {
      return { error: await errorResponse(req, "SCANNER_TOKEN_INVALID", 401) };
    }
    const result = verifyScannerToken(body.scannerToken);
    if (!result) {
      return { error: await errorResponse(req, "SCANNER_TOKEN_INVALID", 401) };
    }
    return { actor: { kind: "scanner", concertId: result.concertId } };
  }

  if (body.userEmail) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return { error: await errorResponse(req, "UNAUTHORIZED", 401) };
    }
    try {
      const user = await adminDb.auth.verifyToken(authHeader.slice(7));
      if (!user?.email) {
        return { error: await errorResponse(req, "UNAUTHORIZED", 401) };
      }
      return { actor: { kind: "user", email: user.email.toLowerCase() } };
    } catch {
      return { error: await errorResponse(req, "UNAUTHORIZED", 401) };
    }
  }

  return { error: await errorResponse(req, "UNAUTHORIZED", 401) };
}

/**
 * Is this actor allowed to work the door of this concert? A scanner token is
 * bound to one concert; an authenticated user needs the `check_in` capability,
 * which owner, co-organizer and box office all have.
 */
export function actorCanCheckIn(
  actor: ScanActor,
  concert: (ConcertAuthInfo & { id: string }) | undefined,
): boolean {
  if (!concert) return false;
  if (actor.kind === "scanner") return concert.id === actor.concertId;
  return canPerformOnConcert(actor.email, concert, "check_in");
}

/** Who performed the action, for the append-only redemption log. */
export function actorLogFields(actor: ScanActor): {
  redeemedByEmail?: string;
  redeemedByScanner?: boolean;
} {
  return actor.kind === "scanner"
    ? { redeemedByScanner: true }
    : { redeemedByEmail: actor.email };
}
