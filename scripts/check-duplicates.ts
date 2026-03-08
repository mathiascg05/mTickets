import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;
const db = init({ appId, adminToken, schema });

async function main() {
  const ticketTypeId = process.argv[2];
  const { ticketTypes } = await db.query({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      orders: {},
    },
  });

  const orders = ticketTypes[0]?.orders as {
    id: string;
    orderNumber?: string;
    firstName: string;
    lastName: string;
    createdAt: number;
  }[];

  if (!orders) {
    console.log("No orders found");
    return;
  }

  // Find duplicates
  const byNumber: Record<string, typeof orders> = {};
  for (const o of orders) {
    const num = o.orderNumber || "NONE";
    if (!byNumber[num]) byNumber[num] = [];
    byNumber[num].push(o);
  }

  console.log("Duplicate order numbers:");
  for (const [num, dupes] of Object.entries(byNumber)) {
    if (dupes.length > 1) {
      console.log(`\n  ${num} (${dupes.length} orders):`);
      for (const d of dupes) {
        console.log(
          `    ${d.id} - ${d.firstName} ${d.lastName} - created: ${new Date(d.createdAt).toISOString()}`,
        );
      }
    }
  }
}

main().catch(console.error);
