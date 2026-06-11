import "dotenv/config";
import { adminDb } from "../src/lib/adminDb";
import { assertSafeToMutate, findLoadtestConcerts } from "./loadtest-config";

/**
 * Limpia los datos de prueba entre corridas de load test.
 *
 *  - Modo por defecto (soft reset): borra orders / reservations / queueEntries
 *    de los conciertos de prueba y restaura lastOrderSeq=0 y lastQueuePosition=0.
 *    Mantiene los conciertos/ticketTypes → los TICKET_TYPE_ID siguen válidos.
 *
 *  - Con `--purge`: borra los conciertos de prueba por completo (cascada elimina
 *    ticketTypes, métodos de pago, cupones, fee configs y todos sus hijos).
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 npx tsx scripts/reset-loadtest.ts
 *   DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 npx tsx scripts/reset-loadtest.ts --purge
 */
async function reset() {
  const purge = process.argv.includes("--purge");
  assertSafeToMutate(purge ? "reset-loadtest --purge (BORRA conciertos)" : "reset-loadtest (limpia datos)");

  const concerts = await findLoadtestConcerts();
  if (concerts.length === 0) {
    console.log("ℹ️  No hay conciertos de prueba. Nada que hacer.");
    return;
  }

  const txns = [];
  let orders = 0;
  let reservations = 0;
  let queueEntries = 0;

  if (purge) {
    for (const c of concerts) txns.push(adminDb.tx.concerts[c.id].delete());
    await adminDb.transact(txns);
    console.log(`🗑️  Purgados ${concerts.length} conciertos de prueba (cascada).`);
    return;
  }

  for (const c of concerts) {
    txns.push(adminDb.tx.concerts[c.id].update({ lastOrderSeq: 0 }));
    for (const tt of c.ticketTypes ?? []) {
      txns.push(adminDb.tx.ticketTypes[tt.id].update({ lastQueuePosition: 0 }));
      for (const o of tt.orders ?? []) {
        txns.push(adminDb.tx.orders[o.id].delete());
        orders++;
      }
      for (const r of tt.reservations ?? []) {
        txns.push(adminDb.tx.reservations[r.id].delete());
        reservations++;
      }
      for (const q of tt.queueEntries ?? []) {
        txns.push(adminDb.tx.queueEntries[q.id].delete());
        queueEntries++;
      }
    }
  }

  await adminDb.transact(txns);
  console.log(
    `♻️  Soft reset OK · ${concerts.length} conciertos · ${orders} orders · ${reservations} reservas · ${queueEntries} queueEntries borradas · contadores en 0.`,
  );
}

reset()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ reset-loadtest falló:", err);
    process.exit(1);
  });
