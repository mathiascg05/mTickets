import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "../src/lib/adminDb";
import {
  LOADTEST,
  assertSafeToMutate,
  couponCodeFor,
  findLoadtestConcerts,
  stockFor,
  withPhases,
  phasesForStock,
} from "./loadtest-config";

/**
 * Siembra DOS conciertos de prueba ("Evento A" / "Evento B"), cada uno con:
 *  - status "active" (vendible)
 *  - un ticketType "General" con stock configurable (STOCK_A / STOCK_B)
 *  - un método de pago "Load Test" (sin comprobante obligatorio)
 *  - un cupón LOADTEST5 (maxUses=5) para el escenario de carrera de cupón
 *  - un platformFeeConfig prepaid con allowOverdraft (no bloquea aprobaciones)
 *
 * Idempotente por slug: reusa los IDs de conciertos/ticketTypes existentes y
 * limpia sus datos transaccionales, para que los TICKET_TYPE_ID que pasas a k6
 * se mantengan estables entre re-siembras.
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 \
 *     STOCK_A=1000 STOCK_B=1000 npx tsx scripts/seed-loadtest.ts
 */
async function seed() {
  assertSafeToMutate("seed-loadtest (crea/limpia conciertos de prueba)");

  const existing = await findLoadtestConcerts();
  const bySlug = new Map(existing.map((c) => [c.slug, c]));

  const usePhases = withPhases();
  const txns = [];
  const summary: { key: string; name: string; ticketTypeId: string; slug: string; stock: number; phases: string }[] = [];

  for (const ev of LOADTEST.events) {
    const prior = bySlug.get(ev.slug);
    const concertId = prior?.id ?? genId();
    const stock = stockFor(ev);

    // ── Limpiar datos transaccionales previos (mantener IDs estables) ──
    for (const tt of prior?.ticketTypes ?? []) {
      for (const o of tt.orders ?? []) txns.push(adminDb.tx.orders[o.id].delete());
      for (const r of tt.reservations ?? []) txns.push(adminDb.tx.reservations[r.id].delete());
      for (const q of tt.queueEntries ?? []) txns.push(adminDb.tx.queueEntries[q.id].delete());
      // Borrar fases previas: el modo (con/sin fases) se decide en cada seed.
      for (const p of (tt as { phases?: { id: string }[] }).phases ?? [])
        txns.push(adminDb.tx.ticketPhases[p.id].delete());
    }

    // ── Concierto ──
    txns.push(
      adminDb.tx.concerts[concertId].update({
        name: ev.name,
        slug: ev.slug,
        date: "2099-12-31",
        venue: "Load Test Arena",
        status: "active",
        organizerEmail: LOADTEST.organizerEmail,
        orderNumberPrefix: ev.orderNumberPrefix,
        lastOrderSeq: 0,
        defaultLanguage: "es",
        feeMode: "ticketType",
        isDemo: true,
        createdAt: Date.now(),
      }),
    );

    // ── Ticket type (reusa id si existe) ──
    const priorTT = prior?.ticketTypes?.[0];
    const ticketTypeId = priorTT?.id ?? genId();
    txns.push(
      adminDb.tx.ticketTypes[ticketTypeId]
        .update({
          name: LOADTEST.ticketTypeName,
          price: 10,
          quantity: stock,
          feePercent: 0,
          feeFixed: 0,
          lastQueuePosition: 0,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );

    // ── Fases (opcional, WITH_PHASES=1): tramos de precio que suman el stock ──
    let phasesDesc = "—";
    if (usePhases) {
      const phases = phasesForStock(stock);
      phasesDesc = phases.map((p) => `${p.name}:${p.quantity}@$${p.price}`).join(" / ");
      for (const ph of phases) {
        txns.push(
          adminDb.tx.ticketPhases[genId()]
            .update({
              name: ph.name,
              price: ph.price,
              quantity: ph.quantity,
              sortOrder: ph.sortOrder,
              createdAt: Date.now(),
            })
            .link({ ticketType: ticketTypeId }),
        );
      }
    }

    // ── Método de pago ──
    const priorPM = prior?.paymentMethods?.find((p) => p.name === LOADTEST.paymentMethodName);
    const pmId = priorPM?.id ?? genId();
    txns.push(
      adminDb.tx.paymentMethods[pmId]
        .update({
          type: "custom",
          name: LOADTEST.paymentMethodName,
          instructions: "Método de prueba de carga",
          requireScreenshot: false,
          requireReferenceNumber: false,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );

    // ── Cupón por evento (código único global, maxUses) ──
    const couponCode = couponCodeFor(ev.key);
    const priorCoupon = prior?.coupons?.find((c) => c.code === couponCode);
    const couponId = priorCoupon?.id ?? genId();
    txns.push(
      adminDb.tx.coupons[couponId]
        .update({
          code: couponCode,
          discountType: "fixed",
          discountValue: LOADTEST.coupon.discountValue,
          maxUses: LOADTEST.coupon.maxUses,
          active: true,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );

    // ── Platform fee config (prepaid + overdraft, no bloquea) ──
    const rawPFC = prior?.platformFeeConfig;
    const priorPFC = Array.isArray(rawPFC) ? rawPFC[0] : rawPFC;
    const pfcId = priorPFC?.id ?? genId();
    txns.push(
      adminDb.tx.platformFeeConfigs[pfcId]
        .update({
          feePercent: 0,
          feeFixed: 0,
          billingMode: "prepaid",
          allowOverdraft: true,
          updatedAt: Date.now(),
        })
        .link({ concert: concertId }),
    );

    summary.push({ key: ev.key, name: ev.name, ticketTypeId, slug: ev.slug, stock, phases: phasesDesc });
  }

  await adminDb.transact(txns);

  // Persistir IDs para el runner (load-tests/run-loadtest-suite.sh)
  const idsPath = resolve(process.cwd(), "load-tests/.loadtest-ids.json");
  const idsOut = {
    A: summary[0]?.ticketTypeId,
    B: summary[1]?.ticketTypeId,
    coupon: couponCodeFor("A"),
    seededAt: new Date().toISOString(),
  };
  writeFileSync(idsPath, JSON.stringify(idsOut, null, 2));

  console.log("\n✅ Seed completado.\n");
  console.table(summary);
  console.log(`IDs guardados en ${idsPath}`);

  const [a, b] = summary;
  console.log("\n── Comandos k6 listos para copiar ──");
  console.log(`BASE_URL=<preview-url> TICKET_TYPE_ID=${a.ticketTypeId} k6 run load-tests/buy-flow.js`);
  console.log(`BASE_URL=<preview-url> TICKET_TYPE_ID=${a.ticketTypeId} k6 run load-tests/full-flow.js`);
  console.log(
    `BASE_URL=<preview-url> TICKET_TYPE_ID_A=${a.ticketTypeId} TICKET_TYPE_ID_B=${b.ticketTypeId} k6 run load-tests/dual-event.js`,
  );
  console.log("");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ seed-loadtest falló:", err);
    process.exit(1);
  });
