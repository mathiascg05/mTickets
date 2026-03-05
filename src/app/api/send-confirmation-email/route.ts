import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId } from "@/lib/mailer";
import { buildConfirmationEmailHtml, buildConfirmationEmailText } from "@/lib/emailTemplate";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryOrderWithRetry(orderId: string, retries = 3, delayMs = 2000) {
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
    if (orders[0]) return orders[0];
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

    const order = await queryOrderWithRetry(orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const ticketType = order.ticketType;
    if (!ticketType) {
      return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
    }
    const concert = ticketType.concert;
    if (!concert) {
      return NextResponse.json({ error: "Concert not found" }, { status: 404 });
    }

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
    } catch (smtpErr) {
      console.warn("SMTP send failed, retrying once:", smtpErr);
      await wait(1000);
      await transporter.sendMail({ ...mailOptions, messageId: generateMessageId() });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("send-confirmation-email error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
