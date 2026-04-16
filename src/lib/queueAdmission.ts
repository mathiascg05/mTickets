import { adminDb } from "@/lib/adminDb";
import { MAX_CONCURRENT, ADMITTED_TTL } from "@/lib/queueConstants";

export { MAX_CONCURRENT, QUEUE_THRESHOLD, WAITING_TTL, ADMITTED_TTL } from "@/lib/queueConstants";

/**
 * Process queue admissions for a given ticketType.
 * - Expires stale entries (waiting past expiresAt, admitted past expiresAt)
 * - Admits next N waiting users based on available slots
 * All mutations in a single transact call.
 */
export async function processQueueAdmissions(ticketTypeId: string) {
  const { ticketTypes } = await adminDb.query({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      reservations: {},
      queueEntries: {},
    },
  });

  const ticketType = ticketTypes[0];
  if (!ticketType) return;

  const now = Date.now();
  const entries = ticketType.queueEntries || [];

  // Expire stale entries
  const toExpire = entries.filter(
    (e) =>
      (e.status === "waiting" || e.status === "admitted") &&
      e.expiresAt < now,
  );

  // Count active reservations
  const activeReservations = (ticketType.reservations || []).filter(
    (r) => r.expiresAt > now,
  );

  // Count currently admitted (non-expired) queue entries
  const admittedEntries = entries.filter(
    (e) => e.status === "admitted" && e.expiresAt >= now,
  );

  const activeBuyers = activeReservations.length + admittedEntries.length;
  const availableSlots = Math.max(0, MAX_CONCURRENT - activeBuyers);

  // Get waiting entries sorted by createdAt (FIFO)
  const waitingEntries = entries
    .filter((e) => e.status === "waiting" && e.expiresAt >= now)
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);

  const toAdmit = waitingEntries.slice(0, availableSlots);

  // Build transaction
  const txns = [
    ...toExpire.map((e) =>
      adminDb.tx.queueEntries[e.id].update({ status: "expired" }),
    ),
    ...toAdmit.map((e) =>
      adminDb.tx.queueEntries[e.id].update({
        status: "admitted",
        admittedAt: now,
        expiresAt: now + ADMITTED_TTL,
      }),
    ),
  ];

  if (txns.length > 0) {
    await adminDb.transact(txns);
  }

  return { expired: toExpire.length, admitted: toAdmit.length };
}
