import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";
import { generatePrefix, pickUniquePrefix } from "../src/lib/orderNumber";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function run() {
  const { concerts } = await adminDb.query({ concerts: {} });

  const sorted = [...concerts]
    .map((c) => c as { id: string; name: string; createdAt?: number; orderNumberPrefix?: string })
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  const taken = new Set<string>();
  for (const c of sorted) {
    if (typeof c.orderNumberPrefix === "string" && c.orderNumberPrefix.length > 0) {
      taken.add(c.orderNumberPrefix);
    }
  }

  let assigned = 0;
  let unchanged = 0;

  for (const c of sorted) {
    if (typeof c.orderNumberPrefix === "string" && c.orderNumberPrefix.length > 0) {
      console.log(
        `SKIP  "${c.name}" (id=${c.id})  already has prefix=${c.orderNumberPrefix}`,
      );
      unchanged++;
      continue;
    }

    const base = generatePrefix(c.name);
    const prefix = pickUniquePrefix(c.name, taken);
    const collision = prefix !== base;

    await adminDb.transact([
      adminDb.tx.concerts[c.id].update({ orderNumberPrefix: prefix }),
    ]);
    taken.add(prefix);
    assigned++;

    const note = collision ? `  (base=${base} was taken, mutated)` : "";
    console.log(
      `SET   "${c.name}" (id=${c.id})  prefix=${prefix}${note}`,
    );
  }

  console.log(
    `\nDone. assigned=${assigned}  already-set=${unchanged}  total=${sorted.length}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
