import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId } from "@/lib/mailer";
import { buildConfirmationEmailHtml, buildConfirmationEmailText } from "@/lib/emailTemplate";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryOrderWithRetry(orderId: string, retries = 5, delayMs = 2000) {
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
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    console.log(`[confirmation-email] Processing order ${orderId}`);

    const order = await queryOrderWithRetry(orderId);
    if (!order) {
      console.error(`[confirmation-email] Order ${orderId} not found after retries`);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { ticketType } = order;
    const { concert } = ticketType;

    // Calculate display price (phase-aware, discount-aware)
    const phase = (ticketType.phases || []).find(
      (p: { id: string }) => p.id === order.phaseId,
    );
    const basePrice = phase ? phase.price : ticketType.price;
    const finalPrice = basePrice - (order.discountAmount || 0);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const orderUrl = `${appUrl}/ticket/${orderId}`;

    const emailParams = {
      firstName: order.firstName,
      lastName: order.lastName,
      eventName: concert.name,
      eventDate: concert.date,
      venue: concert.venue,
      ticketTypeName: ticketType.name,
      price: `$${finalPrice.toFixed(2)}`,
      orderUrl,
    };
    const html = buildConfirmationEmailHtml(emailParams);
    const text = buildConfirmationEmailText(emailParams);

    const gmailUser = process.env.GMAIL_USER;
    const mailOptions = {
      from: `"maTickets" <${gmailUser}>`,
      replyTo: gmailUser,
      to: order.email,
      subject: `Confirmacion de orden - ${concert.name}`,
      html,
      text,
      messageId: generateMessageId(),
      date: new Date(),
      envelope: { from: gmailUser!, to: order.email },
      headers: {
        "List-Unsubscribe": `<mailto:${gmailUser}?subject=unsubscribe>`,
        "X-Mailer": "maTickets",
      },
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
