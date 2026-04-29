import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const LIVE_CONCERT_ID = "3647f617-e22e-49bc-b451-cb06986985b7"; // AFTER 4TOVS5TO MERICI
const NEW_SEQ = 10; // safe buffer above test concert's lastOrderSeq=1

async function run() {
  const { concerts } = await adminDb.query({
    concerts: { $: { where: { id: LIVE_CONCERT_ID } } },
  });
  const c = concerts[0] as { id: string; name: string; lastOrderSeq?: number } | undefined;
  if (!c) {
    console.error("Concert not found:", LIVE_CONCERT_ID);
    process.exit(1);
  }
  console.log(`BEFORE: "${c.name}"  lastOrderSeq=${c.lastOrderSeq ?? 0}`);

  await adminDb.transact([
    adminDb.tx.concerts[LIVE_CONCERT_ID].update({ lastOrderSeq: NEW_SEQ }),
  ]);

  const { concerts: after } = await adminDb.query({
    concerts: { $: { where: { id: LIVE_CONCERT_ID } } },
  });
  const ca = after[0] as { lastOrderSeq?: number };
  console.log(`AFTER:  lastOrderSeq=${ca.lastOrderSeq}`);
  console.log(`Next order will be FTRT-${String((ca.lastOrderSeq ?? 0) + 1).padStart(4, "0")}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
