import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildGuestTicketEmailHtml,
  buildGuestTicketEmailText,
} from "@/lib/guestListEmailTemplate";
import { assignGuestListOrderNumber } from "@/lib/guestListOrderNumber";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import { formatEventDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendGuestListTicketEmail(
  orderId: string,
): Promise<{ success: true } | { error: string }> {
  // Read the order with linked entry + event
  let order:
    | {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        status: string;
        pricePaid: number;
        orderToken: string;
        language?: string;
        entry?: unknown;
      }
    | undefined;
  for (let i = 0; i < 5; i++) {
    const { guestListOrders } = await adminDb.query({
      guestListOrders: {
        $: { where: { id: orderId } },
        entry: { event: {} },
      },
    });
    order = guestListOrders[0] as typeof order;
    if (order?.status === "approved") break;
    await wait(1500);
  }
  if (!order) return { error: "Order not found" };

  if (await isEmailSuppressed(order.email)) {
    return { success: true };
  }

  const rawEntry = order.entry as unknown;
  const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
    | { id: string; event: unknown }
    | undefined;
  const rawEvent = entry?.event as unknown;
  const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
    | {
        id: string;
        name: string;
        date: string;
        venue?: string;
        primaryColor?: string;
        defaultLanguage?: string;
      }
    | undefined;
  if (!event) return { error: "Event not found" };

  const orderNumber = await assignGuestListOrderNumber(orderId, event.id, event.name);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const ticketUrl = `${appUrl}/guest-ticket/${order.orderToken}`;

  const qrBuffer = await QRCode.toBuffer(`gl:${orderId}`, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1a2b4a", light: "#ffffff" },
  });

  const emailLang = resolveEmailLang(order.language, event.defaultLanguage);
  const pricePaidLabel =
    order.pricePaid === 0 ? "Cortesía" : `$${order.pricePaid.toFixed(2)}`;

  const html = await buildGuestTicketEmailHtml({
    firstName: order.firstName,
    lastName: order.lastName,
    eventName: event.name,
    eventDate: formatEventDate(event.date, emailLang),
    venue: event.venue || "",
    pricePaidLabel,
    ticketUrl,
    orderNumber,
    primaryColor: event.primaryColor,
    lang: emailLang,
  });
  const text = await buildGuestTicketEmailText({
    firstName: order.firstName,
    lastName: order.lastName,
    eventName: event.name,
    eventDate: formatEventDate(event.date, emailLang),
    venue: event.venue || "",
    pricePaidLabel,
    ticketUrl,
    orderNumber,
    lang: emailLang,
  });

  const tEmail = await getTranslations({
    locale: emailLang,
    namespace: "emails.guestTicket",
  });

  const mailOptions = {
    from: `"maTickets" <${EMAIL_FROM}>`,
    replyTo: EMAIL_FROM,
    to: order.email,
    subject: tEmail("subject", { orderNumber, eventName: event.name }),
    html,
    text,
    messageId: generateMessageId(),
    date: new Date(),
    envelope: { from: EMAIL_FROM, to: order.email },
    headers: buildMailHeaders(order.email),
    attachments: [
      {
        filename: "ticket-qr.png",
        content: qrBuffer,
        cid: "qr-code@matickets",
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.warn("[guest-list-ticket] SMTP retry:", err);
    await wait(1000);
    await transporter.sendMail({ ...mailOptions, messageId: generateMessageId() });
  }
  return { success: true };
}
