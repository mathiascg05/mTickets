/**
 * One-time backfill script for assigning order numbers to existing orders.
 * Run with: npx tsx --env-file=.env scripts/backfill-order-numbers.ts
 */
import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";
import { generatePrefix, formatOrderNumber } from "../src/lib/orderNumber";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function backfill() {
  console.log("Querying all concerts with orders...");

  const { concerts } = await adminDb.query({
    concerts: {
      ticketTypes: {
        orders: {},
      },
    },
  });

  console.log(`Found ${concerts.length} concerts`);

  for (const concert of concerts) {
    const prefix = generatePrefix(concert.name);
    console.log(`\nConcert: ${concert.name} (prefix: ${prefix})`);

    // Collect all orders across ticket types
    const allOrders: { id: string; orderNumber?: string; createdAt: number }[] = [];
    const ticketTypes = concert.ticketTypes as { orders: { id: string; orderNumber?: string; createdAt: number }[] }[];
    for (const tt of ticketTypes) {
      for (const order of tt.orders) {
        allOrders.push(order);
      }
    }

    // Sort by createdAt ascending
    allOrders.sort((a, b) => a.createdAt - b.createdAt);

    let seq = 0;
    const txns = [];

    for (const order of allOrders) {
      seq++;
      if (order.orderNumber) {
        console.log(`  #${seq} ${order.id} — already has ${order.orderNumber}, skipping`);
        continue;
      }
      const orderNumber = formatOrderNumber(prefix, seq);
      console.log(`  #${seq} ${order.id} → ${orderNumber}`);
      txns.push(adminDb.tx.orders[order.id].update({ orderNumber }));
    }

    if (txns.length > 0) {
      await adminDb.transact(txns);
      console.log(`  Assigned ${txns.length} order numbers`);
    } else {
      console.log(`  No orders to backfill`);
    }
  }

  console.log("\nDone!");
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
