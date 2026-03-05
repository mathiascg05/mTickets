import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { transporter } from "@/lib/mailer";
import { buildTicketEmailHtml, buildTicketEmailText } from "@/lib/emailTemplate";

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // Fetch order with related ticketType and concert
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
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.status !== "approved") {
      return NextResponse.json({ error: "Order is not approved" }, { status: 400 });
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
    };
    const html = buildTicketEmailHtml(emailParams);
    const text = buildTicketEmailText(emailParams);

    // Send email
    await transporter.sendMail({
      from: `"maTickets" <${process.env.GMAIL_USER}>`,
      replyTo: process.env.GMAIL_USER,
      to: order.email,
      subject: `Tu entrada para ${concert.name}`,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<mailto:${process.env.GMAIL_USER}?subject=unsubscribe>`,
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
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("send-ticket-email error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
