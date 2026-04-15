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
          position: "relative",
          fontFamily: "Inter",
          color: "#ffffff",
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${darkColor} 100%)`,
        }}
      >
        {/* Background flyer image if available */}
        {flyerDataUri && (
          <img
            src={flyerDataUri}
            style={{
              position: "absolute",
              top: "-40px",
              left: "-40px",
              width: "1280px",
              height: "710px",
              objectFit: "cover",
              opacity: 0.3,
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
              ? `linear-gradient(135deg, ${primaryColor}cc 0%, ${primaryColor}88 100%)`
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
              "radial-gradient(ellipse at 70% 50%, rgba(255,255,255,0.06) 0%, transparent 60%)",
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            padding: "48px 56px",
            position: "relative",
            justifyContent: "space-between",
          }}
        >
          {/* Left column */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              flex: 1,
              paddingRight: "40px",
            }}
          >
            {/* Top: event info */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: "42px",
                  fontWeight: 700,
                  lineHeight: 1.1,
                  textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  maxWidth: "650px",
                }}
              >
                {eventName.length > 40 ? eventName.slice(0, 39) + "\u2026" : eventName}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginTop: "16px",
                  gap: "4px",
                }}
              >
                {eventDate && (
                  <div
                    style={{
                      fontSize: "20px",
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
                      fontSize: "20px",
                      opacity: 0.9,
                      textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                    }}
                  >
                    {venue}
                  </div>
                )}
              </div>
              {/* Ticket type pill */}
              <div style={{ display: "flex", marginTop: "20px" }}>
                <div
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: "20px",
                    padding: "6px 20px",
                    fontSize: "16px",
                    fontWeight: 600,
                  }}
                >
                  {ticketTypeName}
                </div>
              </div>
            </div>

            {/* Bottom: attendee + branding */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 600,
                    textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                  }}
                >
                  {attendeeName.length > 35
                    ? attendeeName.slice(0, 34) + "\u2026"
                    : attendeeName}
                </div>
                {orderNumber && (
                  <div
                    style={{
                      fontSize: "16px",
                      opacity: 0.7,
                      marginTop: "4px",
                      textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                    }}
                  >
                    {orderNumber}
                  </div>
                )}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.4, fontWeight: 600 }}>
                maTickets
              </div>
            </div>
          </div>

          {/* Right column: QR code */}
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
                borderRadius: "20px",
                padding: "20px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                display: "flex",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} width={180} height={180} />
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
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
