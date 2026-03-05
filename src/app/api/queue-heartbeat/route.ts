import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { processQueueAdmissions } from "@/lib/queueAdmission";
import { WAITING_TTL, ADMITTED_TTL } from "@/lib/queueConstants";

export async function POST(req: NextRequest) {
  try {
    const { queueEntryId } = await req.json();

    if (!isValidUUID(queueEntryId)) {
      return NextResponse.json(
        { error: "Invalid queueEntryId format" },
        { status: 400 },
      );
    }

    const { queueEntries } = await adminDb.query({
      queueEntries: {
        $: { where: { id: queueEntryId } },
        ticketType: {},
      },
    });

    const entry = queueEntries[0];
    if (!entry) {
      return NextResponse.json(
        { error: "Queue entry not found" },
        { status: 404 },
      );
    }

    if (entry.status !== "waiting" && entry.status !== "admitted") {
      return NextResponse.json({
        status: entry.status,
      });
    }

    const ticketTypeId = entry.ticketType?.id;
    if (!ticketTypeId) {
      return NextResponse.json(
        { error: "Queue entry has no linked ticketType" },
        { status: 500 },
      );
    }

    // Extend TTL for waiting and admitted entries
    if (entry.status === "waiting") {
      await adminDb.transact(
        adminDb.tx.queueEntries[queueEntryId].update({
          expiresAt: Date.now() + WAITING_TTL,
        }),
      );
    } else if (entry.status === "admitted") {
      await adminDb.transact(
        adminDb.tx.queueEntries[queueEntryId].update({
          expiresAt: Date.now() + ADMITTED_TTL,
        }),
      );
    }

    // Piggyback admission processing
    await processQueueAdmissions(ticketTypeId);

    // Re-query to get current status
    const { queueEntries: updated } = await adminDb.query({
      queueEntries: {
        $: { where: { id: queueEntryId } },
      },
    });

    return NextResponse.json({
      status: updated[0]?.status || entry.status,
    });
  } catch (err) {
    console.error("[queue-heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Failed to process heartbeat" },
      { status: 500 },
    );
  }
}
