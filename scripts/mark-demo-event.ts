/**
 * Mark a concert as a demo event and reverse any platform-fee transactions
 * already charged for it.
 *
 * Usage: npx tsx scripts/mark-demo-event.ts <slug>
 */
import { adminDb } from "../src/lib/adminDb";
import { id as genId } from "@instantdb/admin";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/mark-demo-event.ts <slug>");
    process.exit(1);
  }

  const { concerts } = await adminDb.query({
    concerts: { $: { where: { slug } } },
  });
  const concert = concerts[0] as
    | { id: string; name: string; organizerEmail: string; isDemo?: boolean }
    | undefined;

  if (!concert) {
    console.error(`Concert with slug "${slug}" not found.`);
    process.exit(1);
  }

  console.log(`Found concert: ${concert.name} (${concert.id})`);
  console.log(`Organizer: ${concert.organizerEmail}`);
  console.log(`Already demo? ${concert.isDemo ? "yes" : "no"}`);

  const { balanceTransactions } = await adminDb.query({
    balanceTransactions: {
      $: { where: { concertId: concert.id, type: "fee" } },
    },
  });

  console.log(`Fee transactions for this concert: ${balanceTransactions.length}`);

  const orgEmail = concert.organizerEmail.toLowerCase();
  const { organizerBalances } = await adminDb.query({
    organizerBalances: { $: { where: { email: orgEmail } } },
  });
  const balance = organizerBalances[0] as
    | { id: string; balance: number }
    | undefined;

  // Mixed entity types — use unknown[] to keep the array generic.
  const txs: unknown[] = [];

  txs.push(adminDb.tx.concerts[concert.id].update({ isDemo: true }));

  let totalRefund = 0;
  for (const txn of balanceTransactions) {
    totalRefund += Math.abs(txn.amount);
    txs.push(adminDb.tx.balanceTransactions[txn.id].delete());
  }

  if (totalRefund > 0 && balance) {
    const newBalance = Math.round((balance.balance + totalRefund) * 100) / 100;
    console.log(
      `Refunding $${totalRefund.toFixed(2)} → balance ${balance.balance} → ${newBalance}`,
    );
    txs.push(
      adminDb.tx.organizerBalances[balance.id].update({
        balance: newBalance,
        updatedAt: Date.now(),
      }),
    );
    const auditId = genId();
    txs.push(
      adminDb.tx.balanceTransactions[auditId]
        .update({
          type: "adjustment",
          amount: totalRefund,
          balanceBefore: balance.balance,
          balanceAfter: newBalance,
          description: `Demo conversion: refunded fees for "${concert.name}"`,
          concertId: concert.id,
          createdAt: Date.now(),
        })
        .link({ organizerBalance: balance.id }),
    );
  } else if (totalRefund > 0) {
    console.warn(
      `Fees worth $${totalRefund.toFixed(2)} found but no balance record exists for ${orgEmail}; just removing the fee txns.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await adminDb.transact(txs as any);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
