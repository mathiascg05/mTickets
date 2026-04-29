import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function run() {
  // Direct query: any order with orderNumber starting FTRT-
  const { orders: ftrtOrders } = await adminDb.query({
    orders: {
      $: { where: { orderNumber: { $like: "FTRT-%" } } },
      ticketType: { concert: {} },
    },
  });
  console.log(`\nOrders with orderNumber LIKE "FTRT-%": ${ftrtOrders.length}`);
  for (const o of ftrtOrders) {
    const oo = o as {
      id: string;
      orderNumber?: string;
      status?: string;
      firstName?: string;
      lastName?: string;
      createdAt?: number;
    };
    const tt = (o as { ticketType?: { id: string; name?: string; concert?: { id: string; name?: string; lastOrderSeq?: number }[] | { id: string; name?: string; lastOrderSeq?: number } } }).ticketType;
    const concert = Array.isArray(tt?.concert) ? tt!.concert![0] : tt?.concert;
    console.log(
      `  ${oo.orderNumber}  status=${oo.status}  id=${oo.id}  name="${oo.firstName} ${oo.lastName}"  createdAt=${oo.createdAt ? new Date(oo.createdAt).toISOString() : "?"}  concert="${concert?.name}" lastOrderSeq=${concert?.lastOrderSeq}`,
    );
  }

  // Also check live concert state right now
  const { concerts } = await adminDb.query({
    concerts: {
      $: { where: { id: "963cc286-41f6-4854-8c73-2bbf14fe4186" } },
    },
  });
  console.log(`\nLive concert state:`);
  for (const c of concerts) {
    const cc = c as { id: string; name: string; lastOrderSeq?: number };
    console.log(`  "${cc.name}"  lastOrderSeq=${cc.lastOrderSeq}`);
  }
}

run().catch(console.error);
