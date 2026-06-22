/**
 * Reconcile every organizer's stored balance with its transaction ledger.
 *
 * The balanceTransactions ledger is append-only and authoritative: the stored
 * organizerBalances.balance must equal the sum of its transaction amounts.
 * Concurrent order approvals (read-modify-write without isolation) can drop an
 * update and leave the stored balance drifting from the ledger. This recomputes
 * balance = round(sum(transactions.amount), 2) and records an audit log. It does
 * NOT add a balanceTransaction (that would change the sum it corrects to).
 * Idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/reconcile-balances.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/reconcile-balances.ts
 */
import { id as genId, init } from "@instantdb/admin";
import schema from "../src/instant.schema";

const adminDb = init({
  appId: process.env.NEXT_PUBLIC_INSTANT_APP_ID!,
  adminToken: process.env.INSTANT_APP_ADMIN_TOKEN!,
  schema,
});

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const { organizerBalances } = await adminDb.query({
    organizerBalances: { transactions: {} },
  });

  let corrected = 0;
  for (const bal of organizerBalances) {
    const ledger =
      Math.round(
        (bal.transactions || []).reduce((sum, t) => sum + t.amount, 0) * 100,
      ) / 100;
    const drift = Math.round((ledger - bal.balance) * 100) / 100;
    if (Math.abs(drift) <= 0.005) continue;

    corrected++;
    console.log(
      `${dryRun ? "[dry-run] " : ""}${bal.email}: ${bal.balance.toFixed(
        2,
      )} → ${ledger.toFixed(2)} (desfase ${drift.toFixed(2)})`,
    );
    if (dryRun) continue;

    await adminDb.transact([
      adminDb.tx.organizerBalances[bal.id].update({
        balance: ledger,
        updatedAt: Date.now(),
      }),
      adminDb.tx.auditLogs[genId()].update({
        action: "balance.reconcile",
        actorEmail: "system",
        entityType: "balance",
        entityId: bal.id,
        summary: `Reconcilió balance de ${bal.email}: ${bal.balance.toFixed(
          2,
        )} → ${ledger.toFixed(2)} (desfase ${drift.toFixed(2)})`,
        metadataJson: JSON.stringify({
          email: bal.email,
          before: bal.balance,
          after: ledger,
          drift,
        }),
        createdAt: Date.now(),
      }),
    ]);
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}${corrected} balance(s) ${
      dryRun ? "would be" : ""
    } corregido(s) de ${organizerBalances.length} total.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("reconcile-balances failed:", err);
    process.exit(1);
  });
