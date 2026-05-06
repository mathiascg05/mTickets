import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessOrder } from "@/lib/authHelpers";
import { isValidUUID } from "@/lib/validation";
import { sendTicketEmailForOrder } from "@/lib/ticketEmailSender";

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!isValidUUID(orderId)) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    const authz = await assertOrganizerCanAccessOrder(user.email, orderId);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    console.log(`[ticket-email] Processing order ${orderId}`);

    const result = await sendTicketEmailForOrder(orderId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[ticket-email] error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
