import "dotenv/config";
import { adminDb } from "@/lib/adminDb";
import { resolveRecipients, type BroadcastFilters } from "@/lib/broadcastRecipients";

async function main() {
  const broadcastId = "2f6ad886-d1be-4ec8-8258-8429e8425ac2";

  const { broadcasts = [] } = await adminDb.query({
    broadcasts: {
      $: { where: { id: broadcastId } },
      deliveries: {},
      concert: {},
    },
  });
  const b = broadcasts[0];
  if (!b) {
    console.log("Broadcast not found");
    return;
  }

  console.log("=== Broadcast (DB state) ===");
  console.log({
    recipientCount: b.recipientCount,
    sentCount: b.sentCount,
    failedCount: b.failedCount,
    suppressedCount: b.suppressedCount,
  });

  const deliveries = (b as { deliveries?: Array<Record<string, unknown>> }).deliveries ?? [];
  console.log(`Delivery rows in DB: ${deliveries.length}`);

  const concert = Array.isArray(b.concert) ? b.concert[0] : b.concert;
  if (!concert) {
    console.log("No concert linked");
    return;
  }
  const concertId = (concert as { id: string }).id;
  console.log(`Concert: ${(concert as { name: string }).name} (${concertId})`);

  const filters: BroadcastFilters = JSON.parse(b.filtersJson as string);
  console.log("\n=== Filters ===", filters);

  // Re-run resolver NOW with the saved filters.
  const resolved = await resolveRecipients(concertId, filters);
  console.log(`\n=== resolveRecipients NOW ===`);
  console.log({
    recipients: resolved.recipients.length,
    suppressedEmails: resolved.suppressedEmails.length,
    total: resolved.recipients.length + resolved.suppressedEmails.length,
  });

  // Diff: which emails are in DB but not in resolver result, and vice-versa.
  const dbEmails = new Set(deliveries.map((d) => String(d.email ?? "").toLowerCase()).filter(Boolean));
  const resolverEmails = new Set([
    ...resolved.recipients.map((r) => r.email.toLowerCase()),
    ...resolved.suppressedEmails.map((e) => e.toLowerCase()),
  ]);

  const inDbNotResolver = [...dbEmails].filter((e) => !resolverEmails.has(e));
  const inResolverNotDb = [...resolverEmails].filter((e) => !dbEmails.has(e));

  console.log(`\nIn DB but NOT in resolver (${inDbNotResolver.length}):`);
  inDbNotResolver.forEach((e) => console.log(" ", e));
  console.log(`\nIn resolver but NOT in DB (${inResolverNotDb.length}):`);
  inResolverNotDb.forEach((e) => console.log(" ", e));

  // Also: pull all matching orders RAW (no dedup) to see if 35-vs-37 might be
  // a dedup-vs-row-count discrepancy.
  console.log(`\n=== RAW order count for these filters ===`);
  const where: Record<string, unknown> = {
    "ticketType.concert.id": concertId,
  };
  if (filters.orderStatuses?.length) where.status = { $in: filters.orderStatuses };
  if (filters.ticketTypeIds?.length) where["ticketType.id"] = { $in: filters.ticketTypeIds };
  // Note: payment method filter expansion handled inside resolveRecipients.
  const { orders = [] } = await adminDb.query({
    orders: {
      $: { where: where as never },
    },
  });
  console.log(`Total raw orders matching filters (no PM filter): ${orders.length}`);
  const uniqueEmails = new Set(orders.map((o) => String((o as { email?: string }).email ?? "").toLowerCase()).filter(Boolean));
  console.log(`Unique emails among raw orders: ${uniqueEmails.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
