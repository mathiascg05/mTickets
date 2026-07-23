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
  groupName: string,
  tickets: AllotmentTicket[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait, page title header + 2 columns × 3 rows = 6 tickets per page.
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 32;
  const HEADER_H = 52;
  const COLS = 2;
  const ROWS = 3;
  const gridTop = PAGE_H - MARGIN - HEADER_H; // grid area starts below the title
  const cellW = (PAGE_W - MARGIN * 2) / COLS;
  const cellH = (gridTop - MARGIN) / ROWS;
  const perPage = COLS * ROWS;

  const ink = rgb(0.102, 0.169, 0.29); // #1a2b4a
  const line = rgb(0.847, 0.867, 0.902); // #d8dde6
  const muted = rgb(0.478, 0.522, 0.6); // #7a8599

  const sorted = [...tickets].sort((a, b) => a.seq - b.seq);

  function drawHeader(page: import("pdf-lib").PDFPage) {
    // Recipient group name as the document title, event name beneath it.
    const titleSize = 16;
    const title = fit(groupName || "", fontBold, titleSize, PAGE_W - MARGIN * 2);
    page.drawText(title, {
      x: PAGE_W / 2 - fontBold.widthOfTextAtSize(title, titleSize) / 2,
      y: PAGE_H - MARGIN - 14,
      size: titleSize,
      font: fontBold,
      color: ink,
    });
    if (eventName) {
      const evSize = 10;
      const ev = fit(eventName, font, evSize, PAGE_W - MARGIN * 2);
      page.drawText(ev, {
        x: PAGE_W / 2 - font.widthOfTextAtSize(ev, evSize) / 2,
        y: PAGE_H - MARGIN - 32,
        size: evSize,
        font,
        color: muted,
      });
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    if (i % perPage === 0) {
      const p = pdf.addPage([PAGE_W, PAGE_H]);
      drawHeader(p);
    }
    const page = pdf.getPage(pdf.getPageCount() - 1);
    const t = sorted[i];
    const idx = i % perPage;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cellX = MARGIN + col * cellW;
    const cellTop = gridTop - row * cellH; // y measured from bottom
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

    // QR — anchored near the top of the cell (not centered), leaving a clear
    // gap above the number/type at the bottom.
    const qrTop = cellTop - 18;
    const qrSize = Math.min(cellW - 44, cellH - 62);
    const qrY = qrTop - qrSize; // bottom of the QR image
    const qrPng = await QRCode.toBuffer(
      `${appUrl}/ticket/${t.orderId}?vt=${generateTicketViewToken(t.orderId)}`,
      { width: 320, margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a2b4a", light: "#ffffff" } },
    );
    const qrImg = await pdf.embedPng(qrPng);
    page.drawImage(qrImg, {
      x: centerX - qrSize / 2,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });

    // Ticket number (bold) + type, at the bottom of the cell (clear of the QR).
    const numSize = 14;
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
