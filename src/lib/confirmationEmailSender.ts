import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildConfirmationEmailHtml,
  buildConfirmationEmailText,
} from "@/lib/emailTemplate";
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
      return {
        ...order,
        ticketType: { ...ticketType, concert, phases: ticketType.phases || [] },
      };
    }
    console.log(
      `[confirmation-email] Retry ${i + 1}/${retries}: order=${!!order}, ticketType=${!!ticketType}, concert=${!!concert}`,
    );
    if (i < retries - 1) await wait(delayMs);
  }
  return null;
}

/**
 * Sends the order confirmation email (the one with the link to /ticket/[orderId]
 * where a buyer can see status and upload payment proof). Works for any order
 * regardless of status — used both by the organizer resend (admin route) and by
 * the public email-verified resend on "Find My Tickets".
 */
export async function sendConfirmationEmailForOrder(
  orderId: string,
): Promise<{ success: true } | { error: string }> {
  const order = await queryOrderWithRetry(orderId);
  if (!order) {
    console.error(
      `[confirmation-email] Order ${orderId} not found after retries`,
    );
    return { error: "Order not found" };
  }

  if (await isEmailSuppressed(order.email)) {
    console.log(`[confirmation-email] Skipping suppressed email: ${order.email}`);
    return { success: true };
  }

  const { ticketType } = order;
  const { concert } = ticketType;

  const orderNumber = await assignOrderNumber(
    adminDb,
    orderId,
    concert.id,
    concert.name,
  );

  const phase = (ticketType.phases || []).find(
    (p: { id: string }) => p.id === order.phaseId,
  );
  const basePrice = phase ? phase.price : ticketType.price;
  const finalPrice =
    basePrice -
    (order.discountAmount || 0) -
    ((order as { paymentMethodDiscount?: number }).paymentMethodDiscount || 0);

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

  const tEmail = await getTranslations({
    locale: emailLang,
    namespace: "emails.confirmation",
  });

  const mailOptions = {
    from: `"maTickets" <${EMAIL_FROM}>`,
    replyTo: EMAIL_FROM,
    to: order.email,
    subject: tEmail("subject", { orderNumber, eventName: concert.name }),
    html,
    text,
    messageId: generateMessageId(),
    date: new Date(),
    envelope: { from: EMAIL_FROM!, to: order.email },
    headers: buildMailHeaders(order.email),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(
      `[confirmation-email] Sent to ${order.email} for order ${orderId}`,
    );
  } catch (smtpErr) {
    console.warn("[confirmation-email] SMTP send failed, retrying once:", smtpErr);
    await wait(1000);
    await transporter.sendMail({
      ...mailOptions,
      messageId: generateMessageId(),
    });
    console.log(
      `[confirmation-email] Sent on retry to ${order.email} for order ${orderId}`,
    );
  }

  return { success: true };
}
