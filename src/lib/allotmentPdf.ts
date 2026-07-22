import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { generateTicketViewToken } from "@/lib/ticketViewToken";

export type AllotmentTicket = {
  orderId: string;
  label: string; // e.g. "#001 General"
};

// White canvas with a centered QR + caption underneath. Adapted from
// scripts/generate-courtesies.ts (buildLabeledQr).
async function buildLabeledQr(
  appUrl: string,
  orderId: string,
  label: string,
): Promise<Buffer> {
  const vt = generateTicketViewToken(orderId);
  const qrBuf = await QRCode.toBuffer(
    `${appUrl}/ticket/${orderId}?vt=${vt}`,
    {
      width: 800,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#1a2b4a", light: "#ffffff" },
    },
  );

  const W = 900;
  const QR_TOP = 40;
  const QR_LEFT = 50;
  const CAPTION_H = 130;
  const H = QR_TOP + 800 + CAPTION_H;

  const captionSvg = Buffer.from(
    `<svg width="${W}" height="${CAPTION_H}" xmlns="http://www.w3.org/2000/svg">
       <text x="${W / 2}" y="90" text-anchor="middle"
             font-family="Helvetica, Arial, sans-serif" font-size="56"
             font-weight="bold" fill="#1a2b4a">${label}</text>
     </svg>`,
  );

  return sharp({
    create: { width: W, height: H, channels: 4, background: "#ffffff" },
  })
    .composite([
      { input: qrBuf, top: QR_TOP, left: QR_LEFT },
      { input: captionSvg, top: QR_TOP + 800, left: 0 },
    ])
    .png()
    .toBuffer();
}

// Build a multi-page PDF, one labeled QR ticket per page.
export async function buildAllotmentPdf(
  appUrl: string,
  tickets: AllotmentTicket[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const t of tickets) {
    const png = await buildLabeledQr(appUrl, t.orderId, t.label);
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return pdf.save();
}
