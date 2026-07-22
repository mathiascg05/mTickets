import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessConcert } from "@/lib/authHelpers";
import {
  getAvailability,
  getTodayString,
  committedAllotmentQty,
} from "@/lib/phases";
import { generateOrderToken } from "@/lib/guestListTokens";
import { recordAuditLog } from "@/lib/auditLog";

// The school's management link stays valid through the event; the host can
// revoke it by nulling manageToken and re-issue a fresh one.
const MANAGE_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type ItemInput = { ticketTypeId: string; quantity: number };
type Body = {
  concertId: string;
  schoolName: string;
  contactEmail?: string;
  contactPhone?: string;
  totalPrice: number;
  items: ItemInput[];
  language?: string;
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

    const body = (await req.json()) as Body;
    const {
      concertId,
      schoolName,
      contactEmail,
      contactPhone,
      totalPrice,
      items,
      language,
    } = body;

    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json({ error: "concertId is required" }, { status: 400 });
    }
    if (!schoolName || typeof schoolName !== "string" || !schoolName.trim()) {
      return NextResponse.json({ error: "schoolName is required" }, { status: 400 });
    }
    if (typeof totalPrice !== "number" || totalPrice < 0) {
      return NextResponse.json({ error: "totalPrice is invalid" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }
    // Normalize + validate items
    const cleanItems: ItemInput[] = [];
    for (const it of items) {
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

    const auth = await assertOrganizerCanAccessConcert(user.email, concertId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Load the concert's ticket types with everything needed to check inventory.
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        ticketTypes: {
          phases: {},
          orders: {},
          reservations: {},
          allotmentItems: {},
        },
      },
    });
    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json({ error: "Concert not found" }, { status: 404 });
    }
    const ticketTypes = (concert.ticketTypes || []) as {
      id: string;
      price: number;
      quantity: number;
      peoplePerTicket?: number;
      phases?: { id: string }[];
      orders?: { id: string; status: string; phaseId?: string; priceSnapshot?: number; allotmentId?: string }[];
      reservations?: { quantity: number; expiresAt: number; phaseId?: string }[];
      allotmentItems?: { quantity: number; status?: string }[];
    }[];

    const today = getTodayString();
    // Merge duplicate item lines per ticket type before checking capacity.
    const wantByType = new Map<string, number>();
    for (const it of cleanItems) {
      wantByType.set(it.ticketTypeId, (wantByType.get(it.ticketTypeId) || 0) + it.quantity);
    }

    for (const [ttId, want] of wantByType) {
      const tt = ticketTypes.find((t) => t.id === ttId);
      if (!tt) {
        return NextResponse.json(
          { error: "TICKET_TYPE_NOT_FOUND", ticketTypeId: ttId },
          { status: 404 },
        );
      }
      // v1: allotments only on flat-priced (no-phase) ticket types.
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
        (tt.orders || []) as never,
        today,
        activeReservations,
        committed,
      );
      if (available < want) {
        return NextResponse.json(
          { error: "NOT_ENOUGH_TICKETS", ticketTypeId: ttId, available },
          { status: 409 },
        );
      }
    }

    const ticketCount = cleanItems.reduce((s, it) => s + it.quantity, 0);
    const now = Date.now();
    const allotmentId = genId();
    const manageToken = generateOrderToken();

    const txs: unknown[] = [
      adminDb.tx.ticketAllotments[allotmentId]
        .update({
          schoolName: schoolName.trim(),
          contactEmail: contactEmail?.trim().toLowerCase() || undefined,
          contactPhone: contactPhone?.trim() || undefined,
          status: "pending",
          totalPrice,
          ticketCount,
          manageToken,
          tokenExpiresAt: now + MANAGE_TOKEN_TTL_MS,
          language: language || undefined,
          createdAt: now,
        })
        .link({ concert: concertId }),
    ];
    for (const it of cleanItems) {
      const itemId = genId();
      txs.push(
        adminDb.tx.ticketAllotmentItems[itemId]
          .update({ quantity: it.quantity, status: "pending", createdAt: now })
          .link({ allotment: allotmentId, ticketType: it.ticketTypeId }),
      );
    }
    await adminDb.transact(txs as never);

    await recordAuditLog({
      action: "allotment.create",
      actorEmail: user.email,
      entityType: "allotment",
      entityId: allotmentId,
      concertId,
      summary: `Creó lote para ${schoolName.trim()} (${ticketCount} entradas)`,
      metadata: { schoolName: schoolName.trim(), ticketCount, totalPrice },
    });

    return NextResponse.json({ success: true, allotmentId, manageToken });
  } catch (err) {
    console.error("[allotments:create] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
