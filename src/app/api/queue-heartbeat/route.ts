import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
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
        ticketType: {
          queueEntries: {},
        },
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
        position: 0,
        totalWaiting: 0,
        estimatedWaitMin: 0,
      });
    }

    // Extend TTL for waiting and admitted entries
    const newExpiresAt =
      entry.status === "waiting"
        ? Date.now() + WAITING_TTL
        : Date.now() + ADMITTED_TTL;

    await adminDb.transact(
      adminDb.tx.queueEntries[queueEntryId].update({
        expiresAt: newExpiresAt,
      }),
    );

    // Calculate position from sibling queue entries
    const now = Date.now();
    const allEntries = entry.ticketType?.queueEntries || [];
    const waitingAhead =
      entry.status === "waiting"
        ? allEntries.filter(
            (e: { status: string; expiresAt: number; position: number }) =>
              e.status === "waiting" &&
              e.expiresAt > now &&
              e.position < entry.position,
          ).length
        : 0;

    const totalWaiting = allEntries.filter(
      (e: { status: string; expiresAt: number }) =>
        e.status === "waiting" && e.expiresAt > now,
    ).length;

    const estimatedWaitMin = Math.max(1, Math.ceil((waitingAhead * 30) / 60));

    return NextResponse.json({
      status: entry.status,
      position: waitingAhead + 1,
      totalWaiting,
      estimatedWaitMin,
    });
  } catch (err) {
    console.error("[queue-heartbeat] Error:", err);
    return NextResponse.json(
      { error: "Failed to process heartbeat" },
      { status: 500 },
    );
  }
}
