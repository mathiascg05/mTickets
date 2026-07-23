import "dotenv/config";
import { id as genId } from "@instantdb/admin";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { adminDb } from "../src/lib/adminDb";
import { approveOrderInternal } from "../src/lib/approveOrder";
import { assignOrderNumber } from "../src/lib/orderNumber";

/**
 * Genera "cortesías" VIP para eventos NORMALES (concerts): crea órdenes con el flujo
 * cortesía (cobrado $0, sin tocar balance), las aprueba SIN enviar correo, y exporta
 * los QR como PNG individuales + un PDF (una cortesía por página) + un manifiesto CSV.
 *
 * Los creadores envían las invitaciones ellos mismos pegando el QR en su plantilla; el
 * QR funciona en la puerta porque la orden queda aprobada (el escáner valida
 * status:"approved" y marca visited). Espeja la lógica de /api/admin/create-order.
 *
 *   tsx scripts/generate-courtesies.ts            # genera (idempotente)
 *   DRY_RUN=1 tsx scripts/generate-courtesies.ts  # solo inspecciona, no escribe
 */

const DRY_RUN = process.env.DRY_RUN === "1";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ma-tickets.com";
const OUT_ROOT = join(homedir(), "Downloads", "cortesias");
const LABEL_PREFIX = "Cortesía";

type EventConfig = {
  /** substring (case-insensitive) en concert.name */
  eventMatch: string;
  /** substring (case-insensitive) en ticketType.name */
  ttMatch: string;
  count: number;
};

const EVENTS: EventConfig[] = [
  { eventMatch: "living", ttMatch: "vip", count: 120 },
  { eventMatch: "memories", ttMatch: "vip", count: 80 },
];

type Order = { id: string; status: string; email?: string };
type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  feePercent?: number;
  feeFixed?: number;
  orders?: Order[];
};
type Concert = {
  id: string;
  name: string;
  slug: string;
  ticketTypes?: TicketType[];
};

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reintenta una operación de red ante errores transitorios (EADDRNOTAVAIL, fetch failed). */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(2000, 150 * 2 ** (attempt - 1));
      console.warn(`   ⟳ reintento ${attempt}/6 (${label}) tras error de red, espero ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function syntheticEmail(slug: string, n: number): string {
  return `cortesia-${slug}-${pad(n)}@cortesias.matickets.local`;
}

/** Lienzo blanco con QR centrado + caption "Cortesía 001" debajo. */
async function buildLabeledQr(orderId: string, label: string): Promise<Buffer> {
  const qrBuf = await QRCode.toBuffer(`${APP_URL}/ticket/${orderId}`, {
    width: 800,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1a2b4a", light: "#ffffff" },
  });

  const W = 900;
  const QR_TOP = 40;
  const QR_LEFT = 50; // (900 - 800) / 2
  const CAPTION_H = 130;
  const H = QR_TOP + 800 + CAPTION_H;

  const captionSvg = Buffer.from(
    `<svg width="${W}" height="${CAPTION_H}" xmlns="http://www.w3.org/2000/svg">
       <text x="${W / 2}" y="90" text-anchor="middle"
             font-family="Helvetica, Arial, sans-serif" font-size="60"
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

async function resolveTarget(cfg: EventConfig) {
  const { concerts } = await withRetry("query concerts", () =>
    adminDb.query({ concerts: { ticketTypes: { orders: {} } } }),
  );
  const cMatches = (concerts as Concert[]).filter((c) =>
    c.name.toLowerCase().includes(cfg.eventMatch.toLowerCase()),
  );
  if (cMatches.length !== 1) {
    console.error(`\n✖ "${cfg.eventMatch}" matcheó ${cMatches.length} conciertos:`);
    for (const c of concerts as Concert[])
      console.error(`   - "${c.name}"  id=${c.id}`);
    throw new Error(`Ajusta eventMatch para "${cfg.eventMatch}".`);
  }
  const concert = cMatches[0];
  const tts = concert.ticketTypes || [];
  const ttMatches = tts.filter((t) =>
    t.name.toLowerCase().includes(cfg.ttMatch.toLowerCase()),
  );
  if (ttMatches.length !== 1) {
    console.error(
      `\n✖ "${cfg.ttMatch}" matcheó ${ttMatches.length} tipos en "${concert.name}":`,
    );
    for (const t of tts) console.error(`   - "${t.name}"  id=${t.id}`);
    throw new Error(`Ajusta ttMatch para "${cfg.ttMatch}" en "${concert.name}".`);
  }
  return { concert, ticketType: ttMatches[0] };
}

async function processEvent(cfg: EventConfig) {
  const { concert, ticketType: tt } = await resolveTarget(cfg);

  const sold = (tt.orders || []).filter(
    (o) => o.status === "approved" || o.status === "pending",
  ).length;
  const available = tt.quantity - sold;

  console.log(`\n━━━ ${concert.name} ━━━`);
  console.log(`   concert=${concert.id}  slug=${concert.slug}`);
  console.log(
    `   ticketType="${tt.name}" (${tt.id})  precio=$${tt.price}  cupo=${tt.quantity}  vendidas/pend=${sold}  disponibles=${available}`,
  );

  // Números ya existentes (idempotencia) por email sintético.
  const already = new Set<number>();
  for (const o of tt.orders || []) {
    const m = (o.email || "").match(/^cortesia-.+-(\d+)@/);
    if (m) already.add(parseInt(m[1], 10));
  }
  const toCreate: number[] = [];
  for (let n = 1; n <= cfg.count; n++) if (!already.has(n)) toCreate.push(n);

  console.log(
    `   objetivo=${cfg.count}  ya existen=${already.size}  a crear=${toCreate.length}`,
  );

  if (available < toCreate.length) {
    throw new Error(
      `Cupo insuficiente en "${tt.name}": disponibles=${available}, a crear=${toCreate.length}. Sube el cupo del tipo.`,
    );
  }

  if (DRY_RUN) {
    console.log("   [DRY_RUN] no se escribe nada.");
    return;
  }

  // Snapshots de cortesía (espejo de /api/admin/create-order, sin fase activa).
  const effectivePrice = tt.price;
  const feePercentSnapshot = tt.feePercent ?? 0;
  const feeFixedSnapshot = tt.feeFixed ?? 0;
  const feeAmountSnapshot =
    (effectivePrice * feePercentSnapshot) / 100 + feeFixedSnapshot;
  const grossPerOrder = effectivePrice + feeAmountSnapshot;

  // ── Fase 1: crear las faltantes (con reintentos) ──
  for (const n of toCreate) {
    const num = pad(n);
    const label = `${LABEL_PREFIX} ${num}`;
    const orderId = genId();

    await withRetry(`crear ${label}`, () =>
      adminDb.transact(
        adminDb.tx.orders[orderId]
          .update({
            firstName: LABEL_PREFIX,
            lastName: num,
            email: syntheticEmail(concert.slug, n),
            cedula: "",
            paymentMethod: "Cortesia",
            paymentProofPath: "cortesia",
            status: "pending",
            visited: false,
            createdAt: Date.now(),
            priceSnapshot: effectivePrice,
            feePercentSnapshot,
            feeFixedSnapshot,
            feeAmountSnapshot,
            totalSnapshot: 0,
            discountAmount: grossPerOrder,
            platformFeePercentSnapshot: 0,
            platformFeeFixedSnapshot: 0,
            platformFeeAmountSnapshot: 0,
          })
          .link({ ticketType: tt.id }),
      ),
    );

    const res = await withRetry(`aprobar ${label}`, () =>
      approveOrderInternal(orderId, { skipEmail: true }),
    );
    if (!res.success) {
      throw new Error(`approveOrderInternal falló en ${label} (${orderId}): ${res.error}`);
    }

    await withRetry(`numerar ${label}`, () =>
      assignOrderNumber(adminDb, orderId, concert.id, concert.name),
    );

    if (n % 20 === 0 || n === toCreate[toCreate.length - 1])
      console.log(`   creadas hasta ${num} ...`);
    await sleep(30); // gentileza con la red / puertos efímeros
  }

  // ── Fase 2: exportar TODAS (1..count), re-consultando orderId/orderNumber ──
  const { orders: allCort } = await withRetry("query cortesías", () =>
    adminDb.query({
      orders: { $: { where: { email: { $like: `cortesia-${concert.slug}-%` } } } },
    }),
  );
  const byNum = new Map<number, { id: string; orderNumber?: string }>();
  for (const o of allCort as { id: string; email: string; orderNumber?: string }[]) {
    const m = o.email.match(/^cortesia-.+-(\d+)@/);
    if (m) byNum.set(parseInt(m[1], 10), { id: o.id, orderNumber: o.orderNumber });
  }

  const outDir = join(OUT_ROOT, concert.slug);
  const pngDir = join(outDir, "png");
  await mkdir(pngDir, { recursive: true });

  const manifest: string[] = ["numero,label,orderNumber,orderId,ticketUrl,qrFile"];
  const pdf = await PDFDocument.create();

  for (let n = 1; n <= cfg.count; n++) {
    const num = pad(n);
    const label = `${LABEL_PREFIX} ${num}`;
    const rec = byNum.get(n);
    if (!rec) throw new Error(`Falta la orden de ${label} tras crear; aborto export.`);

    const png = await buildLabeledQr(rec.id, label);
    const qrFile = `Cortesia-${num}.png`;
    await writeFile(join(pngDir, qrFile), png);

    const img = await pdf.embedPng(png);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    const ticketUrl = `${APP_URL}/ticket/${rec.id}`;
    manifest.push(
      `${num},${label},${rec.orderNumber || ""},${rec.id},${ticketUrl},png/${qrFile}`,
    );
    if (n % 20 === 0 || n === cfg.count) console.log(`   exportadas ${n}/${cfg.count}`);
  }

  const pdfBytes = await pdf.save();
  const pdfName = `${concert.slug}-cortesias.pdf`;
  await writeFile(join(outDir, pdfName), pdfBytes);
  await writeFile(join(outDir, "manifiesto.csv"), manifest.join("\n"), "utf8");
  console.log(`   ✓ ${outDir}`);
  console.log(`     - ${pdfName} (${cfg.count} páginas)`);
  console.log(`     - png/ (${cfg.count} imágenes)`);
  console.log(`     - manifiesto.csv`);
}

async function main() {
  console.log(DRY_RUN ? "== DRY RUN (no escribe) ==" : "== Generando cortesías ==");
  console.log(`app: ${process.env.NEXT_PUBLIC_INSTANT_APP_ID}`);
  for (const cfg of EVENTS) await processEvent(cfg);
  console.log("\nListo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
