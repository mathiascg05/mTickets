import "dotenv/config";
import { adminDb } from "@/lib/adminDb";

/**
 * Backfill broadcast counters from delivery rows. Useful one-shot for any
 * campaign whose recipientCount drifted (e.g. the Pago After Andes one that
 * showed 37/35).
 *
 * Usage: npx tsx scripts/backfill-broadcast-counters.ts [broadcastId]
 *   - if no id given, runs over every broadcast that has delivery rows
 */
async function recomputeFor(broadcastId: string): Promise<void> {
  const buckets = await Promise.all(
    (["sent", "failed", "pending", "in_flight", "suppressed"] as const).map(
      async (status) => {
        const { broadcastDeliveries = [] } = await adminDb.query({
          broadcastDeliveries: {
            $: {
              where: { "broadcast.id": broadcastId, deliveryStatus: status },
            },
          },
        });
        return [status, broadcastDeliveries.length] as const;
      },
    ),
  );
  const counts = Object.fromEntries(buckets) as Record<
    "sent" | "failed" | "pending" | "in_flight" | "suppressed",
    number
  >;

  const recipientCount =
    counts.sent + counts.failed + counts.pending + counts.in_flight;
  const remaining = counts.pending + counts.in_flight;
  const update: Record<string, unknown> = {
    recipientCount,
    sentCount: counts.sent,
    failedCount: counts.failed,
    suppressedCount: counts.suppressed,
  };
  if (remaining === 0) {
    update.processingState = "done";
    update.status = counts.sent === 0 && counts.failed > 0 ? "failed" : "sent";
  }
  await adminDb.transact(adminDb.tx.broadcasts[broadcastId].update(update));
  console.log(broadcastId, "→", { recipientCount, ...counts });
}

async function main() {
  const arg = process.argv[2];
  if (arg) {
    await recomputeFor(arg);
    return;
  }
  const { broadcasts = [] } = await adminDb.query({
    broadcasts: {
      $: { order: { createdAt: "desc" } },
      deliveries: { $: { where: { deliveryStatus: "sent" } } },
    },
  });
  let touched = 0;
  for (const b of broadcasts) {
    const ds = (b as { deliveries?: unknown[] }).deliveries ?? [];
    if (ds.length === 0) continue;
    await recomputeFor(b.id);
    touched += 1;
  }
  console.log(`\nDone. Recomputed ${touched} broadcast(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
