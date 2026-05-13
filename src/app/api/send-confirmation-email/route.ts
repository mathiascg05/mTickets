import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessOrder } from "@/lib/authHelpers";
import { isValidUUID } from "@/lib/validation";
import { transporter, generateMessageId } from "@/lib/mailer";
import { buildConfirmationEmailHtml, buildConfirmationEmailText } from "@/lib/emailTemplate";
import { assignOrderNumber } from "@/lib/orderNumber";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import { formatEventDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryOrderWithRetry(orderId: string, retries = 3, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: {
          concert: {},
          phases: {},
        },
      },
    });
    const order = orders[0];
    // Admin SDK returns has-one relations as arrays at runtime despite types
    const rawTT = order?.ticketType as unknown;
    const ticketType = Array.isArray(rawTT) ? rawTT[0] : rawTT;
    const rawConcert = ticketType?.concert as unknown;
    const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;
    if (order && ticketType && concert) {
      return { ...order, ticketType: { ...ticketType, concert, phases: ticketType.phases || [] } };
    }
    console.log(`[confirmation-email] Retry ${i + 1}/${retries}: order=${!!order}, ticketType=${!!ticketType}, concert=${!!concert}`);
    if (i < retries - 1) await wait(delayMs);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // Verify caller is authenticated admin
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

    console.log(`[confirmation-email] Processing order ${orderId}`);

    const order = await queryOrderWithRetry(orderId);
    if (!order) {
      console.error(`[confirmation-email] Order ${orderId} not found after retries`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (await isEmailSuppressed(order.email)) {
      console.log(`[confirmation-email] Skipping suppressed email: ${order.email}`);
      return NextResponse.json({ success: true });
    }

    const { ticketType } = order;
    const { concert } = ticketType;

    // Assign order number if not already set
    const orderNumber = await assignOrderNumber(adminDb, orderId, concert.id, concert.name);

    // Calculate display price (phase-aware, discount-aware)
    const phase = (ticketType.phases || []).find(
      (p: { id: string }) => p.id === order.phaseId,
    );
    const basePrice = phase ? phase.price : ticketType.price;
    const finalPrice = basePrice - (order.discountAmount || 0) - ((order as { paymentMethodDiscount?: number }).paymentMethodDiscount || 0);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const orderUrl = `${appUrl}/ticket/${orderId}`;

    const emailLang = resolveEmailLang(
      (order as { language?: string }).language,
      (concert as { defaultLanguage?: string }).defaultLanguage,
    );

    const emailParams = {
      firstName: order.firstName,
      lastName: order.lastName,
      eventName: concert.name,
      eventDate: formatEventDate(concert.date, emailLang),
      venue: concert.venue,
      ticketTypeName: ticketType.name,
      price: `$${finalPrice.toFixed(2)}`,
      orderUrl,
      orderNumber,
      lang: emailLang,
    };
    const html = await buildConfirmationEmailHtml(emailParams);
    const text = await buildConfirmationEmailText(emailParams);

    const tEmail = await getTranslations({ locale: emailLang, namespace: "emails.confirmation" });

    const emailFrom = (await import("@/lib/mailer")).EMAIL_FROM;
    const mailOptions = {
      from: `"maTickets" <${emailFrom}>`,
      replyTo: emailFrom,
      to: order.email,
      subject: tEmail("subject", { orderNumber, eventName: concert.name }),
      html,
      text,
      messageId: generateMessageId(),
      date: new Date(),
      envelope: { from: emailFrom, to: order.email },
      headers: buildMailHeaders(order.email),
    };

    // Send with one retry on SMTP failure
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[confirmation-email] Sent to ${order.email} for order ${orderId}`);
    } catch (smtpErr) {
      console.warn("[confirmation-email] SMTP send failed, retrying once:", smtpErr);
      await wait(1000);
      await transporter.sendMail({ ...mailOptions, messageId: generateMessageId() });
      console.log(`[confirmation-email] Sent on retry to ${order.email} for order ${orderId}`);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[confirmation-email] error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
