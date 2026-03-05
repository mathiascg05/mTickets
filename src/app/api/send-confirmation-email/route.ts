import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { transporter } from "@/lib/mailer";
import { buildConfirmationEmailHtml } from "@/lib/emailTemplate";

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

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

    const html = buildConfirmationEmailHtml({
      firstName: order.firstName,
      lastName: order.lastName,
      eventName: concert.name,
      eventDate: concert.date,
      venue: concert.venue,
      ticketTypeName: ticketType.name,
      price: `$${finalPrice.toFixed(2)}`,
      orderUrl,
    });

    await transporter.sendMail({
      from: `"maTickets" <${process.env.GMAIL_USER}>`,
      to: order.email,
      subject: `Confirmacion de orden - ${concert.name}`,
      html,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("send-confirmation-email error:", err);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
