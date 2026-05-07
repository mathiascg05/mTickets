/**
 * One-time backfill for platform-fee snapshots on each order.
 *
 * For approved orders we copy the actual charged amount from the
 * balanceTransactions ledger (most accurate). For pending/rejected/cancelled
 * orders without a "fee" transaction, we compute from the current
 * platformFeeConfig and the order's priceSnapshot (or current ticketType/phase
 * price as a final fallback).
 *
 * Caveat: if platformFeeConfig.feePercent or feeFixed changed between the
 * order's creation and its approval, the percent/fixed snapshot fields we
 * write here reflect *today's* config — not what was used at charge time.
 * The amount snapshot, however, is taken straight from the ledger so the
 * deduction history stays accurate.
 *
 *   npx tsx --env-file=.env scripts/backfill-platform-fee-snapshots.ts --dry-run
 *   npx tsx --env-file=.env scripts/backfill-platform-fee-snapshots.ts
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
  priceSnapshot?: number;
  platformFeeAmountSnapshot?: number;
};

type RawPhase = { id: string; price: number };

type RawTicketType = {
  id: string;
  price: number;
  phases?: RawPhase[];
  orders: RawOrder[];
};

type RawPlatformFeeConfig = {
  feePercent: number;
  feeFixed: number;
};

type RawConcert = {
  id: string;
  name: string;
  ticketTypes: RawTicketType[];
  platformFeeConfig?: RawPlatformFeeConfig | RawPlatformFeeConfig[];
};

type RawFeeTxn = {
  orderId?: string;
  amount: number;
  type: string;
};

function pickConfig(
  cfg: RawPlatformFeeConfig | RawPlatformFeeConfig[] | undefined,
): RawPlatformFeeConfig | null {
  if (!cfg) return null;
  if (Array.isArray(cfg)) return cfg[0] ?? null;
  return cfg;
}

async function backfill() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  console.log("Querying all 'fee' balance transactions...");
  const { balanceTransactions } = (await adminDb.query({
    balanceTransactions: {
      $: { where: { type: "fee" } },
    },
  })) as { balanceTransactions: RawFeeTxn[] };

  const feeByOrderId = new Map<string, number>();
  for (const txn of balanceTransactions) {
    if (!txn.orderId) continue;
    feeByOrderId.set(txn.orderId, Math.abs(txn.amount));
  }
  console.log(`Found ${feeByOrderId.size} fee transactions`);

  console.log(
    "Querying concerts with ticketTypes, phases, orders, platformFeeConfig...",
  );
  const { concerts } = (await adminDb.query({
    concerts: {
      ticketTypes: {
        orders: {},
        phases: {},
      },
      platformFeeConfig: {},
    },
  })) as { concerts: RawConcert[] };

  console.log(`Found ${concerts.length} concerts\n`);

  let txns: ReturnType<typeof adminDb.tx.orders[string]["update"]>[] = [];
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFromLedger = 0;
  let totalComputed = 0;

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
    const cfg = pickConfig(concert.platformFeeConfig);
    const cfgPercent = cfg?.feePercent ?? 0;
    const cfgFixed = cfg?.feeFixed ?? 0;

    let perEventFromLedger = 0;
    let perEventComputed = 0;
    let perEventTotal = 0;

    for (const tt of concert.ticketTypes) {
      for (const order of tt.orders) {
        if (typeof order.platformFeeAmountSnapshot === "number") {
          totalSkipped++;
          continue;
        }

        const phase = (tt.phases || []).find((p) => p.id === order.phaseId);
        const basePrice = order.priceSnapshot ?? (phase ? phase.price : tt.price);

        const ledgerAmount = feeByOrderId.get(order.id);
        let platformFeeAmount: number;
        if (ledgerAmount !== undefined) {
          platformFeeAmount = ledgerAmount;
          totalFromLedger++;
          perEventFromLedger += platformFeeAmount;
        } else {
          platformFeeAmount =
            Math.round(((basePrice * cfgPercent) / 100 + cfgFixed) * 100) / 100;
          totalComputed++;
          perEventComputed += platformFeeAmount;
        }

        txns.push(
          adminDb.tx.orders[order.id].update({
            platformFeePercentSnapshot: cfgPercent,
            platformFeeFixedSnapshot: cfgFixed,
            platformFeeAmountSnapshot: platformFeeAmount,
          }),
        );
        totalUpdated++;
        perEventTotal += platformFeeAmount;

        if (txns.length >= CHUNK_SIZE) {
          await flush();
        }
      }
    }

    if (perEventTotal > 0 || cfg) {
      console.log(
        `${concert.name.padEnd(40)} cfg=${cfgPercent}%+$${cfgFixed.toFixed(2)}  ` +
          `ledger=$${perEventFromLedger.toFixed(2)}  ` +
          `computed=$${perEventComputed.toFixed(2)}  ` +
          `total=$${perEventTotal.toFixed(2)}`,
      );
    }
  }

  await flush();

  console.log(
    `\nDone. Updated ${totalUpdated} orders ` +
      `(${totalFromLedger} from ledger, ${totalComputed} computed). ` +
      `Skipped ${totalSkipped} already-snapshotted.`,
  );
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
