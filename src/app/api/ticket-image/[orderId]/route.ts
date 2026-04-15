import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { verifyDownloadToken } from "@/lib/downloadToken";
import { generateTicketImage } from "@/lib/ticketImageGenerator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token || !verifyDownloadToken(orderId, token)) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 403 });
  }

  // Query order with related data
  const { orders } = await adminDb.query({
    orders: {
      $: { where: { id: orderId } },
      ticketType: {
        concert: {},
      },
    },
  });

  const order = orders[0];
  if (!order || order.status !== "approved") {
    return NextResponse.json({ error: "Order not found or not approved" }, { status: 404 });
  }

  const rawTT = order.ticketType as unknown;
  const ticketType = Array.isArray(rawTT) ? rawTT[0] : rawTT;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawConcert = (ticketType as any)?.concert as unknown;
  const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;

  if (!ticketType || !concert) {
    return NextResponse.json({ error: "Missing ticket or event data" }, { status: 404 });
  }

  // Generate QR code
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const ticketUrl = `${appUrl}/ticket/${orderId}`;
  const qrBuffer = await QRCode.toBuffer(ticketUrl, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1a2b4a", light: "#ffffff" },
  });

  // Fetch flyer image
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = concert as any;
  const flyerUrl = c.flyerUrl as string | undefined;
  const primaryColor = (c.primaryColor as string) || "#1a2b4a";

  let flyerBuffer: Buffer;
  if (flyerUrl) {
    const flyerRes = await fetch(flyerUrl);
    if (!flyerRes.ok) {
      return NextResponse.json({ error: "Failed to fetch event flyer" }, { status: 500 });
    }
    flyerBuffer = Buffer.from(await flyerRes.arrayBuffer());
  } else {
    // Generate a solid color fallback if no flyer
    const sharp = (await import("sharp")).default;
    const { r, g, b } = hexToRgb(primaryColor);
    flyerBuffer = await sharp({
      create: { width: 1200, height: 630, channels: 3, background: { r, g, b } },
    })
      .png()
      .toBuffer();
  }

  const orderNumber = (order.orderNumber as string) || "";
  const imageBuffer = await generateTicketImage({
    flyerBuffer,
    primaryColor,
    qrBuffer,
    eventName: c.name || "Event",
    eventDate: c.date || "",
    venue: c.venue || "",
    ticketTypeName: (ticketType as { name?: string }).name || "General",
    orderNumber,
    attendeeName: `${order.firstName} ${order.lastName}`,
  });

  return new NextResponse(new Uint8Array(imageBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="entrada-${orderNumber || orderId}.png"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}
