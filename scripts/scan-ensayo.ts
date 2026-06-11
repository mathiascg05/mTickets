import "dotenv/config";
import { adminDb } from "../src/lib/adminDb";
import { assertSafeToMutate } from "./loadtest-config";

/**
 * Escenario S7 — lado ORGANIZADOR: aprobar pagos + entry rush (escaneo concurrente)
 * + guard anti-doble-escaneo. Solo lectura/escritura contra STAGING.
 *
 * Uso:
 *   BASE_URL=https://matickets-staging-r1.vercel.app DOTENV_CONFIG_PATH=.env.staging \
 *     LOADTEST_CONFIRM=1 N=200 CONC=60 npx tsx scripts/scan-ensayo.ts
 *
 * Guard anti-prod compartido (assertSafeToMutate): exige LOADTEST_CONFIRM=1 y
 * aborta si el appId destino es producción.
 */

const BASE_URL = process.env.BASE_URL;
const N = parseInt(process.env.N || "200", 10); // órdenes a aprobar + escanear
const CONC = parseInt(process.env.CONC || "60", 10); // escaneos concurrentes
const PIN = "4321";
const SLUG = "loadtest-evento-a";

function assertSafe() {
  assertSafeToMutate("scan-ensayo (aprueba órdenes + escaneo de prueba)");
  if (!BASE_URL) throw new Error("Define BASE_URL (URL de staging)");
}

async function pool<T>(items: T[], conc: number, fn: (t: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function main() {
  assertSafe();
  console.log(`🎟️  Ensayo organizador — BASE_URL=${BASE_URL} N=${N} CONC=${CONC}`);

  // 1) Resolver concierto A + órdenes
  const { concerts } = await adminDb.query({
    concerts: { $: { where: { slug: SLUG } }, ticketTypes: { orders: {} } },
  });
  const concert = concerts[0] as any;
  if (!concert) throw new Error(`No existe el concierto ${SLUG} (corre el seed)`);
  const tt = concert.ticketTypes?.[0];
  const allOrders = (tt?.orders || []) as { id: string; status: string }[];
  console.log(`   concierto=${concert.id} órdenes totales=${allOrders.length}`);

  // 2) Poner scannerPin
  await adminDb.transact(adminDb.tx.concerts[concert.id].update({ scannerPin: PIN }));
  console.log(`   scannerPin fijado.`);

  // 3) Aprobar hasta N órdenes pendientes (simula al organizador aprobando pagos)
  const toApprove = allOrders.filter((o) => o.status !== "approved").slice(0, N);
  const approveTxns = toApprove.map((o) =>
    adminDb.tx.orders[o.id].update({ status: "approved", visited: false }),
  );
  // batch en grupos de 200 para no exceder límites de transacción
  for (let i = 0; i < approveTxns.length; i += 200) {
    await adminDb.transact(approveTxns.slice(i, i + 200));
  }
  const approvedIds = toApprove.map((o) => o.id);
  console.log(`   aprobadas ${approvedIds.length} órdenes.`);
  if (!approvedIds.length) throw new Error("No hay órdenes para aprobar/escanear");

  // 4) Obtener scannerToken vía el endpoint real (prueba verify-scanner-pin)
  const pinRes = await fetch(`${BASE_URL}/api/verify-scanner-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL! },
    body: JSON.stringify({ concertId: concert.id, pin: PIN }),
  });
  if (!pinRes.ok) throw new Error(`verify-scanner-pin falló: ${pinRes.status} ${await pinRes.text()}`);
  const { token } = (await pinRes.json()) as { token: string };
  console.log(`   ✅ verify-scanner-pin OK, token obtenido.`);

  // 5) Entry rush: mark-visited concurrente
  const scan = async (orderId: string) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE_URL}/api/mark-visited`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE_URL! },
        body: JSON.stringify({ orderId, scannerToken: token }),
      });
      return { status: r.status, ms: Date.now() - t0 };
    } catch {
      return { status: 0, ms: Date.now() - t0 }; // 0 = timeout/red
    }
  };

  const tally = (results: { status: number; ms: number }[]) => {
    const by: Record<string, number> = {};
    let maxMs = 0, sumMs = 0;
    for (const r of results) {
      by[r.status] = (by[r.status] || 0) + 1;
      maxMs = Math.max(maxMs, r.ms);
      sumMs += r.ms;
    }
    return { by, avgMs: Math.round(sumMs / results.length), maxMs };
  };

  console.log(`\n── PASO 1: entry rush (${approvedIds.length} escaneos, ${CONC} concurrentes) ──`);
  const r1: { status: number; ms: number }[] = [];
  const t0 = Date.now();
  await pool(approvedIds, CONC, async (id) => { r1.push(await scan(id)); });
  const s1 = tally(r1);
  console.log(`   status: ${JSON.stringify(s1.by)} | avg=${s1.avgMs}ms max=${s1.maxMs}ms | total=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`   (esperado: 200=${approvedIds.length}, todos check-in exitoso)`);

  console.log(`\n── PASO 2: re-escaneo (guard anti-doble-escaneo) ──`);
  const r2: { status: number; ms: number }[] = [];
  await pool(approvedIds, CONC, async (id) => { r2.push(await scan(id)); });
  const s2 = tally(r2);
  console.log(`   status: ${JSON.stringify(s2.by)}`);
  console.log(`   (esperado: 409=${approvedIds.length}, ALREADY_SCANNED — ninguno re-admitido)`);

  // 6) Verificar en DB que visited=true y conteo correcto
  const { orders: scanned } = await adminDb.query({
    orders: { $: { where: { id: { in: approvedIds } } } },
  });
  const visitedCount = (scanned as any[]).filter((o) => o.visited === true).length;
  console.log(`\n   DB: ${visitedCount}/${approvedIds.length} órdenes con visited=true`);

  const ok200 = (s1.by["200"] || 0);
  const dup409 = (s2.by["409"] || 0);
  const verdict = ok200 === approvedIds.length && dup409 === approvedIds.length && visitedCount === approvedIds.length;
  console.log(`\n${verdict ? "✅" : "❌"} Veredicto: check-in ${ok200}/${approvedIds.length}, doble-escaneo bloqueado ${dup409}/${approvedIds.length}, visited ${visitedCount}/${approvedIds.length}`);

  // limpieza: quitar el PIN de prueba
  await adminDb.transact(adminDb.tx.concerts[concert.id].update({ scannerPin: null }));
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
