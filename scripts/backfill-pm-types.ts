/**
 * One-time script to backfill the `type` field on existing paymentMethods records.
 * Run with: npx tsx scripts/backfill-pm-types.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
// Load .env manually
const envFile = readFileSync(resolve(__dirname, "../.env"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}
import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const db = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

async function main() {
  const { paymentMethods } = await db.query({ paymentMethods: {} });
  console.log(`Found ${paymentMethods.length} payment methods`);

  const txns = paymentMethods
    .filter((pm) => !pm.type)
    .map((pm) => {
      const name = pm.name.toLowerCase();
      let type = "efectivo";
      if (name.includes("zelle")) type = "zelle";
      else if (name.includes("pago") || name.includes("movil") || name.includes("móvil"))
        type = "pago_movil";

      console.log(`  ${pm.name} -> ${type}`);
      return db.tx.paymentMethods[pm.id].update({ type });
    });

  if (txns.length === 0) {
    console.log("All payment methods already have a type. Nothing to do.");
    return;
  }

  await db.transact(txns);
  console.log(`Updated ${txns.length} payment methods.`);
}

main().catch(console.error);
