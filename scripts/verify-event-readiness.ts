import "dotenv/config";
import { adminDb } from "../src/lib/adminDb";

/**
 * Verificación de SOLO LECTURA de readiness pre-venta para un evento.
 * No muta nada. Uso:
 *   EVENT_MATCH="memor" npx tsx scripts/verify-event-readiness.ts
 * (carga .env = PRODUCCIÓN por defecto)
 */
const MATCH = (process.env.EVENT_MATCH ?? "memor").toLowerCase();
const now = Date.now();

function appIdInfo() {
  const id = process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "(sin definir)";
  const env = id.startsWith("66280f75") ? "PRODUCCIÓN" : "no-prod";
  return `${env} (app ${id.slice(0, 8)}…)`;
}

async function main() {
  console.log(`\n🎯 Target: ${appIdInfo()} — filtro nombre ~ "${MATCH}"\n`);

  const { concerts } = await adminDb.query({
    concerts: {
      ticketTypes: {
        phases: {},
        reservations: {},
        queueEntries: {},
        orders: {},
      },
      paymentMethods: {},
      broadcasts: {},
    },
  });

  const matches = concerts.filter((c: any) =>
    (c.name ?? "").toLowerCase().includes(MATCH),
  );

  if (matches.length === 0) {
    console.log("❌ Ningún evento coincide. Eventos existentes (nombre · status):");
    for (const c of concerts) console.log(`   - ${c.name} · ${c.status}`);
    return;
  }

  for (const c of matches) {
    console.log("═".repeat(72));
    console.log(`📌 EVENTO: ${c.name}`);
    console.log(`   slug:            ${c.slug}`);
    console.log(`   status:          ${c.status}  ${c.status === "active" ? "✅ vendible" : "⛔ NO vendible"}`);
    console.log(`   fecha:           ${c.date}`);
    console.log(`   organizador:     ${c.organizerEmail}`);
    console.log(`   prefijo orden#:  ${c.orderNumberPrefix ?? "(ninguno)"}`);
    console.log(`   finalizedAt:     ${c.finalizedAt ? new Date(c.finalizedAt).toISOString() : "no finalizado ✅"}`);

    // Métodos de pago
    const pms = c.paymentMethods ?? [];
    console.log(`\n   💳 Métodos de pago (${pms.length}):`);
    for (const pm of pms) console.log(`      - ${pm.type} · ${pm.name}`);
    if (pms.length === 0) console.log("      ⛔ SIN MÉTODOS DE PAGO — no se puede cobrar");

    // Tipos de entrada
    const tts = c.ticketTypes ?? [];
    console.log(`\n   🎟️  Tipos de entrada (${tts.length}):`);
    for (const tt of tts) {
      const orders = tt.orders ?? [];
      const sold = orders.filter(
        (o: any) => o.status === "approved" || o.status === "pending",
      ).length;
      const activeRes = (tt.reservations ?? []).filter(
        (r: any) => r.expiresAt > now,
      );
      const reserved = activeRes.reduce((s: number, r: any) => s + (r.quantity ?? 1), 0);
      const phases = (tt.phases ?? []).sort(
        (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );

      const qEntries = tt.queueEntries ?? [];
      const liveQ = qEntries.filter(
        (q: any) => (q.status === "waiting" || q.status === "admitted") && q.expiresAt > now,
      );

      console.log(`\n      • ${tt.name}  (vis: ${tt.visibility ?? "public"})`);
      if (phases.length > 0) {
        const cap = phases.reduce((s: number, p: any) => s + p.quantity, 0);
        console.log(`        precio:   por fase`);
        console.log(`        cupo:     ${cap} (suma de ${phases.length} fases)`);
        for (const p of phases) {
          const pSold = orders.filter(
            (o: any) => (o.status === "approved" || o.status === "pending") && o.phaseId === p.id,
          ).length;
          console.log(`          - fase "${p.name}": $${p.price} · cupo ${p.quantity} · vendidas ${pSold} · termina ${p.endDate ?? "—"}`);
        }
      } else {
        console.log(`        precio:   $${tt.price}`);
        console.log(`        cupo:     ${tt.quantity}`);
      }
      const totalCap = phases.length > 0
        ? phases.reduce((s: number, p: any) => s + p.quantity, 0)
        : tt.quantity;
      const available = totalCap - sold - reserved;
      console.log(`        vendidas: ${sold}   reservas vivas: ${reserved}   → DISPONIBLE: ${available}`);
      console.log(`        cola:     lastQueuePosition=${tt.lastQueuePosition ?? 0} · entries vivos=${liveQ.length} (waiting+admitted) · total entries=${qEntries.length}`);
    }

    // Broadcasts no completados (riesgo de envío en pico)
    const bcs = (c.broadcasts ?? []).filter((b: any) => b.status !== "completed");
    console.log(`\n   📣 Broadcasts NO completados (riesgo en pico): ${bcs.length}`);
    for (const b of bcs) {
      console.log(`      ⚠️  "${b.subject}" · status=${b.status} · processingState=${b.processingState ?? "—"} · destinatarios=${b.recipientCount}`);
    }
    if (bcs.length === 0) console.log("      ✅ ninguno pendiente");
  }
  console.log("═".repeat(72));
  console.log("\n(solo lectura — no se modificó nada)\n");
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
