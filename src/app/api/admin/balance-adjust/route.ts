import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";
import { recordAuditLog } from "@/lib/auditLog";

type DepositBody = {
  action: "deposit";
  email: string;
  amount: number;
  concertId?: string;
  note?: string;
};

type VoidBody = {
  action: "void";
  txnId: string;
};

type Body = DepositBody | VoidBody;

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Deposits and adjustments are a super-admin-only capability.
    if (!isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body: Body = await req.json();

    if (body.action === "deposit") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }
      const email = String(body.email || "").toLowerCase().trim();
      if (!email) {
        return NextResponse.json({ error: "email required" }, { status: 400 });
      }
      const concertId =
        typeof body.concertId === "string" && body.concertId
          ? body.concertId
          : undefined;
      const note =
        typeof body.note === "string" ? body.note.slice(0, 500) : undefined;

      let concertName: string | null = null;
      if (concertId) {
        const { concerts } = await adminDb.query({
          concerts: { $: { where: { id: concertId } } },
        });
        concertName = concerts[0]?.name ?? null;
      }

      const { organizerBalances } = await adminDb.query({
        organizerBalances: { $: { where: { email } } },
      });
      const existing = organizerBalances[0];
      const balanceBefore = existing?.balance ?? 0;
      const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;
      const txnId = genId();
      const description = note
        ? note
        : concertName
          ? `Deposit — ${concertName}`
          : "Manual deposit";

      const txnData = {
        type: "deposit" as const,
        amount,
        balanceBefore: existing ? balanceBefore : 0,
        balanceAfter,
        description,
        ...(concertId ? { concertId } : {}),
        createdAt: Date.now(),
      };

      if (existing) {
        await adminDb.transact([
          adminDb.tx.organizerBalances[existing.id].update({
            balance: balanceAfter,
            updatedAt: Date.now(),
          }),
          adminDb.tx.balanceTransactions[txnId]
            .update(txnData)
            .link({ organizerBalance: existing.id }),
        ]);
      } else {
        const balanceId = genId();
        await adminDb.transact([
          adminDb.tx.organizerBalances[balanceId].update({
            email,
            balance: balanceAfter,
            currency: "USD",
            updatedAt: Date.now(),
          }),
          adminDb.tx.balanceTransactions[txnId]
            .update(txnData)
            .link({ organizerBalance: balanceId }),
        ]);
      }

      await recordAuditLog({
        action: "balance.deposit",
        actorEmail: user.email,
        entityType: "balance",
        entityId: txnId,
        concertId,
        summary: `Depositó $${amount.toFixed(2)} a ${email}`,
        metadata: { email, amount, balanceBefore, balanceAfter, description },
      });

      return NextResponse.json({ success: true, balanceAfter });
    }

    if (body.action === "void") {
      const txnId = body.txnId;
      if (!txnId || typeof txnId !== "string") {
        return NextResponse.json({ error: "txnId required" }, { status: 400 });
      }

      const { balanceTransactions } = await adminDb.query({
        balanceTransactions: {
          $: { where: { id: txnId } },
          organizerBalance: {},
        },
      });
      const txn = balanceTransactions[0] as
        | {
            id: string;
            amount: number;
            type: string;
            description: string;
            organizerBalance: unknown;
          }
        | undefined;
      if (!txn) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      }
      if (txn.type === "adjustment") {
        return NextResponse.json(
          { error: "Cannot void an adjustment" },
          { status: 400 },
        );
      }
      const rawBal = txn.organizerBalance as unknown;
      const balanceRecord = (Array.isArray(rawBal) ? rawBal[0] : rawBal) as
        | { id: string; balance: number; email: string }
        | undefined;
      if (!balanceRecord) {
        return NextResponse.json(
          { error: "Balance record not found" },
          { status: 404 },
        );
      }

      const reverseAmount = -txn.amount;
      const currentBalance = balanceRecord.balance;
      const newBalance =
        Math.round((currentBalance + reverseAmount) * 100) / 100;
      const voidTxnId = genId();

      await adminDb.transact([
        adminDb.tx.organizerBalances[balanceRecord.id].update({
          balance: newBalance,
          updatedAt: Date.now(),
        }),
        adminDb.tx.balanceTransactions[voidTxnId]
          .update({
            type: "adjustment",
            amount: reverseAmount,
            balanceBefore: currentBalance,
            balanceAfter: newBalance,
            description: `Anulación: ${txn.description}`,
            createdAt: Date.now(),
          })
          .link({ organizerBalance: balanceRecord.id }),
      ]);

      await recordAuditLog({
        action: "balance.void",
        actorEmail: user.email,
        entityType: "balance",
        entityId: voidTxnId,
        summary: `Anuló transacción de ${balanceRecord.email}: ${txn.description}`,
        metadata: {
          email: balanceRecord.email,
          voidedTxnId: txnId,
          reverseAmount,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
        },
      });

      return NextResponse.json({ success: true, balanceAfter: newBalance });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[admin/balance-adjust] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
