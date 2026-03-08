import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;

const db = init({ appId, adminToken, schema });

async function main() {
  const { ticketTypes } = await db.query({
    ticketTypes: {
      concert: {},
      orders: {},
    },
  });

  console.log("\nAvailable ticket types:\n");
  for (const tt of ticketTypes) {
    const rawConcert = tt.concert as unknown;
    const c = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as {
      name?: string;
    } | undefined;
    const orders = tt.orders as { status: string }[];
    const activeOrders = orders.filter(
      (o) => o.status === "approved" || o.status === "pending",
    ).length;
    console.log(
      `  ID: ${tt.id}\n  Concert: ${c?.name || "?"}\n  Type: ${tt.name}\n  Capacity: ${tt.quantity}\n  Active orders: ${activeOrders}\n  Available: ${tt.quantity - activeOrders}\n`,
    );
  }
}

main().catch(console.error);
