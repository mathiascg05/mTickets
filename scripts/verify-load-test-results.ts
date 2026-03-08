import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function verify() {
  const ticketTypeId = "8921087b-b236-4976-bf1d-0022082627f2";
  const { orders } = await db.query({
    orders: {
      $: { where: { "ticketType.id": ticketTypeId } },
    },
  });

  console.log(`Total orders: ${orders.length}`);

  // Check for duplicates
  const orderNumbers = orders.map((o) => o.orderNumber).filter(Boolean);
  const unique = new Set(orderNumbers);
  console.log(`Unique order numbers: ${unique.size}`);
  console.log(`Duplicate order numbers: ${orderNumbers.length - unique.size}`);

  // Find any duplicates
  const counts: Record<string, number> = {};
  for (const num of orderNumbers) {
    counts[num!] = (counts[num!] || 0) + 1;
  }
  const dups = Object.entries(counts).filter(([, c]) => c > 1);
  if (dups.length > 0) {
    console.log("\nDuplicate order numbers found:");
    for (const [num, count] of dups) {
      console.log(`  ${num}: ${count} orders`);
    }
  } else {
    console.log("\n✅ No duplicate order numbers found!");
  }

  // Status distribution
  const statusCounts: Record<string, number> = {};
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }
  console.log("\nOrder status distribution:", statusCounts);

  // Count load test orders (created in last 10 min)
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const recentOrders = orders.filter((o) => o.createdAt > tenMinAgo);
  console.log(`\nOrders created in last 10 min: ${recentOrders.length}`);
}

verify().catch(console.error);
