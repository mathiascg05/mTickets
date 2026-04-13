import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { approveOrderInternal } from "@/lib/approveOrder";
import { sendTicketEmailForOrder } from "@/lib/ticketEmailSender";

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

    const { concertId, orderIds } = (await req.json()) as {
      concertId: string;
      orderIds: string[];
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

    // Verify authorization
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
      },
    });

    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json(
        { error: "Concert not found" },
        { status: 404 },
      );
    }

    if (!isAuthorizedForConcert(user.email, concert.organizerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Approve all orders WITHOUT sending emails (fast)
    const results: {
      orderId: string;
      success: boolean;
      error?: string;
      platformFee?: number;
    }[] = [];

    for (const orderId of orderIds) {
      try {
        const result = await approveOrderInternal(orderId, { skipEmail: true });
        results.push({
          orderId,
          success: result.success,
          error: result.error,
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
