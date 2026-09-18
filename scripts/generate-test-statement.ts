import "dotenv/config";
import { writeFileSync } from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { adminDb } from "../src/lib/adminDb";

/**
 * Genera estados de cuenta INVENTADOS (PDF) para probar a mano la conciliacion
 * con IA. SOLO LECTURA: no muta nada. Usa un concierto de PRUEBA.
 *
 * Crea antes, en el concierto de prueba, compras PENDIENTES cuyo comprador
 * (primer asistente) tenga este nombre:
 *   - "Exacto"   Pago Movil, con referencia            → (a) match exacto
 *   - "Captura"  Pago Movil de un metodo SIN referencia → (c) rescatada por sugerencia
 *   - "Digito"   Pago Movil, con referencia            → (d) el banco trae un digito cambiado
 *   - "Extras"   Zelle, comprando extras               → (b) el caso del bug corregido
 * y un lote de entradas (Lotes de entradas) con comprobante enviado por Pago
 * Movil y referencia                                   → (e) pago de lote
 *
 * Uso:
 *   CONCERT_ID=<id> npx tsx scripts/generate-test-statement.ts
 * Salida: test-statement-pago-movil.pdf y test-statement-zelle.pdf
 */
const CONCERT_ID = process.env.CONCERT_ID;

type Row = { date: string; description: string; reference: string; credit?: number; debit?: number };

function flip(digit: string): string {
  return String((Number(digit) + 1) % 10);
}

async function main() {
  if (!CONCERT_ID) throw new Error("Falta CONCERT_ID");
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "";
  console.log(`Target: ${appId.startsWith("66280f75") ? "PRODUCCIÓN" : "no-prod"} (solo lectura)`);

  const { orders } = await adminDb.query({
    orders: { $: { where: { status: "pending", "ticketType.concert.id": CONCERT_ID } } },
  });
  const { ticketAllotments } = await adminDb.query({
    ticketAllotments: { $: { where: { "concert.id": CONCERT_ID } } },
  });

  const byName = (name: string) => {
    const anchor = orders.find((o) => o.firstName.trim().toLowerCase() === name.toLowerCase());
    if (!anchor) {
      console.warn(`⚠️  No hay orden pendiente con nombre "${name}" — se omite su escenario`);
      return null;
    }
    const group = orders.filter((o) => o.proofReferenceNumber && o.proofReferenceNumber === anchor.proofReferenceNumber);
    return { anchor, group: group.length ? group : [anchor] };
  };
  const bs = (g: { group: typeof orders }) =>
    Math.round(g.group.reduce((s, o) => s + (o.purchaseAmountBs ?? 0) + (o.extrasAmountBs ?? 0), 0) * 100) / 100;
  const usd = (g: { group: typeof orders }) =>
    Math.round(g.group.reduce((s, o) => s + (o.totalSnapshot ?? 0), 0) * 100) / 100;

  const pm: Row[] = [];
  const zelle: Row[] = [];

  const exacto = byName("Exacto");
  if (exacto) {
    const digits = (exacto.anchor.proofReferenceNumber ?? "").split("-").pop() ?? "";
    pm.push({ date: "10/09/2026", description: "PAGO MOVIL RECIBIDO 0414", reference: `00988${digits}`, credit: bs(exacto) });
  }
  const captura = byName("Captura");
  if (captura) {
    pm.push({
      date: "11/09/2026",
      description: `PAGO MOVIL DE ${captura.anchor.firstName} ${captura.anchor.lastName}`.toUpperCase(),
      reference: "00455120931",
      credit: bs(captura),
    });
  }
  const digito = byName("Digito");
  if (digito) {
    const digits = (digito.anchor.proofReferenceNumber ?? "").split("-").pop() ?? "0000";
    const altered = digits.slice(0, -1) + flip(digits.slice(-1));
    pm.push({ date: "12/09/2026", description: "PAGO MOVIL RECIBIDO 0412", reference: `00731${altered}`, credit: bs(digito) });
  }
  const lot = ticketAllotments.find((a) => (a.status === "pending" || a.status === "submitted") && a.purchaseAmountBs);
  if (lot) {
    const refDigits = (lot.proofReferenceNumber ?? "").replace(/\D/g, "").slice(-4) || "7777";
    pm.push({
      date: "12/09/2026",
      description: `TRANSFERENCIA ${lot.schoolName}`.toUpperCase().slice(0, 60),
      reference: `00112${refDigits}`,
      credit: lot.purchaseAmountBs!,
    });
  } else {
    console.warn("⚠️  No hay lote pendiente/enviado con monto en Bs — se omite el escenario (e)");
  }
  // (f) ajenos al evento
  pm.push({ date: "13/09/2026", description: "PAGO MOVIL RECIBIDO 0424", reference: "00999887766", credit: 1234.56 });
  pm.push({ date: "13/09/2026", description: "COMISION MANTENIMIENTO", reference: "00000000017", debit: 45 });
  pm.push({ date: "14/09/2026", description: "PAGO A PROVEEDOR", reference: "00555443322", debit: 5200 });

  const extras = byName("Extras");
  if (extras) {
    zelle.push({
      date: "09/10/2026",
      description: `Zelle payment from ${extras.anchor.firstName} ${extras.anchor.lastName} ${extras.anchor.proofReferenceNumber}`.toUpperCase(),
      reference: "ZL88213457",
      credit: usd(extras),
    });
  }
  zelle.push({ date: "09/11/2026", description: "ZELLE PAYMENT FROM JOHN SMITH RENT", reference: "ZL88213999", credit: 850 });
  zelle.push({ date: "09/12/2026", description: "ZELLE TO MARIA LOPEZ", reference: "ZL88214000", debit: 60 });

  await writeStatement("test-statement-pago-movil.pdf", "BANCO DE PRUEBA, C.A.", "Cuenta corriente 0102-****-****-4521 · Bs", pm, "es");
  await writeStatement("test-statement-zelle.pdf", "TEST BANK, N.A.", "Checking account ****7788 · USD", zelle, "en");
  console.log(`✅ ${pm.length} movimientos Pago Móvil, ${zelle.length} Zelle`);
}

async function writeStatement(file: string, bank: string, account: string, rows: Row[], locale: "es" | "en") {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fmt = (n?: number) =>
    n == null ? "" : locale === "es"
      ? n.toLocaleString("es-VE", { minimumFractionDigits: 2 })
      : n.toLocaleString("en-US", { minimumFractionDigits: 2 });
  // Helvetica estandar no tiene todos los glifos: normalizamos acentos.
  const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  let y = 740;
  page.drawText(bank, { x: 40, y, size: 16, font: bold });
  y -= 20;
  page.drawText(account, { x: 40, y, size: 10, font });
  y -= 14;
  page.drawText(locale === "es" ? "Estado de cuenta · Septiembre 2026" : "Statement · September 2026", { x: 40, y, size: 10, font });
  y -= 30;
  const cols = locale === "es"
    ? ["Fecha", "Concepto", "Referencia", "Débito", "Crédito"]
    : ["Date", "Description", "Reference", "Debit", "Credit"];
  const xs = [40, 105, 355, 450, 525];
  cols.forEach((c, i) => page.drawText(ascii(c), { x: xs[i], y, size: 9, font: bold }));
  y -= 6;
  page.drawLine({ start: { x: 40, y }, end: { x: 580, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  y -= 14;
  for (const r of rows) {
    page.drawText(r.date, { x: xs[0], y, size: 8, font });
    page.drawText(ascii(r.description).slice(0, 48), { x: xs[1], y, size: 8, font });
    page.drawText(r.reference, { x: xs[2], y, size: 8, font });
    page.drawText(fmt(r.debit), { x: xs[3], y, size: 8, font });
    page.drawText(fmt(r.credit), { x: xs[4], y, size: 8, font });
    y -= 16;
  }
  y -= 10;
  page.drawText(ascii(locale === "es" ? "Saldo final: 98.765,43" : "Ending balance: 12,345.67"), { x: 40, y, size: 9, font: bold });
  writeFileSync(file, await pdf.save());
  console.log(`📄 ${file}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
