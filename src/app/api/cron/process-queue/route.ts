import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { processQueueAdmissions } from "@/lib/queueAdmission";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find all ticketTypes that have active queue entries
    const { queueEntries } = await adminDb.query({
      queueEntries: {
        $: {
          where: { or: [{ status: "waiting" }, { status: "admitted" }] },
        },
        ticketType: {},
      },
    });

    // Deduplicate by ticketType ID
    const ticketTypeIds = new Set<string>();
    for (const entry of queueEntries) {
      if (entry.ticketType?.id) {
        ticketTypeIds.add(entry.ticketType.id);
      }
    }

    const resultsArr = await Promise.all(
      [...ticketTypeIds].map(async (ttId) => {
        const result = await processQueueAdmissions(ttId);
        return [ttId, result] as const;
      }),
    );
    const results: Record<string, { expired: number; admitted: number }> = {};
    for (const [ttId, result] of resultsArr) {
      if (result) {
        results[ttId] = result;
      }
    }

    console.log(`[process-queue] Processed ${ticketTypeIds.size} ticket types`, results);
    return NextResponse.json({ processed: ticketTypeIds.size, results });
  } catch (err) {
    console.error("[process-queue] Error:", err);
    return NextResponse.json(
      { error: "Failed to process queue" },
      { status: 500 },
    );
  }
}
