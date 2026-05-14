import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { processBroadcastBatch } from "@/lib/broadcastProcessor";

// Up to ~5 minutes total budget on Vercel — but we cap each broadcast's drain
// at ~50s so a single noisy campaign can't starve others on the same tick.
export const maxDuration = 300;

const PER_TICK_DEADLINE_MS = 50_000;
const PER_RUN_BROADCAST_CAP = 4;
const PER_BROADCAST_LIMIT = 80;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Pick broadcasts that are still queued, oldest first.
    const { broadcasts = [] } = await adminDb.query({
      broadcasts: {
        $: {
          where: { processingState: "queued" },
          order: { createdAt: "asc" },
          limit: PER_RUN_BROADCAST_CAP,
        },
      },
    });

    if (broadcasts.length === 0) {
      return NextResponse.json({ processed: 0, results: [] });
    }

    const results: Array<{ broadcastId: string } & Record<string, unknown>> = [];
    for (const b of broadcasts) {
      const deadlineMs = Date.now() + PER_TICK_DEADLINE_MS;
      const r = await processBroadcastBatch(b.id, {
        limit: PER_BROADCAST_LIMIT,
        deadlineMs,
      });
      results.push({ broadcastId: b.id, ...r });
      // If we've burned through most of the function budget, stop early so the
      // next tick can pick up the remaining broadcasts.
      if (Date.now() > deadlineMs + 5_000) break;
    }

    console.log(
      `[process-broadcasts] Processed ${results.length} broadcasts`,
      results,
    );
    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    console.error("[process-broadcasts] Error:", err);
    return NextResponse.json(
      { error: "Failed to process broadcasts" },
      { status: 500 },
    );
  }
}
