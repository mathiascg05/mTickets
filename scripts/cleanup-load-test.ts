import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const TICKET_TYPE_ID = "8921087b-b236-4976-bf1d-0022082627f2";

async function cleanup() {
  // 1. Delete load test orders (firstName === "Load")
  const { orders } = await db.query({
    orders: {
      $: { where: { "ticketType.id": TICKET_TYPE_ID } },
    },
  });

  const loadTestOrders = orders.filter((o) => o.firstName === "Load");
  console.log(`Found ${loadTestOrders.length} load test orders to delete`);

  if (loadTestOrders.length > 0) {
    // Batch in groups of 100 to avoid transaction limits
    for (let i = 0; i < loadTestOrders.length; i += 100) {
      const batch = loadTestOrders.slice(i, i + 100);
      await db.transact(batch.map((o) => db.tx.orders[o.id].delete()));
      console.log(`  Deleted batch ${Math.floor(i / 100) + 1} (${batch.length} orders)`);
    }
  }

  // 2. Clean up queue entries for this ticket type
  const { queueEntries } = await db.query({
    queueEntries: {
      $: { where: { "ticketType.id": TICKET_TYPE_ID } },
    },
  });

  console.log(`Found ${queueEntries.length} queue entries to delete`);

  if (queueEntries.length > 0) {
    for (let i = 0; i < queueEntries.length; i += 100) {
      const batch = queueEntries.slice(i, i + 100);
      await db.transact(batch.map((e) => db.tx.queueEntries[e.id].delete()));
      console.log(`  Deleted batch ${Math.floor(i / 100) + 1} (${batch.length} entries)`);
    }
  }

  // 3. Reset lastQueuePosition on the ticket type
  await db.transact([
    db.tx.ticketTypes[TICKET_TYPE_ID].update({ lastQueuePosition: 0 }),
  ]);
  console.log("Reset lastQueuePosition to 0");

  // 4. Clean up expired reservations
  const { reservations } = await db.query({
    reservations: {
      $: { where: { "ticketType.id": TICKET_TYPE_ID } },
    },
  });

  console.log(`Found ${reservations.length} reservations to delete`);

  if (reservations.length > 0) {
    for (let i = 0; i < reservations.length; i += 100) {
      const batch = reservations.slice(i, i + 100);
      await db.transact(batch.map((r) => db.tx.reservations[r.id].delete()));
      console.log(`  Deleted batch ${Math.floor(i / 100) + 1} (${batch.length} reservations)`);
    }
  }

  // Verify
  const { orders: remaining } = await db.query({
    orders: {
      $: { where: { "ticketType.id": TICKET_TYPE_ID } },
    },
  });
  console.log(`\nRemaining orders for ticket type: ${remaining.length}`);
  console.log("Cleanup complete!");
}

cleanup().catch(console.error);
