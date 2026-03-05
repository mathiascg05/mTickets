/**
 * Verify load test results: check that no overselling occurred
 * and all order numbers are unique.
 *
 * Usage: npx tsx scripts/verify-load-test.ts <TICKET_TYPE_ID>
 */
import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;

const adminDb = init({ appId, adminToken, schema });

async function verify() {
  const ticketTypeId = process.argv[2];
  if (!ticketTypeId) {
    console.error("Usage: npx tsx scripts/verify-load-test.ts <TICKET_TYPE_ID>");
    process.exit(1);
  }

  const { ticketTypes } = await adminDb.query({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      orders: {},
    },
  });

  const tt = ticketTypes[0];
  if (!tt) {
    console.error("Ticket type not found");
    process.exit(1);
  }

  const orders = tt.orders as { id: string; status: string; orderNumber?: string }[];
  const activeOrders = orders.filter(
    (o) => o.status === "approved" || o.status === "pending",
  );

  console.log(`Ticket type capacity: ${tt.quantity}`);
  console.log(`Total orders: ${orders.length}`);
  console.log(`Active orders (approved/pending): ${activeOrders.length}`);

  if (activeOrders.length > tt.quantity) {
    console.error(`OVERSOLD! ${activeOrders.length} orders for ${tt.quantity} capacity`);
    process.exit(1);
  } else {
    console.log("No overselling detected");
  }

  // Check order number uniqueness
  const orderNumbers = orders
    .map((o) => o.orderNumber)
    .filter(Boolean) as string[];
  const unique = new Set(orderNumbers);
  if (unique.size !== orderNumbers.length) {
    console.error(
      `DUPLICATE ORDER NUMBERS! ${orderNumbers.length} total, ${unique.size} unique`,
    );
    process.exit(1);
  } else {
    console.log(`All ${orderNumbers.length} order numbers are unique`);
  }

  console.log("\nVerification passed!");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
