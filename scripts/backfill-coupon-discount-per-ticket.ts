/**
 * One-time backfill: convert order discountAmount / paymentMethodDiscount from
 * "total del carrito" (inflado ×qty) a valor POR ENTRADA.
 *
 * Bug original: al comprar 2+ entradas, el descuento del cupón se calculaba bien
 * a nivel de carrito, pero se guardaba el TOTAL en cada fila de orden (matickets
 * crea una fila por entrada). totalSnapshot quedaba correcto (usa el per-ticket),
 * pero el campo discountAmount/paymentMethodDiscount quedaba inflado, mostrándose
 * mal en admin, tickets y correos.
 *
 * Estrategia (idempotente):
 *  - Agrupa órdenes por purchaseGroupId (fallback: couponCode+email+cedula+createdAt).
 *  - Usa totalSnapshot (confiable) como fuente de verdad del descuento real por
 *    entrada: expectedPerTicket = (price+fees snapshots) - totalSnapshot.
 *  - Solo corrige filas donde el descuento guardado ≈ N × expectedPerTicket
 *    (claramente inflado). Si ya es per-ticket, lo salta. Si no cuadra ni con
 *    1× ni con N×, lo deja y avisa (no adivina).
 *
 * Correr dry-run primero:
 *   npx tsx --env-file=.env scripts/backfill-coupon-discount-per-ticket.ts --dry-run
 * Luego en serio:
 *   npx tsx --env-file=.env scripts/backfill-coupon-discount-per-ticket.ts
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
const TOL = 0.02; // tolerancia en USD para comparar floats
// Ventana para agrupar órdenes sin purchaseGroupId (mismo "carrito").
const CREATEDAT_WINDOW_MS = 5_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

type RawOrder = {
  id: string;
  status: string;
  email?: string;
  cedula?: string;
  createdAt?: number;
  couponCode?: string;
  purchaseGroupId?: string;
  discountAmount?: number;
  paymentMethodDiscount?: number;
  priceSnapshot?: number;
  feeAmountSnapshot?: number;
  paymentMethodFeeAmountSnapshot?: number;
  totalSnapshot?: number;
  orderNumber?: string;
};

type RawTicketType = { id: string; name: string; orders: RawOrder[] };
type RawConcert = { id: string; name: string; ticketTypes: RawTicketType[] };

// Clave de agrupación: purchaseGroupId si existe; si no, heurística de "mismo carrito".
function groupKey(ttId: string, o: RawOrder): string {
  if (o.purchaseGroupId) return `pg:${o.purchaseGroupId}`;
  const bucket = Math.floor((o.createdAt ?? 0) / CREATEDAT_WINDOW_MS);
  return `h:${ttId}|${o.couponCode ?? ""}|${o.email ?? ""}|${o.cedula ?? ""}|${bucket}`;
}

// Descuento real aplicado a ESTA fila, derivado del totalSnapshot (confiable).
function expectedPerTicketDiscount(o: RawOrder): number | null {
  if (typeof o.totalSnapshot !== "number") return null;
  const basePlusFee =
    (o.priceSnapshot ?? 0) +
    (o.feeAmountSnapshot ?? 0) +
    (o.paymentMethodFeeAmountSnapshot ?? 0);
  return round2(basePlusFee - o.totalSnapshot);
}

async function backfill() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  const { concerts } = (await adminDb.query({
    concerts: { ticketTypes: { orders: {} } },
  })) as { concerts: RawConcert[] };

  let txns: ReturnType<(typeof adminDb.tx.orders)[string]["update"]>[] = [];
  let fixed = 0;
  let alreadyOk = 0;
  let ambiguous = 0;

  async function flush() {
    if (txns.length === 0) return;
    if (!DRY_RUN) await adminDb.transact(txns);
    console.log(`  ${DRY_RUN ? "[dry-run] would write" : "wrote"} ${txns.length} updates`);
    txns = [];
  }

  for (const concert of concerts) {
    // Agrupa todas las órdenes del concierto por "carrito".
    const groups = new Map<string, RawOrder[]>();
    for (const tt of concert.ticketTypes) {
      for (const o of tt.orders) {
        const k = groupKey(tt.id, o);
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
      }
    }

    for (const group of groups.values()) {
      const N = group.length;
      if (N < 2) continue; // single ticket: discountAmount ya es per-ticket

      for (const o of group) {
        const hasDiscount =
          (o.discountAmount ?? 0) > 0 || (o.paymentMethodDiscount ?? 0) > 0;
        if (!hasDiscount) continue;

        const expected = expectedPerTicketDiscount(o);
        const storedTotal = (o.discountAmount ?? 0) + (o.paymentMethodDiscount ?? 0);

        if (expected === null) {
          ambiguous++;
          console.warn(
            `  ? ${o.orderNumber ?? o.id} (${concert.name}): sin totalSnapshot, no se puede validar — SKIP`,
          );
          continue;
        }

        if (Math.abs(storedTotal - expected) <= TOL) {
          alreadyOk++; // ya es per-ticket
          continue;
        }

        if (Math.abs(storedTotal - N * expected) <= TOL) {
          const update: { discountAmount?: number; paymentMethodDiscount?: number } = {};
          if ((o.discountAmount ?? 0) > 0)
            update.discountAmount = round2((o.discountAmount ?? 0) / N);
          if ((o.paymentMethodDiscount ?? 0) > 0)
            update.paymentMethodDiscount = round2((o.paymentMethodDiscount ?? 0) / N);

          console.log(
            `  ✓ ${o.orderNumber ?? o.id} (${concert.name}, ${o.couponCode ?? "—"}, grupo×${N}): ` +
              `discount ${o.discountAmount ?? 0} → ${update.discountAmount ?? o.discountAmount ?? 0}` +
              ((o.paymentMethodDiscount ?? 0) > 0
                ? `, pm ${o.paymentMethodDiscount} → ${update.paymentMethodDiscount}`
                : ""),
          );
          txns.push(adminDb.tx.orders[o.id].update(update));
          fixed++;
          if (txns.length >= CHUNK_SIZE) await flush();
        } else {
          ambiguous++;
          console.warn(
            `  ? ${o.orderNumber ?? o.id} (${concert.name}): stored=${storedTotal} no cuadra con ` +
              `1×(${expected}) ni ${N}×(${round2(N * expected)}) — SKIP`,
          );
        }
      }
    }
  }

  await flush();
  console.log(
    `\nDone. Corregidas ${fixed}, ya correctas ${alreadyOk}, ambiguas (skip) ${ambiguous}.`,
  );
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
