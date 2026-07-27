import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidEmail, isValidUUID } from "@/lib/validation";
import { sendConfirmationEmailForOrder } from "@/lib/confirmationEmailSender";

// Public, email-verified resend of the ORDER CONFIRMATION email (the one with
// the link to /ticket/[orderId] where a buyer can check status / upload payment
// proof). Complements /api/resend-ticket, which only serves approved orders —
// this one covers PENDING orders (where there is no ticket yet). Mirrors
// resend-ticket's auth model: no login, just email-match + rate limit.

// In-memory rate limit: 2 resends per orderId per 5 minutes
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 2;
const RATE_WINDOW_MS = 5 * 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, email } = body;

    if (!isValidUUID(orderId) || !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!checkRateLimit(orderId as string)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Verify the email matches the order (adminDb bypasses perms).
    const { orders } = await adminDb.query({
      orders: { $: { where: { id: orderId as string } } },
    });
    const order = orders[0];
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.email.toLowerCase() !== (email as string).toLowerCase().trim()) {
      return NextResponse.json({ error: "Email does not match" }, { status: 403 });
    }
    // Confirmation email is meaningful for pending/approved orders, not for
    // cancelled/rejected ones.
    if (order.status !== "pending" && order.status !== "approved") {
      return NextResponse.json(
        { error: "This order can't receive a confirmation email" },
        { status: 400 },
      );
    }

    const result = await sendConfirmationEmailForOrder(orderId as string);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[resend-confirmation] error:", err);
    return NextResponse.json(
      { error: "Failed to resend confirmation" },
      { status: 500 },
    );
  }
}
