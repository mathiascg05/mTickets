import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { generateTicketViewToken } from "@/lib/ticketViewToken";

export type AllotmentTicket = {
  orderId: string;
  seq: number;
  ticketTypeName: string;
};

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

// Fit/truncate a string to a max width at a given font size (…-ellipsis).
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

// Clean, ordered PDF of allotment tickets: a grid of cut-out cards, each with a
// scannable QR, the ticket number (#001), the ticket type and the event name.
// Uses pdf-lib's built-in Helvetica (embedded), so text never renders as tofu.
export async function buildAllotmentPdf(
  appUrl: string,
  eventName: string,
  tickets: AllotmentTicket[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait, 2 columns × 4 rows = 8 tickets per page.
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 32;
  const COLS = 2;
  const ROWS = 4;
  const cellW = (PAGE_W - MARGIN * 2) / COLS;
  const cellH = (PAGE_H - MARGIN * 2) / ROWS;
  const perPage = COLS * ROWS;

  const ink = rgb(0.102, 0.169, 0.29); // #1a2b4a
  const line = rgb(0.847, 0.867, 0.902); // #d8dde6
  const muted = rgb(0.478, 0.522, 0.6); // #7a8599

  const sorted = [...tickets].sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < sorted.length; i++) {
    if (i % perPage === 0) pdf.addPage([PAGE_W, PAGE_H]);
    const page = pdf.getPage(pdf.getPageCount() - 1);
    const t = sorted[i];
    const idx = i % perPage;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cellX = MARGIN + col * cellW;
    const cellTop = PAGE_H - MARGIN - row * cellH; // y measured from bottom
    const cellBottom = cellTop - cellH;
    const centerX = cellX + cellW / 2;

    // Cut-guide border.
    const inset = 6;
    page.drawRectangle({
      x: cellX + inset,
      y: cellBottom + inset,
      width: cellW - inset * 2,
      height: cellH - inset * 2,
      borderColor: line,
      borderWidth: 0.75,
    });

    // Event name (top, small, muted).
    const evSize = 8;
    const evText = fit(eventName, font, evSize, cellW - 24);
    page.drawText(evText, {
      x: centerX - font.widthOfTextAtSize(evText, evSize) / 2,
      y: cellTop - 20,
      size: evSize,
      font,
      color: muted,
    });

    // QR.
    const qrPng = await QRCode.toBuffer(
      `${appUrl}/ticket/${t.orderId}?vt=${generateTicketViewToken(t.orderId)}`,
      { width: 300, margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a2b4a", light: "#ffffff" } },
    );
    const qrImg = await pdf.embedPng(qrPng);
    const qrSize = Math.min(cellW - 48, cellH - 78);
    page.drawImage(qrImg, {
      x: centerX - qrSize / 2,
      y: cellBottom + (cellH - qrSize) / 2 - 2,
      width: qrSize,
      height: qrSize,
    });

    // Ticket number (bold) + type, below the QR.
    const numSize = 13;
    const numText = `#${pad(t.seq)}`;
    page.drawText(numText, {
      x: centerX - fontBold.widthOfTextAtSize(numText, numSize) / 2,
      y: cellBottom + 26,
      size: numSize,
      font: fontBold,
      color: ink,
    });
    if (t.ticketTypeName) {
      const typeSize = 9;
      const typeText = fit(t.ticketTypeName, font, typeSize, cellW - 24);
      page.drawText(typeText, {
        x: centerX - font.widthOfTextAtSize(typeText, typeSize) / 2,
        y: cellBottom + 13,
        size: typeSize,
        font,
        color: muted,
      });
    }
  }

  return pdf.save();
}
