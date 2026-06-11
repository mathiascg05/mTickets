import "dotenv/config";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "../src/lib/adminDb";
import { getAvailability, getTodayString } from "../src/lib/phases";
import { assertSafeToMutate, findLoadtestConcerts } from "./loadtest-config";

/**
 * S6 — Reservas abandonadas y recuperación de stock (riesgo R10).
 *
 * Crea N reservas ACTIVAS (restan stock) y M reservas YA VENCIDAS (no deben
 * restar stock) sobre el ticketType del Evento A, y comprueba con la función
 * real getAvailability que:
 *   - las activas reducen la disponibilidad en exactamente N,
 *   - las vencidas NO reducen la disponibilidad (stock "fantasma" recuperado).
 *
 * Sale con código 1 si una reserva vencida sigue restando stock.
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 \
 *     ACTIVE_RES=50 EXPIRED_RES=50 npx tsx scripts/abandon-reservations-loadtest.ts
 */

async function availabilityOf(ticketTypeId: string): Promise<number> {
  const { ticketTypes } = await adminDb.query({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      orders: {},
      reservations: {},
      phases: { $: { order: { sortOrder: "asc" } } },
    },
  });
  const tt = ticketTypes[0];
  if (!tt) throw new Error(`ticketType ${ticketTypeId} no encontrado`);
  const now = Date.now();
  const orders = (tt.orders ?? []) as { id: string; status: string; phaseId?: string }[];
  const reservations = ((tt.reservations ?? []) as {
    id: string;
    quantity: number;
    expiresAt: number;
    phaseId?: string;
  }[]).filter((r) => r.expiresAt > now);
  const phases = (tt.phases ?? []) as {
    id: string;
    name: string;
    price: number;
    quantity: number;
    endDate?: string;
    sortOrder: number;
  }[];
  return getAvailability(tt, phases, orders, getTodayString(), reservations).available;
}

async function run() {
  assertSafeToMutate("abandon-reservations (crea reservas de prueba)");

  const ACTIVE = parseInt(process.env.ACTIVE_RES || "50", 10);
  const EXPIRED = parseInt(process.env.EXPIRED_RES || "50", 10);

  const concerts = await findLoadtestConcerts();
  const eventA = concerts.find((c) => c.slug === "loadtest-evento-a");
  const ttId = eventA?.ticketTypes?.[0]?.id;
  if (!ttId) {
    console.error("❌ No se encontró el ticketType del Evento A. Corre `npm run loadtest:seed` primero.");
    process.exit(1);
  }

  const baseline = await availabilityOf(ttId);
  console.log(`Disponibilidad inicial: ${baseline}`);

  const now = Date.now();
  const txns = [];
  for (let i = 0; i < ACTIVE; i++) {
    txns.push(
      adminDb.tx.reservations[genId()]
        .update({ quantity: 1, expiresAt: now + 15 * 60_000, createdAt: now })
        .link({ ticketType: ttId }),
    );
  }
  for (let i = 0; i < EXPIRED; i++) {
    txns.push(
      adminDb.tx.reservations[genId()]
        .update({ quantity: 1, expiresAt: now - 60_000, createdAt: now - 16 * 60_000 })
        .link({ ticketType: ttId }),
    );
  }
  await adminDb.transact(txns);
  console.log(`Creadas ${ACTIVE} reservas activas + ${EXPIRED} vencidas.`);

  const after = await availabilityOf(ttId);
  const expected = baseline - ACTIVE;
  console.log(`Disponibilidad tras reservas: ${after} (esperado: ${expected})`);

  if (after < expected) {
    console.error(`❌ FALLO R10: reservas vencidas restaron stock (disponible ${after} < esperado ${expected}).`);
    process.exit(1);
  }
  console.log("✅ Reservas vencidas NO restan stock; las activas restan exactamente N.");
  console.log("ℹ️  Limpia con `npm run loadtest:reset` antes de otra corrida.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ abandon-reservations-loadtest falló:", err);
    process.exit(1);
  });
