import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { adminDb } from "@/lib/adminDb";
import { verifyDownloadToken } from "@/lib/downloadToken";
import sharp from "sharp";
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

  const concertId = c.id as string;

  // Try to get logo as data URI (stored URL first, then $files fallback)
  let logoDataUri: string | null = null;
  async function fetchLogoDataUri(): Promise<string | null> {
    // 1. Try stored URL (always points to the latest upload)
    const logoUrl = c.logoUrl as string | undefined;
    if (logoUrl) {
      try {
        const res = await fetch(logoUrl, { cache: "no-store" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const ct = res.headers.get("content-type") || "image/png";
          return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`;
        }
      } catch { /* fall through */ }
    }

    // 2. Fallback: query $files by path pattern
    try {
      const { $files } = await adminDb.query({
        $files: {
          $: { where: { path: { $like: `event-assets/${concertId}/logo%` } } },
        },
      });
      const file = $files[0];
      const url = file?.url as string | undefined;
      if (url) {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const ct = res.headers.get("content-type") || "image/png";
          return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`;
        }
      }
    } catch { /* fall through */ }

    return null;
  }
  logoDataUri = await fetchLogoDataUri();

  // Generate QR code as data URI
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const ticketUrl = `${appUrl}/ticket/${orderId}`;
  const qrDataUrl = await QRCode.toDataURL(ticketUrl, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1a2b4a", light: "#ffffff" },
  });

  // Try to get flyer, blur it with sharp, and convert to data URI
  let flyerDataUri: string | null = null;

  // Try stored URL first (always current), then $files fallback
  async function fetchFlyerBuffer(): Promise<Buffer | null> {
    // 1. Try the stored flyerUrl (always points to the latest upload)
    const flyerUrl = c.flyerUrl as string | undefined;
    if (flyerUrl) {
      try {
        const res = await fetch(flyerUrl, { cache: "no-store" });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch {
        // Fall through
      }
    }

    // 2. Fallback: query $files by path pattern
    try {
      const { $files } = await adminDb.query({
        $files: {
          $: { where: { path: { $like: `event-assets/${concertId}/flyer%` } } },
        },
      });
      const file = $files[0];
      if (file?.url) {
        const res = await fetch(file.url as string, { cache: "no-store" });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      }
    } catch {
      // Fall through
    }

    return null;
  }

  const flyerRaw = await fetchFlyerBuffer();
  if (flyerRaw) {
    try {
      const blurred = await sharp(flyerRaw)
        .resize(630, 1120, { fit: "cover", position: "centre" })
        .blur(20)
        .jpeg({ quality: 70 })
        .toBuffer();
      flyerDataUri = `data:image/jpeg;base64,${blurred.toString("base64")}`;
    } catch {
      // Sharp processing failed — use gradient
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
        {/* Background: pre-blurred flyer */}
        {flyerDataUri && (
          <img
            src={flyerDataUri}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1260px",
              height: "2240px",
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
              ? `linear-gradient(180deg, ${primaryColor}bb 0%, ${primaryColor}88 100%)`
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
            padding: "104px 88px",
            position: "relative",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Top: logo + event info */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            {logoDataUri && (
              <img
                src={logoDataUri}
                style={{
                  width: "160px",
                  height: "160px",
                  borderRadius: "32px",
                  objectFit: "contain",
                  marginBottom: "32px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
                }}
              />
            )}
            <div
              style={{
                fontSize: "76px",
                fontWeight: 700,
                lineHeight: 1.15,
                textShadow: "0 4px 16px rgba(0,0,0,0.3)",
                textAlign: "center",
                maxWidth: "1120px",
              }}
            >
              {eventName.length > 40 ? eventName.slice(0, 39) + "\u2026" : eventName}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginTop: "28px",
                gap: "4px",
              }}
            >
              {eventDate && (
                <div
                  style={{
                    fontSize: "36px",
                    opacity: 0.9,
                    textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  }}
                >
                  {eventDate}
                </div>
              )}
              {venue && (
                <div
                  style={{
                    fontSize: "36px",
                    opacity: 0.9,
                    textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  }}
                >
                  {venue}
                </div>
              )}
            </div>
            {/* Ticket type pill */}
            <div style={{ display: "flex", marginTop: "36px" }}>
              <div
                style={{
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: "40px",
                  padding: "12px 44px",
                  fontSize: "30px",
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
                borderRadius: "48px",
                padding: "48px",
                boxShadow: "0 16px 80px rgba(0,0,0,0.3)",
                display: "flex",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} width={480} height={480} />
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
                fontSize: "44px",
                fontWeight: 600,
                textShadow: "0 2px 8px rgba(0,0,0,0.3)",
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
                  fontSize: "30px",
                  opacity: 0.7,
                  marginTop: "8px",
                  textShadow: "0 2px 8px rgba(0,0,0,0.3)",
                }}
              >
                {orderNumber}
              </div>
            )}
            <div
              style={{
                fontSize: "26px",
                opacity: 0.35,
                fontWeight: 600,
                marginTop: "40px",
              }}
            >
              maTickets
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1260,
      height: 2240,
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
      "Cache-Control": "no-cache",
    },
  });
}
