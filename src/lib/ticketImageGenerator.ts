import sharp from "sharp";
import fs from "fs";
import path from "path";

// Load and cache font data as base64 for SVG embedding
let fontRegularB64: string | null = null;
let fontBoldB64: string | null = null;

function loadFonts() {
  if (fontRegularB64) return;
  const fontsDir = path.join(process.cwd(), "assets", "fonts");
  fontRegularB64 = fs.readFileSync(path.join(fontsDir, "Inter-Regular.ttf")).toString("base64");
  fontBoldB64 = fs.readFileSync(path.join(fontsDir, "Inter-Bold.ttf")).toString("base64");
}

export interface TicketImageParams {
  flyerBuffer: Buffer;
  primaryColor: string; // hex like "#1a2b4a"
  qrBuffer: Buffer;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  orderNumber: string;
  attendeeName: string;
}

const WIDTH = 1200;
const HEIGHT = 630;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Truncate text to fit within a max width (rough estimate: 0.6 * fontSize per char) */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "\u2026";
}

function buildTextOverlay(params: {
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  orderNumber: string;
  attendeeName: string;
}): Buffer {
  const eventName = escapeXml(truncate(params.eventName, 40));
  const eventDate = escapeXml(params.eventDate);
  const venue = escapeXml(truncate(params.venue, 50));
  const ticketTypeName = escapeXml(params.ticketTypeName);
  const orderNumber = escapeXml(params.orderNumber);
  const attendeeName = escapeXml(truncate(params.attendeeName, 35));

  // Left side text layout — embed fonts as base64 for serverless compatibility
  loadFonts();
  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <style>
    @font-face {
      font-family: 'Inter';
      font-weight: 400;
      src: url('data:font/truetype;base64,${fontRegularB64}');
    }
    @font-face {
      font-family: 'Inter';
      font-weight: 700;
      src: url('data:font/truetype;base64,${fontBoldB64}');
    }
    .shadow { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
    text { font-family: 'Inter', sans-serif; fill: #ffffff; }
  </style>

  <!-- Event name -->
  <text x="60" y="120" font-size="42" font-weight="700" class="shadow">${eventName}</text>

  <!-- Date & Venue -->
  <text x="60" y="165" font-size="20" font-weight="400" fill-opacity="0.9" class="shadow">${eventDate}</text>
  <text x="60" y="195" font-size="20" font-weight="400" fill-opacity="0.9" class="shadow">${venue}</text>

  <!-- Ticket type pill -->
  <rect x="56" y="215" width="${ticketTypeName.length * 11 + 32}" height="34" rx="17" fill="rgba(255,255,255,0.2)" />
  <text x="72" y="238" font-size="16" font-weight="600">${ticketTypeName}</text>

  <!-- Bottom left: attendee info -->
  <text x="60" y="${HEIGHT - 80}" font-size="22" font-weight="600" class="shadow">${attendeeName}</text>
  <text x="60" y="${HEIGHT - 52}" font-size="16" font-weight="400" fill-opacity="0.7" class="shadow">${orderNumber}</text>

  <!-- Bottom right: maTickets branding -->
  <text x="${WIDTH - 60}" y="${HEIGHT - 52}" font-size="14" font-weight="600" fill-opacity="0.5" text-anchor="end" class="shadow">maTickets</text>
</svg>`;

  return Buffer.from(svg);
}

export async function generateTicketImage(params: TicketImageParams): Promise<Buffer> {
  const { flyerBuffer, primaryColor, qrBuffer } = params;
  const { r, g, b } = hexToRgb(primaryColor);

  // 1. Resize flyer to cover 1200x630, then blur
  const blurredBackground = await sharp(flyerBuffer)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    .blur(25)
    .toBuffer();

  // 2. Color overlay (semi-transparent tint from primaryColor)
  const colorOverlay = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="rgba(${r},${g},${b},0.4)" /></svg>`,
  );

  // 3. Darken edges vignette for depth
  const vignette = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}">
      <defs>
        <radialGradient id="v" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="transparent" />
          <stop offset="100%" stop-color="rgba(0,0,0,0.45)" />
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#v)" />
    </svg>`,
  );

  // 4. QR code with white rounded background
  const qrSize = 180;
  const qrPadding = 16;
  const qrBoxSize = qrSize + qrPadding * 2;
  const qrX = WIDTH - 60 - qrBoxSize; // right side
  const qrY = Math.round((HEIGHT - qrBoxSize) / 2); // vertically centered

  const qrResized = await sharp(qrBuffer)
    .resize(qrSize, qrSize)
    .toBuffer();

  const qrBackground = Buffer.from(
    `<svg width="${qrBoxSize}" height="${qrBoxSize}">
      <rect width="${qrBoxSize}" height="${qrBoxSize}" rx="16" fill="white" />
    </svg>`,
  );

  const qrComposite = await sharp(qrBackground)
    .composite([{ input: qrResized, left: qrPadding, top: qrPadding }])
    .png()
    .toBuffer();

  // 5. Text overlay
  const textOverlay = buildTextOverlay({
    eventName: params.eventName,
    eventDate: params.eventDate,
    venue: params.venue,
    ticketTypeName: params.ticketTypeName,
    orderNumber: params.orderNumber,
    attendeeName: params.attendeeName,
  });

  // 6. Compose everything
  const result = await sharp(blurredBackground)
    .composite([
      { input: colorOverlay, blend: "over" },
      { input: vignette, blend: "over" },
      { input: qrComposite, left: qrX, top: qrY, blend: "over" },
      { input: textOverlay, blend: "over" },
    ])
    .png({ quality: 90 })
    .toBuffer();

  return result;
}
