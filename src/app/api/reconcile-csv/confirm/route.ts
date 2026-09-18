import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { approveOrderInternal } from "@/lib/approveOrder";
import { sendTicketEmailForOrder } from "@/lib/ticketEmailSender";
import { recordAuditLog } from "@/lib/auditLog";

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken).catch(() => null);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { concertId, orderIds, source } = (await req.json()) as {
      concertId: string;
      orderIds: string[];
      source?: "csv" | "ai";
    };

    if (
      !concertId ||
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      return NextResponse.json(
        { error: "concertId and orderIds are required" },
        { status: 400 },
      );
    }

    if (orderIds.length > 500) {
      return NextResponse.json(
        { error: "Too many orders (max 500)" },
        { status: 400 },
      );
    }

    // Verify authorization (organizer or collaborator)
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        collaborators: {},
      },
    });

    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }

    if (
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert.organizerEmail,
        collaborators: concert.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const results: {
      orderId: string;
      success: boolean;
      error?: string;
      errorCode?: string;
      platformFee?: number;
    }[] = [];

    // Solo ordenes de ESTE concierto: el acceso se valida contra concertId, asi
    // que una orden ajena colada en orderIds no puede aprobarse por esta via.
    const { orders: requested } = await adminDb.query({
      orders: {
        $: { where: { id: { $in: orderIds } } },
        ticketType: { concert: {} },
      },
    });
    const inConcert = new Set(
      requested
        .filter((o) => {
          const rawTT = o.ticketType as unknown;
          const tt = (Array.isArray(rawTT) ? rawTT[0] : rawTT) as
            | { concert?: unknown }
            | undefined;
          const rawConcert = tt?.concert as unknown;
          const c = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
            | { id: string }
            | undefined;
          return c?.id === concertId;
        })
        .map((o) => o.id),
    );

    // Approve all orders WITHOUT sending emails (fast)
    for (const orderId of orderIds) {
      if (!inConcert.has(orderId)) {
        results.push({ orderId, success: false, error: "NOT_IN_CONCERT", errorCode: "NOT_IN_CONCERT" });
        continue;
      }
      try {
        const result = await approveOrderInternal(orderId, { skipEmail: true });
        results.push({
          orderId,
          success: result.success,
          error: result.error,
          errorCode: result.errorCode,
          platformFee: result.platformFee,
        });
      } catch (err) {
        console.error(
          `[reconcile-csv/confirm] Error approving ${orderId}:`,
          err,
        );
        results.push({
          orderId,
          success: false,
          error: "Unexpected error",
        });
      }
    }

    const approved = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const approvedIds = results.filter((r) => r.success).map((r) => r.orderId);

    // Send ticket emails in background (won't block the response)
    after(async () => {
      for (const orderId of approvedIds) {
        try {
          await sendTicketEmailForOrder(orderId);
        } catch (err) {
          console.error(
            `[reconcile-csv/confirm] Email failed for ${orderId}:`,
            err,
          );
        }
      }
    });

    if (approved > 0) {
      await recordAuditLog({
        action: "reconcile.confirm",
        actorEmail: user.email,
        entityType: "order",
        entityId: approvedIds[0] ?? concertId,
        concertId,
        summary: `Aprobó ${approved} orden(es) por reconciliación ${
          source === "ai" ? "con archivo del banco (IA)" : "CSV"
        }${
          failed > 0 ? ` (${failed} fallidas)` : ""
        }`,
        metadata: { approved, failed, approvedIds, source: source === "ai" ? "ai" : "csv" },
      });
    }

    return NextResponse.json({
      approved,
      failed,
      results,
    });
  } catch (err) {
    console.error("[reconcile-csv/confirm] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
