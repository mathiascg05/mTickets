import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyScannerToken } from "@/lib/scannerToken";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { errorResponse } from "@/lib/serverI18n";

export async function POST(req: NextRequest) {
  try {
    const { orderId, userEmail, scannerToken } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return errorResponse(req, "ORDER_ID_REQUIRED", 400);
    }

    // Auth: either organizer/super-admin email or scanner token
    let scopedConcertId: string | null = null;
    let authenticatedEmail: string | null = null;

    if (scannerToken) {
      const result = verifyScannerToken(scannerToken);
      if (!result) {
        return errorResponse(req, "SCANNER_TOKEN_INVALID", 401);
      }
      scopedConcertId = result.concertId;
    } else if (userEmail) {
      // Verify the email belongs to a real authenticated user via Bearer token
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return errorResponse(req, "UNAUTHORIZED", 401);
      }
      const token = authHeader.slice(7);
      try {
        const user = await adminDb.auth.verifyToken(token);
        if (!user?.email) {
          return errorResponse(req, "UNAUTHORIZED", 401);
        }
        authenticatedEmail = user.email.toLowerCase();
      } catch {
        return errorResponse(req, "UNAUTHORIZED", 401);
      }
    } else {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    // Fetch order — needed for both scope check and visited/status guard
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: { concert: { collaborators: {} } },
      },
    });
    const order = orders[0] as
      | {
          id: string;
          firstName?: string;
          lastName?: string;
          visited?: boolean;
          status?: string;
          ticketType?: {
            name?: string;
            concert?: {
              id: string;
              organizerEmail?: string;
              collaborators?: { email: string }[];
            };
          };
        }
      | undefined;
    if (!order) {
      return errorResponse(req, "ORDER_NOT_FOUND", 404);
    }

    // If scanner token, verify the order belongs to the scoped concert
    if (scopedConcertId) {
      const concertId = order.ticketType?.concert?.id;
      if (concertId !== scopedConcertId) {
        return errorResponse(req, "WRONG_EVENT", 403);
      }
    }

    // If email auth, verify user is organizer, collaborator, or super admin
    if (authenticatedEmail) {
      const concertInfo = order.ticketType?.concert;
      if (
        !concertInfo ||
        !isAuthorizedForConcert(authenticatedEmail, {
          organizerEmail: concertInfo.organizerEmail ?? "",
          collaborators: concertInfo.collaborators,
        })
      ) {
        return errorResponse(req, "UNAUTHORIZED", 401);
      }
    }

    // Double-scan guard
    if (order.visited) {
      return errorResponse(req, "ALREADY_SCANNED", 409);
    }
    if (order.status !== "approved") {
      return errorResponse(req, "TICKET_NOT_APPROVED", 403);
    }

    const visitedAt = Date.now();
    await adminDb.transact(
      adminDb.tx.orders[orderId].update({ visited: true, visitedAt }),
    );

    // Admin SDK returns has-one relations as arrays at runtime despite types
    const rawTT = order.ticketType as unknown;
    const ticketType = (Array.isArray(rawTT) ? rawTT[0] : rawTT) as
      | { name?: string }
      | undefined;

    return NextResponse.json({
      success: true,
      visitedAt,
      attendee: {
        firstName: order.firstName ?? "",
        lastName: order.lastName ?? "",
        ticketTypeName: ticketType?.name ?? "",
      },
    });
  } catch (err) {
    console.error("[mark-visited] Error:", err);
    return errorResponse(req, "MARK_VISITED_FAILED", 500);
  }
}
