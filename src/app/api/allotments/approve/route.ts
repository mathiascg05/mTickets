import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { mintAllotmentOrders } from "@/lib/allotmentMint";
import { recordAuditLog } from "@/lib/auditLog";

type Body = {
  allotmentId: string;
  action: "approve" | "reject" | "cancel";
};

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

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

    const { allotmentId, action } = (await req.json()) as Body;
    if (!allotmentId || typeof allotmentId !== "string") {
      return NextResponse.json({ error: "allotmentId is required" }, { status: 400 });
    }
    if (!["approve", "reject", "cancel"].includes(action)) {
      return NextResponse.json(
        { error: "action must be approve, reject, or cancel" },
        { status: 400 },
      );
    }

    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: {
        $: { where: { id: allotmentId } },
        items: {},
        concert: { collaborators: {} },
      },
    });
    const allotment = ticketAllotments[0] as
      | {
          id: string;
          status: string;
          schoolName: string;
          feeAmountSnapshot?: number;
          items: { id: string }[];
          concert: unknown;
        }
      | undefined;
    if (!allotment) {
      return NextResponse.json({ error: "Allotment not found" }, { status: 404 });
    }

    const concert = firstOf<{
      id: string;
      organizerEmail: string;
      collaborators?: { email: string }[];
    }>(allotment.concert);
    if (!concert) {
      return NextResponse.json({ error: "Concert not found" }, { status: 404 });
    }
    if (!isAuthorizedForConcert(user.email, concert)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = Date.now();
    const items = allotment.items || [];

    if (action === "approve") {
      const result = await mintAllotmentOrders(allotmentId);
      if (!result.success) {
        const status =
          result.errorCode === "NO_BALANCE" ||
          result.errorCode === "INSUFFICIENT_BALANCE"
            ? 402
            : result.errorCode === "NOT_FOUND"
              ? 404
              : 400;
        return NextResponse.json(
          {
            error: result.errorCode,
            message: result.error,
            requiredFee: result.requiredFee,
            currentBalance: result.currentBalance,
          },
          { status },
        );
      }
      if (!result.alreadyGenerated) {
        await recordAuditLog({
          action: "allotment.approve",
          actorEmail: user.email,
          entityType: "allotment",
          entityId: allotmentId,
          concertId: concert.id,
          summary: `Aprobó lote de ${allotment.schoolName} (${result.minted} entradas)`,
          metadata: { minted: result.minted, platformFee: result.platformFee },
        });
      }
      return NextResponse.json({
        success: true,
        minted: result.minted,
        platformFee: result.platformFee,
        alreadyGenerated: result.alreadyGenerated,
      });
    }

    // reject: only before minting.
    if (action === "reject") {
      if (allotment.status !== "pending" && allotment.status !== "submitted") {
        return NextResponse.json(
          { error: "Only a pending/submitted allotment can be rejected" },
          { status: 400 },
        );
      }
      await adminDb.transact([
        adminDb.tx.ticketAllotments[allotmentId].update({
          status: "rejected",
          rejectedAt: now,
        }),
        ...items.map((it) =>
          adminDb.tx.ticketAllotmentItems[it.id].update({ status: "rejected" }),
        ),
      ]);
      await recordAuditLog({
        action: "allotment.reject",
        actorEmail: user.email,
        entityType: "allotment",
        entityId: allotmentId,
        concertId: concert.id,
        summary: `Rechazó lote de ${allotment.schoolName}`,
      });
      return NextResponse.json({ success: true });
    }

    // cancel: releases inventory; if already approved, delete minted orders and
    // reverse the platform fee.
    if (allotment.status === "cancelled") {
      return NextResponse.json({ success: true }); // idempotent
    }

    const txs: unknown[] = [];
    let feeReversed = 0;

    if (allotment.status === "approved") {
      const { orders } = await adminDb.query({
        orders: { $: { where: { allotmentId } }, ticketType: { concert: {} } },
      });
      for (const o of orders) {
        txs.push(adminDb.tx.orders[o.id].delete());
      }

      const fee = allotment.feeAmountSnapshot || 0;
      if (fee > 0) {
        const { organizerBalances } = await adminDb.query({
          organizerBalances: {
            $: { where: { email: concert.organizerEmail.toLowerCase() } },
          },
        });
        const balance = organizerBalances[0];
        if (balance) {
          const newBalance = Math.round((balance.balance + fee) * 100) / 100;
          const txnId = genId();
          txs.push(
            adminDb.tx.organizerBalances[balance.id].update({
              balance: newBalance,
              updatedAt: now,
            }),
            adminDb.tx.balanceTransactions[txnId]
              .update({
                type: "adjustment",
                amount: fee,
                balanceBefore: balance.balance,
                balanceAfter: newBalance,
                description: `Reversal of platform fee for cancelled allotment ${allotmentId}`,
                concertId: concert.id,
                createdAt: now,
              })
              .link({ organizerBalance: balance.id }),
          );
          feeReversed = fee;
        }
      }
    }

    txs.push(
      adminDb.tx.ticketAllotments[allotmentId].update({ status: "cancelled" }),
      ...items.map((it) =>
        adminDb.tx.ticketAllotmentItems[it.id].update({ status: "cancelled" }),
      ),
    );
    await adminDb.transact(txs as never);

    await recordAuditLog({
      action: "allotment.cancel",
      actorEmail: user.email,
      entityType: "allotment",
      entityId: allotmentId,
      concertId: concert.id,
      summary: `Canceló lote de ${allotment.schoolName}`,
      metadata: { feeReversed },
    });
    return NextResponse.json({ success: true, feeReversed });
  } catch (err) {
    console.error("[allotments:approve] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
