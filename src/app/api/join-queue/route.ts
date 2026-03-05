import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID, isValidQty } from "@/lib/validation";
import { processQueueAdmissions } from "@/lib/queueAdmission";
import { WAITING_TTL } from "@/lib/queueConstants";

export async function POST(req: NextRequest) {
  try {
    const { ticketTypeId, qty, sessionId } = await req.json();

    if (!isValidUUID(ticketTypeId)) {
      return NextResponse.json(
        { error: "Invalid ticketTypeId format" },
        { status: 400 },
      );
    }
    if (!isValidQty(qty)) {
      return NextResponse.json(
        { error: "qty must be an integer between 1 and 10" },
        { status: 400 },
      );
    }
    if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 100) {
      return NextResponse.json(
        { error: "Invalid sessionId" },
        { status: 400 },
      );
    }

    // Check for existing active entry for this session (idempotent)
    const { queueEntries: existing } = await adminDb.query({
      queueEntries: {
        $: {
          where: {
            and: [
              { sessionId },
              { or: [{ status: "waiting" }, { status: "admitted" }] },
            ],
          },
        },
        ticketType: {},
      },
    });

    const existingForTicket = existing.filter(
      (e) => e.ticketType?.id === ticketTypeId && e.expiresAt > Date.now(),
    );

    if (existingForTicket.length > 0) {
      const entry = existingForTicket[0];
      // Piggyback admission processing
      await processQueueAdmissions(ticketTypeId);
      return NextResponse.json({
        queueEntryId: entry.id,
        position: entry.position,
        status: entry.status,
      });
    }

    // Query ticketType to get lastQueuePosition
    const { ticketTypes } = await adminDb.query({
      ticketTypes: {
        $: { where: { id: ticketTypeId } },
      },
    });

    const ticketType = ticketTypes[0];
    if (!ticketType) {
      return NextResponse.json(
        { error: "Ticket type not found" },
        { status: 404 },
      );
    }

    // Atomic position counter
    const nextPosition = (ticketType.lastQueuePosition || 0) + 1;
    const now = Date.now();
    const queueEntryId = genId();

    await adminDb.transact([
      adminDb.tx.ticketTypes[ticketTypeId].update({
        lastQueuePosition: nextPosition,
      }),
      adminDb.tx.queueEntries[queueEntryId]
        .update({
          sessionId,
          status: "waiting",
          position: nextPosition,
          quantity: qty,
          expiresAt: now + WAITING_TTL,
          createdAt: now,
        })
        .link({ ticketType: ticketTypeId }),
    ]);

    // Piggyback admission processing
    await processQueueAdmissions(ticketTypeId);

    // Re-query to get current status (may have been immediately admitted)
    const { queueEntries: updated } = await adminDb.query({
      queueEntries: {
        $: { where: { id: queueEntryId } },
      },
    });

    const currentStatus = updated[0]?.status || "waiting";

    return NextResponse.json({
      queueEntryId,
      position: nextPosition,
      status: currentStatus,
    });
  } catch (err) {
    console.error("[join-queue] Error:", err);
    return NextResponse.json(
      { error: "Failed to join queue" },
      { status: 500 },
    );
  }
}
