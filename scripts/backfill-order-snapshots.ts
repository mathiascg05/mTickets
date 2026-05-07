/**
 * One-time backfill for per-order pricing snapshots.
 *
 * Reads each order's current ticketType + phase, computes priceSnapshot,
 * feePercentSnapshot, feeFixedSnapshot, feeAmountSnapshot, totalSnapshot,
 * and writes them back.
 *
 * Limitation: snapshots reflect *today's* fee/price config. Past organizer
 * edits are not recoverable.
 *
 * Run dry first:
 *   npx tsx --env-file=.env scripts/backfill-order-snapshots.ts --dry-run
 * Then for real:
 *   npx tsx --env-file=.env scripts/backfill-order-snapshots.ts
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

type RawOrder = {
  id: string;
  status: string;
  phaseId?: string;
  discountAmount?: number;
  paymentMethodDiscount?: number;
  totalSnapshot?: number;
};

type RawPhase = { id: string; price: number };

type RawTicketType = {
  id: string;
  name: string;
  price: number;
  feePercent?: number;
  feeFixed?: number;
  phases?: RawPhase[];
  orders: RawOrder[];
};

type RawConcert = {
  id: string;
  name: string;
  ticketTypes: RawTicketType[];
};

function computeSnapshots(order: RawOrder, tt: RawTicketType) {
  const phase = (tt.phases || []).find((p) => p.id === order.phaseId);
  const base = phase ? phase.price : tt.price;
  const fp = tt.feePercent ?? 0;
  const ff = tt.feeFixed ?? 0;
  const feeAmount = (base * fp) / 100 + ff;
  const total = Math.max(
    0,
    base + feeAmount - (order.discountAmount ?? 0) - (order.paymentMethodDiscount ?? 0),
  );
  return {
    priceSnapshot: base,
    feePercentSnapshot: fp,
    feeFixedSnapshot: ff,
    feeAmountSnapshot: feeAmount,
    totalSnapshot: total,
  };
}

async function backfill() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("Querying all concerts with ticketTypes, phases, and orders...");

  const { concerts } = (await adminDb.query({
    concerts: {
      ticketTypes: {
        orders: {},
        phases: {},
      },
    },
  })) as { concerts: RawConcert[] };

  console.log(`Found ${concerts.length} concerts\n`);

  let txns: ReturnType<typeof adminDb.tx.orders[string]["update"]>[] = [];
  let totalUpdated = 0;
  let totalSkipped = 0;

  async function flush() {
    if (txns.length === 0) return;
    if (!DRY_RUN) {
      await adminDb.transact(txns);
    }
    console.log(
      `  ${DRY_RUN ? "[dry-run] would write" : "wrote"} ${txns.length} updates`,
    );
    txns = [];
  }

  for (const concert of concerts) {
    let perEventBefore = 0;
    let perEventAfter = 0;
    let perEventOrders = 0;

    for (const tt of concert.ticketTypes) {
      for (const order of tt.orders) {
        if (order.status !== "approved") {
          // We still backfill rejected/pending so future status flips have data,
          // but only count approved in the totals diff.
        }
        const before = order.totalSnapshot ?? 0;
        const snap = computeSnapshots(order, tt);

        if (order.totalSnapshot !== undefined) {
          totalSkipped++;
          continue;
        }

        if (order.status === "approved") {
          perEventBefore += before;
          perEventAfter += snap.totalSnapshot;
          perEventOrders++;
        }

        txns.push(adminDb.tx.orders[order.id].update(snap));
        totalUpdated++;

        if (txns.length >= CHUNK_SIZE) {
          await flush();
        }
      }
    }

    if (perEventOrders > 0) {
      console.log(
        `${concert.name.padEnd(40)} approved=${perEventOrders.toString().padStart(4)}  ` +
          `before=$${perEventBefore.toFixed(2).padStart(10)}  ` +
          `after=$${perEventAfter.toFixed(2).padStart(10)}  ` +
          `Δ=${(perEventAfter - perEventBefore >= 0 ? "+" : "")}${(perEventAfter - perEventBefore).toFixed(2)}`,
      );
    }
  }

  await flush();

  console.log(`\nDone. Updated ${totalUpdated} orders, skipped ${totalSkipped} already-snapshotted.`);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
