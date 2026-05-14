import { adminDb } from "@/lib/adminDb";
import {
  CHUNK_SIZE,
  CHUNK_DELAY_MS,
  sendOneEmail,
  sleep,
  type BroadcastEmailParams,
} from "@/lib/broadcastSend";
import type { BroadcastRecipient } from "@/lib/broadcastRecipients";
import { isEmailSuppressed } from "@/lib/emailSuppression";

const STALE_CLAIM_MS = 5 * 60_000;
const MAX_TRANSIENT_ATTEMPTS = 5;

function genWorkerId(): string {
  const region = process.env.VERCEL_REGION ?? "local";
  return `${region}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type DeliveryRow = {
  id: string;
  email: string;
  emailDisplay: string;
  firstName: string;
  lastName: string;
  ticketTypeName: string;
  paymentMethod: string;
  orderStatus: string;
  language?: string;
  attempts: number;
};

function rowToRecipient(row: DeliveryRow): BroadcastRecipient {
  return {
    email: row.emailDisplay || row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    ticketTypeName: row.ticketTypeName,
    paymentMethod: row.paymentMethod,
    status: row.orderStatus,
    language: row.language,
  };
}

export async function reclaimStuckDeliveries(broadcastId: string): Promise<number> {
  const cutoff = Date.now() - STALE_CLAIM_MS;
  const { broadcastDeliveries: stale = [] } = await adminDb.query({
    broadcastDeliveries: {
      $: {
        where: {
          "broadcast.id": broadcastId,
          deliveryStatus: "in_flight",
          claimedAt: { $lt: cutoff },
        },
        limit: 200,
      },
    },
  });
  if (stale.length === 0) return 0;
  await adminDb.transact(
    stale.map((d) =>
      adminDb.tx.broadcastDeliveries[d.id].update({
        deliveryStatus: "pending",
        claimToken: undefined,
        claimedAt: undefined,
      }),
    ),
  );
  return stale.length;
}

async function recomputeBroadcastCounters(broadcastId: string): Promise<{
  sent: number;
  failed: number;
  pending: number;
  inFlight: number;
  suppressed: number;
}> {
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
  return {
    sent: counts.sent,
    failed: counts.failed,
    pending: counts.pending,
    inFlight: counts.in_flight,
    suppressed: counts.suppressed,
  };
}

export type ProcessOptions = {
  /** Max deliveries to claim in this run. Bound by Resend rate too. */
  limit: number;
  /** Wall-clock cutoff (ms epoch). Loop hands back to the next tick when exceeded. */
  deadlineMs: number;
};

export type ProcessResult = {
  claimed: number;
  sent: number;
  failed: number;
  retryable: number;
  drained: boolean;
};

/**
 * Process one batch of pending deliveries for a broadcast. Safe to invoke
 * concurrently — uses an optimistic claim+re-read pattern on `claimToken`.
 */
export async function processBroadcastBatch(
  broadcastId: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  const workerId = genWorkerId();
  const { limit, deadlineMs } = options;

  // 1. Reclaim claims from dead workers.
  await reclaimStuckDeliveries(broadcastId);

  // 2. Load broadcast + concert (needed for the email template params).
  const { broadcasts = [] } = await adminDb.query({
    broadcasts: {
      $: { where: { id: broadcastId } },
      concert: {},
    },
  });
  const broadcast = broadcasts[0];
  if (!broadcast) {
    return { claimed: 0, sent: 0, failed: 0, retryable: 0, drained: true };
  }
  const concert = Array.isArray(broadcast.concert)
    ? broadcast.concert[0]
    : broadcast.concert;
  if (!concert) {
    return { claimed: 0, sent: 0, failed: 0, retryable: 0, drained: true };
  }

  // 3. Read a batch of pending rows.
  const { broadcastDeliveries: candidates = [] } = await adminDb.query({
    broadcastDeliveries: {
      $: {
        where: { "broadcast.id": broadcastId, deliveryStatus: "pending" },
        order: { createdAt: "asc" },
        limit,
      },
    },
  });

  if (candidates.length === 0) {
    // Drained: finalise broadcast status if needed.
    await maybeFinaliseBroadcast(broadcastId);
    return { claimed: 0, sent: 0, failed: 0, retryable: 0, drained: true };
  }

  // 4. Optimistic claim.
  const claimTime = Date.now();
  await adminDb.transact(
    candidates.map((d) =>
      adminDb.tx.broadcastDeliveries[d.id].update({
        deliveryStatus: "in_flight",
        claimToken: workerId,
        claimedAt: claimTime,
      }),
    ),
  );

  // 5. Re-read by claimToken to confirm ownership.
  const { broadcastDeliveries: ownedRaw = [] } = await adminDb.query({
    broadcastDeliveries: {
      $: {
        where: { claimToken: workerId, deliveryStatus: "in_flight" },
      },
    },
  });
  const owned: DeliveryRow[] = ownedRaw.map((d) => ({
    id: d.id,
    email: (d as { email?: string }).email ?? "",
    emailDisplay: (d as { emailDisplay?: string }).emailDisplay ?? "",
    firstName: (d as { firstName?: string }).firstName ?? "",
    lastName: (d as { lastName?: string }).lastName ?? "",
    ticketTypeName: (d as { ticketTypeName?: string }).ticketTypeName ?? "",
    paymentMethod: (d as { paymentMethod?: string }).paymentMethod ?? "",
    orderStatus: (d as { orderStatus?: string }).orderStatus ?? "",
    language: (d as { language?: string }).language,
    attempts: (d as { attempts?: number }).attempts ?? 0,
  }));

  if (owned.length === 0) {
    return { claimed: 0, sent: 0, failed: 0, retryable: 0, drained: false };
  }

  // 6. Mark broadcast as actively draining + bump worker timestamp.
  await adminDb.transact(
    adminDb.tx.broadcasts[broadcastId].update({
      processingState: "draining",
      lastWorkerAt: Date.now(),
    }),
  );

  const params: BroadcastEmailParams = {
    eventName: (concert as { name: string }).name,
    subject: (broadcast as { subject: string }).subject,
    body: (broadcast as { body: string }).body,
    organizerEmail: (concert as { organizerEmail: string }).organizerEmail,
    concertDefaultLanguage: (concert as { defaultLanguage?: string })
      .defaultLanguage,
  };

  let sent = 0;
  let failed = 0;
  let retryable = 0;

  for (let i = 0; i < owned.length; i += CHUNK_SIZE) {
    if (Date.now() > deadlineMs) {
      // Hand the rest back to the next tick: release un-attempted rows.
      const remaining = owned.slice(i);
      if (remaining.length > 0) {
        await adminDb.transact(
          remaining.map((d) =>
            adminDb.tx.broadcastDeliveries[d.id].update({
              deliveryStatus: "pending",
              claimToken: undefined,
              claimedAt: undefined,
            }),
          ),
        );
      }
      break;
    }

    const chunk = owned.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((row) => sendOneEmail(rowToRecipient(row), params)),
    );

    const updates = results.map((res, idx) => {
      const row = chunk[idx];
      const newAttempts = row.attempts + 1;
      const now = Date.now();
      if (res.ok) {
        sent += 1;
        return adminDb.tx.broadcastDeliveries[row.id].update({
          deliveryStatus: "sent",
          attempts: newAttempts,
          lastTriedAt: now,
          sentAt: now,
          claimToken: undefined,
          claimedAt: undefined,
          reason: undefined,
        });
      }
      // Decide between transient (back to pending for retry) and permanent.
      if (res.transient && newAttempts < MAX_TRANSIENT_ATTEMPTS) {
        retryable += 1;
        return adminDb.tx.broadcastDeliveries[row.id].update({
          deliveryStatus: "pending",
          attempts: newAttempts,
          lastTriedAt: now,
          reason: res.reason,
          claimToken: undefined,
          claimedAt: undefined,
        });
      }
      failed += 1;
      return adminDb.tx.broadcastDeliveries[row.id].update({
        deliveryStatus: "failed",
        attempts: newAttempts,
        lastTriedAt: now,
        failedAt: now,
        reason: res.reason,
        claimToken: undefined,
        claimedAt: undefined,
      });
    });
    await adminDb.transact(updates);

    if (i + CHUNK_SIZE < owned.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  await maybeFinaliseBroadcast(broadcastId);

  return {
    claimed: owned.length,
    sent,
    failed,
    retryable,
    drained: false,
  };
}

async function maybeFinaliseBroadcast(broadcastId: string): Promise<void> {
  const counts = await recomputeBroadcastCounters(broadcastId);
  const remaining = counts.pending + counts.inFlight;

  // recipientCount is fixed at create time; we only refresh sent/failed.
  // suppressedCount also includes any rows that were suppressed at create time
  // OR were re-suppressed between attempts.
  const update: Record<string, unknown> = {
    sentCount: counts.sent,
    failedCount: counts.failed,
    suppressedCount: counts.suppressed,
  };
  if (remaining === 0) {
    update.processingState = "done";
    update.status =
      counts.sent === 0 && counts.failed > 0 ? "failed" : "sent";
    update.completedAt = Date.now();
  } else {
    update.processingState = "queued";
  }
  await adminDb.transact(adminDb.tx.broadcasts[broadcastId].update(update));
}

/**
 * Re-check suppression for a set of failed deliveries and either flip them to
 * `suppressed` (if newly bounced/complained) or back to `pending` for another
 * attempt. Used by the retry endpoint.
 *
 * Returns the number of rows actually flipped to `pending` (retry-eligible).
 */
export async function requeueFailedDeliveries(
  broadcastId: string,
  options: { includeSent?: boolean } = {},
): Promise<{ requeued: number; suppressed: number }> {
  const statuses = options.includeSent
    ? ["failed", "sent"]
    : ["failed"];
  const { broadcastDeliveries: rows = [] } = await adminDb.query({
    broadcastDeliveries: {
      $: {
        where: {
          "broadcast.id": broadcastId,
          deliveryStatus: { $in: statuses },
        },
      },
    },
  });
  if (rows.length === 0) return { requeued: 0, suppressed: 0 };

  let requeued = 0;
  let suppressed = 0;
  const txs: ReturnType<typeof adminDb.tx.broadcastDeliveries[string]["update"]>[] = [];
  for (const row of rows) {
    const email = (row as { email?: string }).email ?? "";
    if (email && (await isEmailSuppressed(email))) {
      suppressed += 1;
      txs.push(
        adminDb.tx.broadcastDeliveries[row.id].update({
          deliveryStatus: "suppressed",
          reason: undefined,
          claimToken: undefined,
          claimedAt: undefined,
        }),
      );
    } else {
      requeued += 1;
      txs.push(
        adminDb.tx.broadcastDeliveries[row.id].update({
          deliveryStatus: "pending",
          reason: undefined,
          claimToken: undefined,
          claimedAt: undefined,
        }),
      );
    }
  }
  if (txs.length > 0) {
    // Chunk into batches of 100 to keep individual transactions reasonable.
    for (let i = 0; i < txs.length; i += 100) {
      await adminDb.transact(txs.slice(i, i + 100));
    }
  }
  return { requeued, suppressed };
}
