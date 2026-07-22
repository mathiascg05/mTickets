import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import {
  getAvailability,
  getTodayString,
  committedAllotmentQty,
} from "@/lib/phases";
import { recordAuditLog } from "@/lib/auditLog";

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

type ItemInput = { ticketTypeId: string; quantity: number };
type Body = {
  schoolName?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  items?: ItemInput[];
  totalPrice?: number;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await req.json()) as Body;

    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: {
        $: { where: { id } },
        items: { ticketType: {} },
        concert: { collaborators: {} },
      },
    });
    const allotment = ticketAllotments[0] as
      | {
          id: string;
          status: string;
          schoolName: string;
          items: { id: string; quantity: number; ticketType: unknown }[];
          concert: unknown;
        }
      | undefined;
    if (!allotment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const concert = firstOf<{
      id: string;
      organizerEmail: string;
      collaborators?: { email: string }[];
    }>(allotment.concert);
    if (!concert || !isAuthorizedForConcert(user.email, concert)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (allotment.status === "rejected" || allotment.status === "cancelled") {
      return NextResponse.json({ error: "NOT_EDITABLE" }, { status: 409 });
    }

    const txs: unknown[] = [];
    const allotmentPatch: Record<string, unknown> = {};

    // Contact fields — editable in any non-terminal state.
    if (typeof body.schoolName === "string" && body.schoolName.trim()) {
      allotmentPatch.schoolName = body.schoolName.trim();
    }
    if (body.contactEmail !== undefined) {
      allotmentPatch.contactEmail =
        body.contactEmail?.trim().toLowerCase() || undefined;
    }
    if (body.contactPhone !== undefined) {
      allotmentPatch.contactPhone = body.contactPhone?.trim() || undefined;
    }

    // Composition + price — only before minting.
    if (body.items) {
      if (allotment.status !== "pending" && allotment.status !== "submitted") {
        return NextResponse.json(
          { error: "ALREADY_GENERATED" },
          { status: 400 },
        );
      }

      const cleanItems: ItemInput[] = [];
      for (const it of body.items) {
        if (
          !it ||
          typeof it.ticketTypeId !== "string" ||
          typeof it.quantity !== "number" ||
          !Number.isInteger(it.quantity) ||
          it.quantity <= 0
        ) {
          return NextResponse.json({ error: "invalid item" }, { status: 400 });
        }
        cleanItems.push({ ticketTypeId: it.ticketTypeId, quantity: it.quantity });
      }
      if (cleanItems.length === 0) {
        return NextResponse.json({ error: "items is required" }, { status: 400 });
      }

      // This lot's current committed quantity per type (to release when checking).
      const currentQtyByType = new Map<string, number>();
      for (const it of allotment.items || []) {
        const tt = firstOf<{ id: string }>(it.ticketType);
        if (tt) {
          currentQtyByType.set(
            tt.id,
            (currentQtyByType.get(tt.id) || 0) + it.quantity,
          );
        }
      }

      // Load fresh availability data for the concert's ticket types.
      const { concerts } = await adminDb.query({
        concerts: {
          $: { where: { id: concert.id } },
          ticketTypes: {
            phases: {},
            orders: {},
            reservations: {},
            allotmentItems: {},
          },
        },
      });
      const ticketTypes = ((concerts[0]?.ticketTypes || []) as unknown as {
        id: string;
        price: number;
        quantity: number;
        peoplePerTicket?: number;
        phases?: { id: string }[];
        orders?: {
          id: string;
          status: string;
          phaseId?: string;
          priceSnapshot?: number;
          allotmentId?: string;
        }[];
        reservations?: { quantity: number; expiresAt: number }[];
        allotmentItems?: { quantity: number; status?: string }[];
      }[]);

      const today = getTodayString();
      const wantByType = new Map<string, number>();
      for (const it of cleanItems) {
        wantByType.set(
          it.ticketTypeId,
          (wantByType.get(it.ticketTypeId) || 0) + it.quantity,
        );
      }

      for (const [ttId, want] of wantByType) {
        const tt = ticketTypes.find((t) => t.id === ttId);
        if (!tt) {
          return NextResponse.json(
            { error: "TICKET_TYPE_NOT_FOUND", ticketTypeId: ttId },
            { status: 404 },
          );
        }
        if ((tt.phases || []).length > 0) {
          return NextResponse.json(
            { error: "TICKET_TYPE_HAS_PHASES", ticketTypeId: ttId },
            { status: 400 },
          );
        }
        const activeReservations = (tt.reservations || []).filter(
          (r) => r.expiresAt > Date.now(),
        );
        const committed = committedAllotmentQty(tt.allotmentItems || []);
        const { available } = getAvailability(
          tt,
          [],
          tt.orders || [],
          today,
          activeReservations,
          committed,
        );
        // Releasing our own current hold makes that much extra available to us.
        const availableIfWeRelease = available + (currentQtyByType.get(ttId) || 0);
        if (availableIfWeRelease < want) {
          return NextResponse.json(
            { error: "NOT_ENOUGH_TICKETS", ticketTypeId: ttId, available: availableIfWeRelease },
            { status: 409 },
          );
        }
      }

      // Replace items: delete old, create new (mirroring the lot's status).
      const now = Date.now();
      for (const it of allotment.items || []) {
        txs.push(adminDb.tx.ticketAllotmentItems[it.id].delete());
      }
      for (const it of cleanItems) {
        const itemId = genId();
        txs.push(
          adminDb.tx.ticketAllotmentItems[itemId]
            .update({ quantity: it.quantity, status: allotment.status, createdAt: now })
            .link({ allotment: allotment.id, ticketType: it.ticketTypeId }),
        );
      }
      allotmentPatch.ticketCount = cleanItems.reduce((s, it) => s + it.quantity, 0);
      if (typeof body.totalPrice === "number" && body.totalPrice >= 0) {
        allotmentPatch.totalPrice = body.totalPrice;
      }
    } else if (typeof body.totalPrice === "number" && body.totalPrice >= 0) {
      // Price-only edit (allowed pre-mint).
      if (allotment.status === "pending" || allotment.status === "submitted") {
        allotmentPatch.totalPrice = body.totalPrice;
      }
    }

    if (Object.keys(allotmentPatch).length > 0) {
      txs.push(adminDb.tx.ticketAllotments[id].update(allotmentPatch));
    }
    if (txs.length === 0) {
      return NextResponse.json({ success: true, noop: true });
    }
    await adminDb.transact(txs as never);

    await recordAuditLog({
      action: "allotment.update",
      actorEmail: user.email,
      entityType: "allotment",
      entityId: id,
      concertId: concert.id,
      summary: `Editó lote de ${allotmentPatch.schoolName || allotment.schoolName}`,
      metadata: { fields: Object.keys(allotmentPatch) },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[allotments:update] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
