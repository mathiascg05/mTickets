import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function run() {
  const { ticketTypes } = await db.query({
    ticketTypes: {
      $: { where: { id: "8921087b-b236-4976-bf1d-0022082627f2" } },
      concert: {},
    },
  });
  const tt = ticketTypes[0];
  const rawConcert = tt.concert as unknown;
  const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as {
    id: string;
    name: string;
    lastOrderSeq?: number;
  };
  console.log(
    `Concert: ${concert.name} (${concert.id}), lastOrderSeq: ${concert.lastOrderSeq}`,
  );
  await db.transact([db.tx.concerts[concert.id].update({ lastOrderSeq: 0 })]);
  console.log("Reset lastOrderSeq to 0");
}

run().catch(console.error);
