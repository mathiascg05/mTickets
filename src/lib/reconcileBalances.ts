import { adminDb } from "@/lib/adminDb";
import { recordAuditLog } from "@/lib/auditLog";

export type BalanceCorrection = {
  email: string;
  before: number;
  after: number;
  drift: number;
};

/**
 * Reconcile each organizer's stored balance with its transaction ledger.
 *
 * The `balanceTransactions` ledger is append-only and is the source of truth:
 * the stored `organizerBalances.balance` should always equal the sum of its
 * transaction amounts. Concurrent order approvals (read-modify-write without
 * isolation in approveOrder/cancelOrder/balance-adjust) can drop an update and
 * leave the stored balance drifting from the ledger.
 *
 * This recomputes `balance = round(sum(transactions.amount), 2)` for every
 * organizer whose stored balance differs, and leaves an audit trail. It does
 * NOT create a balanceTransaction (that would change the very sum it corrects
 * to); the correction is recorded only in auditLogs. Idempotent: a second run
 * finds nothing to fix.
 */
export async function reconcileAllBalances(
  actorEmail: string,
): Promise<BalanceCorrection[]> {
  const { organizerBalances } = await adminDb.query({
    organizerBalances: { transactions: {} },
  });

  const corrections: BalanceCorrection[] = [];

  for (const bal of organizerBalances) {
    const ledger =
      Math.round(
        (bal.transactions || []).reduce((sum, t) => sum + t.amount, 0) * 100,
      ) / 100;
    const drift = Math.round((ledger - bal.balance) * 100) / 100;
    if (Math.abs(drift) <= 0.005) continue;

    await adminDb.transact([
      adminDb.tx.organizerBalances[bal.id].update({
        balance: ledger,
        updatedAt: Date.now(),
      }),
    ]);

    await recordAuditLog({
      action: "balance.reconcile",
      actorEmail,
      entityType: "balance",
      entityId: bal.id,
      summary: `Reconcilió balance de ${bal.email}: ${bal.balance.toFixed(
        2,
      )} → ${ledger.toFixed(2)} (desfase ${drift.toFixed(2)})`,
      metadata: {
        email: bal.email,
        before: bal.balance,
        after: ledger,
        drift,
      },
    });

    corrections.push({
      email: bal.email,
      before: bal.balance,
      after: ledger,
      drift,
    });
  }

  return corrections;
}
