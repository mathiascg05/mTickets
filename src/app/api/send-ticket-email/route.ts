import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId } from "@/lib/mailer";
import { buildTicketEmailHtml, buildTicketEmailText } from "@/lib/emailTemplate";
import { assignOrderNumber } from "@/lib/orderNumber";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryApprovedOrderWithRetry(orderId: string, retries = 5, delayMs = 2000) {
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
    if (order?.status === "approved" && ticketType && concert) {
      return { ...order, ticketType: { ...ticketType, concert, phases: ticketType.phases || [] } };
    }
    console.log(`[ticket-email] Retry ${i + 1}/${retries}: order=${!!order}, status=${order?.status}, ticketType=${!!ticketType}, concert=${!!concert}`);
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
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user || !adminEmail || user.email !== adminEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    console.log(`[ticket-email] Processing order ${orderId}`);

    const order = await queryApprovedOrderWithRetry(orderId);
    if (!order) {
      console.error(`[ticket-email] Order ${orderId} not found/not approved after retries`);
      return NextResponse.json({ error: "Order not found or not approved" }, { status: 404 });
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
    const finalPrice = basePrice - (order.discountAmount || 0);

    // Generate QR code as PNG buffer
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const ticketUrl = `${appUrl}/ticket/${orderId}`;

    const qrBuffer = await QRCode.toBuffer(ticketUrl, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#1a2b4a", light: "#ffffff" },
    });

    // Build email HTML and plain text
    const emailParams = {
      firstName: order.firstName,
      lastName: order.lastName,
      eventName: concert.name,
      eventDate: concert.date,
      venue: concert.venue,
      ticketTypeName: ticketType.name,
      price: `$${finalPrice.toFixed(2)}`,
      ticketUrl,
      orderNumber,
    };
    const html = buildTicketEmailHtml(emailParams);
    const text = buildTicketEmailText(emailParams);

    const gmailUser = process.env.GMAIL_USER;
    const mailOptions = {
      from: `"maTickets" <${gmailUser}>`,
      replyTo: gmailUser,
      to: order.email,
      subject: `Ticket ${orderNumber} - ${concert.name}`,
      html,
      text,
      messageId: generateMessageId(),
      date: new Date(),
      envelope: { from: gmailUser!, to: order.email },
      headers: {
        "List-Unsubscribe": `<mailto:${gmailUser}?subject=unsubscribe>`,
        "X-Mailer": "maTickets",
      },
      attachments: [
        {
          filename: "ticket-qr.png",
          content: qrBuffer,
          cid: "qr-code@matickets",
        },
        {
          filename: "ticket-qr.png",
          content: qrBuffer,
          contentType: "image/png",
        },
      ],
    };

    // Send with one retry on SMTP failure
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[ticket-email] Sent to ${order.email} for order ${orderId}`);
    } catch (smtpErr) {
      console.warn("[ticket-email] SMTP send failed, retrying once:", smtpErr);
      await wait(1000);
      await transporter.sendMail({ ...mailOptions, messageId: generateMessageId() });
      console.log(`[ticket-email] Sent on retry to ${order.email} for order ${orderId}`);
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
