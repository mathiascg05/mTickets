import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { verifyDownloadToken } from "@/lib/downloadToken";
import fs from "fs";
import path from "path";

// Cache font data in module scope
let interRegular: ArrayBuffer | null = null;
let interBold: ArrayBuffer | null = null;

function loadFonts() {
  if (interRegular) return;
  const fontsDir = path.join(process.cwd(), "assets", "fonts");
  const regBuf = fs.readFileSync(path.join(fontsDir, "Inter-Regular.ttf"));
  interRegular = regBuf.buffer.slice(regBuf.byteOffset, regBuf.byteOffset + regBuf.byteLength);
  const boldBuf = fs.readFileSync(path.join(fontsDir, "Inter-Bold.ttf"));
  interBold = boldBuf.buffer.slice(boldBuf.byteOffset, boldBuf.byteOffset + boldBuf.byteLength);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const d = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  return `rgb(${d(r)},${d(g)},${d(b)})`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token || !verifyDownloadToken(orderId, token)) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 403 });
  }

  const { orders } = await adminDb.query({
    orders: {
      $: { where: { id: orderId } },
      ticketType: { concert: {} },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = concert as any;
  const primaryColor = (c.primaryColor as string) || "#1a2b4a";
  const eventName = (c.name as string) || "Event";
  const eventDate = (c.date as string) || "";
  const venue = (c.venue as string) || "";
  const ticketTypeName = (ticketType as { name?: string }).name || "General";
  const orderNumber = (order.orderNumber as string) || "";
  const attendeeName = `${order.firstName} ${order.lastName}`;

  // Generate QR code as data URI
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const ticketUrl = `${appUrl}/ticket/${orderId}`;
  const qrDataUrl = await QRCode.toDataURL(ticketUrl, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1a2b4a", light: "#ffffff" },
  });

  // Try to get flyer as data URI for background
  const flyerUrl = c.flyerUrl as string | undefined;
  let flyerDataUri: string | null = null;
  if (flyerUrl) {
    try {
      const res = await fetch(flyerUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const contentType = res.headers.get("content-type") || "image/jpeg";
        flyerDataUri = `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
      }
    } catch {
      // Fall through — use gradient
    }
  }

  loadFonts();
  const darkColor = darken(primaryColor, 0.4);

  const imageRes = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          fontFamily: "Inter",
          color: "#ffffff",
          background: `linear-gradient(180deg, ${primaryColor} 0%, ${darkColor} 100%)`,
        }}
      >
        {/* Background flyer image if available */}
        {flyerDataUri && (
          <img
            src={flyerDataUri}
            style={{
              position: "absolute",
              top: "-30px",
              left: "-30px",
              width: "690px",
              height: "1290px",
              objectFit: "cover",
              opacity: 0.25,
            }}
          />
        )}
        {/* Dark overlay for contrast */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: flyerDataUri
              ? `linear-gradient(180deg, ${primaryColor}cc 0%, ${primaryColor}99 100%)`
              : "transparent",
          }}
        />
        {/* Subtle glow */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background:
              "radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.08) 0%, transparent 60%)",
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            padding: "52px 44px",
            position: "relative",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Top: event info */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            <div
              style={{
                fontSize: "38px",
                fontWeight: 700,
                lineHeight: 1.15,
                textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                textAlign: "center",
                maxWidth: "560px",
              }}
            >
              {eventName.length > 40 ? eventName.slice(0, 39) + "\u2026" : eventName}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginTop: "14px",
                gap: "2px",
              }}
            >
              {eventDate && (
                <div
                  style={{
                    fontSize: "18px",
                    opacity: 0.9,
                    textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }}
                >
                  {eventDate}
                </div>
              )}
              {venue && (
                <div
                  style={{
                    fontSize: "18px",
                    opacity: 0.9,
                    textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }}
                >
                  {venue}
                </div>
              )}
            </div>
            {/* Ticket type pill */}
            <div style={{ display: "flex", marginTop: "18px" }}>
              <div
                style={{
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: "20px",
                  padding: "6px 22px",
                  fontSize: "15px",
                  fontWeight: 600,
                }}
              >
                {ticketTypeName}
              </div>
            </div>
          </div>

          {/* Center: QR code */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "24px",
                padding: "24px",
                boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
                display: "flex",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} width={240} height={240} />
            </div>
          </div>

          {/* Bottom: attendee info + branding */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            <div
              style={{
                fontSize: "22px",
                fontWeight: 600,
                textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                textAlign: "center",
              }}
            >
              {attendeeName.length > 35
                ? attendeeName.slice(0, 34) + "\u2026"
                : attendeeName}
            </div>
            {orderNumber && (
              <div
                style={{
                  fontSize: "15px",
                  opacity: 0.7,
                  marginTop: "4px",
                  textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }}
              >
                {orderNumber}
              </div>
            )}
            <div
              style={{
                fontSize: "13px",
                opacity: 0.35,
                fontWeight: 600,
                marginTop: "20px",
              }}
            >
              maTickets
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 630,
      height: 1120,
      fonts: [
        { name: "Inter", data: interRegular!, weight: 400, style: "normal" as const },
        { name: "Inter", data: interBold!, weight: 700, style: "normal" as const },
      ],
    },
  );

  const buffer = await imageRes.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="entrada-${orderNumber || orderId}.png"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
