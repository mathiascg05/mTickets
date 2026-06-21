/**
 * One-time backfill: recompute orders.purchaseAmountBs para órdenes con cupón.
 *
 * Bug original: purchaseAmountBs se guarda como snapshot al crear la orden
 * (precio base × tasa). Cuando luego se aplica un cupón en el panel admin,
 * applyCouponToOrder() actualizaba couponCode/discountAmount/totalSnapshot pero
 * NO recalculaba purchaseAmountBs → el monto en Bs seguía mostrando el bruto
 * (ej. $50 × tasa) en vez del neto (ej. $40 × tasa).
 *
 * El fix en la UI ya mantiene purchaseAmountBs sincronizado a futuro. Este script
 * corrige las órdenes ya afectadas (incl. las aprobadas, que no exponen el toggle
 * de cupón en la UI).
 *
 * Base usada (igual que el fix de UI y el display de la lista de órdenes):
 *   netBase = max(0, (priceSnapshot ?? tt.price) - discountAmount - paymentMethodDiscount)
 *   purchaseAmountBs = round(netBase * purchaseRate)        (sin fee)
 *
 * Idempotente: re-correrlo da el mismo resultado. Solo toca órdenes con
 * couponCode no vacío y purchaseRate definido cuyo Bs guardado difiera del esperado.
 *
 * Dry-run primero:
 *   npx tsx --env-file=.env scripts/backfill-purchase-amount-bs.ts --dry-run
 * Luego en serio:
 *   npx tsx --env-file=.env scripts/backfill-purchase-amount-bs.ts
 */
import { init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK_SIZE = 200;
const TOL = 0.01; // tolerancia en Bs para comparar floats

const round2 = (n: number) => Math.round(n * 100) / 100;

type RawOrder = {
  id: string;
  couponCode?: string;
  discountAmount?: number;
  paymentMethodDiscount?: number;
  priceSnapshot?: number;
  purchaseRate?: number;
  purchaseAmountBs?: number;
  orderNumber?: string;
};

type RawTicketType = { id: string; name: string; price: number; orders: RawOrder[] };
type RawConcert = { id: string; name: string; ticketTypes: RawTicketType[] };

async function backfill() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  const { concerts } = (await adminDb.query({
    concerts: { ticketTypes: { orders: {} } },
  })) as { concerts: RawConcert[] };

  let txns: ReturnType<(typeof adminDb.tx.orders)[string]["update"]>[] = [];
  let fixed = 0;
  let alreadyOk = 0;
  let skipped = 0;

  async function flush() {
    if (txns.length === 0) return;
    if (!DRY_RUN) await adminDb.transact(txns);
    console.log(`  ${DRY_RUN ? "[dry-run] would write" : "wrote"} ${txns.length} updates`);
    txns = [];
  }

  for (const concert of concerts) {
    for (const tt of concert.ticketTypes) {
      for (const o of tt.orders) {
        const hasCoupon = !!(o.couponCode && o.couponCode.trim());
        if (!hasCoupon) continue;

        const rate = o.purchaseRate;
        if (rate == null) {
          // Sin tasa bloqueada (ej. cortesías): el Bs se deriva en pantalla. SKIP.
          skipped++;
          continue;
        }

        const base = o.priceSnapshot ?? tt.price;
        const netBase = Math.max(
          0,
          base - (o.discountAmount ?? 0) - (o.paymentMethodDiscount ?? 0),
        );
        const expected = round2(netBase * rate);
        const current = o.purchaseAmountBs;

        if (current != null && Math.abs(current - expected) <= TOL) {
          alreadyOk++;
          continue;
        }

        console.log(
          `  ✓ ${o.orderNumber ?? o.id} (${concert.name} / ${tt.name}, ${o.couponCode}): ` +
            `Bs ${current ?? "—"} → ${expected}`,
        );
        txns.push(adminDb.tx.orders[o.id].update({ purchaseAmountBs: expected }));
        fixed++;
        if (txns.length >= CHUNK_SIZE) await flush();
      }
    }
  }

  await flush();
  console.log(
    `\nDone. Corregidas ${fixed}, ya correctas ${alreadyOk}, sin tasa (skip) ${skipped}.`,
  );
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
