import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyGuestScannerToken } from "@/lib/guestListScannerToken";
import { isSuperAdmin } from "@/lib/authHelpers";

export async function POST(req: NextRequest) {
  try {
    const { orderId, userEmail, scannerToken } = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }

    let scopedEventId: string | null = null;
    let authenticatedEmail: string | null = null;

    if (scannerToken) {
      const result = verifyGuestScannerToken(scannerToken);
      if (!result) {
        return NextResponse.json(
          { error: "Invalid scanner token" },
          { status: 401 },
        );
      }
      scopedEventId = result.eventId;
    } else if (userEmail) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const token = authHeader.slice(7);
      try {
        const user = await adminDb.auth.verifyToken(token);
        if (!user?.email) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        authenticatedEmail = user.email.toLowerCase();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { guestListOrders } = await adminDb.query({
      guestListOrders: {
        $: { where: { id: orderId } },
        entry: { event: {} },
      },
    });
    const order = guestListOrders[0] as
      | {
          id: string;
          firstName: string;
          lastName: string;
          visited: boolean;
          status: string;
          entry: unknown;
        }
      | undefined;
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const rawEntry = order.entry as unknown;
    const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
      | { event: unknown }
      | undefined;
    const rawEvent = entry?.event as unknown;
    const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
      | { id: string; organizerEmail: string }
      | undefined;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (scopedEventId && scopedEventId !== event.id) {
      return NextResponse.json({ error: "Wrong event" }, { status: 403 });
    }
    if (authenticatedEmail) {
      const okOwner = event.organizerEmail.toLowerCase() === authenticatedEmail;
      if (!okOwner && !isSuperAdmin(authenticatedEmail)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (order.visited) {
      return NextResponse.json(
        {
          error: "ALREADY_SCANNED",
          attendee: { firstName: order.firstName, lastName: order.lastName },
        },
        { status: 409 },
      );
    }
    if (order.status !== "approved") {
      return NextResponse.json(
        { error: "TICKET_NOT_APPROVED", status: order.status },
        { status: 403 },
      );
    }

    const visitedAt = Date.now();
    await adminDb.transact([
      adminDb.tx.guestListOrders[orderId].update({
        visited: true,
        visitedAt,
      }),
    ]);

    return NextResponse.json({
      success: true,
      visitedAt,
      attendee: {
        firstName: order.firstName,
        lastName: order.lastName,
      },
    });
  } catch (err) {
    console.error("[guest-list/scan] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
