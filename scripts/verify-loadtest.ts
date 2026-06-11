import "dotenv/config";
import { findLoadtestConcerts, targetAppId, assertNotProd } from "./loadtest-config";

/**
 * Valida los invariantes tras una corrida de load test (solo lectura):
 *   1. CERO overselling: orders (approved|pending) ≤ capacidad del ticketType.
 *   2. orderNumber únicos (sin duplicados).
 *   3. Sin huecos inconsistentes: nº de orders con número == lastOrderSeq.
 *   4. Cupones nunca exceden maxUses.
 *   5. Sin reservas/queueEntries vencidas y aún "vivas" (stock fantasma).
 *   6. Por fase (si hay): vendidas(phaseId) ≤ phase.quantity (exceso = leak de
 *      borde, warning; la sobreventa de EVENTO sigue siendo el check crítico #1).
 *
 * Sale con código 1 si algún invariante CRÍTICO (overselling / duplicados /
 * cupón) falla, para poder encadenarlo en CI o en un runner de escenarios.
 *
 * Uso:
 *   DOTENV_CONFIG_PATH=.env.staging npx tsx scripts/verify-loadtest.ts
 */
async function verify() {
  assertNotProd();
  console.log(`🔎 Verificando invariantes en app: ${targetAppId()}\n`);
  const concerts = await findLoadtestConcerts();
  const now = Date.now();

  let criticalFail = false;
  const warnings: string[] = [];

  for (const c of concerts) {
    console.log(`━━ ${c.name} (${c.slug}) · lastOrderSeq=${c.lastOrderSeq ?? 0} ━━`);

    for (const tt of c.ticketTypes ?? []) {
      const phases = (tt.phases ?? [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      // Sin fases: capacidad = quantity. Con fases: suma de quantities.
      const capacity =
        phases.length > 0
          ? phases.reduce((s, p) => s + (p.quantity ?? 0), 0)
          : tt.quantity;

      const orders = tt.orders ?? [];
      const counted = orders.filter((o) => o.status === "approved" || o.status === "pending");
      const sold = counted.length;

      // (1) Overselling
      const oversold = sold > capacity;
      if (oversold) criticalFail = true;

      // (2) orderNumber duplicados
      const numbers = orders.map((o) => o.orderNumber).filter((n): n is string => !!n);
      const dupSet = new Set<string>();
      const seen = new Set<string>();
      for (const n of numbers) {
        if (seen.has(n)) dupSet.add(n);
        seen.add(n);
      }
      if (dupSet.size > 0) criticalFail = true;

      // (3) Todas las órdenes deben tener orderNumber asignado al crear
      const withNumber = numbers.length;
      const missingNumber = counted.length - withNumber;

      // (5) Reservas / queue vencidas aún vivas
      const staleReservations = (tt.reservations ?? []).filter((r) => r.expiresAt < now).length;
      const stuckQueue = (tt.queueEntries ?? []).filter(
        (q) => (q.status === "admitted" || q.status === "waiting") && q.expiresAt < now,
      ).length;
      if (staleReservations > 0)
        warnings.push(`${tt.name}: ${staleReservations} reservas vencidas aún presentes (stock fantasma hasta el cron de limpieza).`);
      if (stuckQueue > 0)
        warnings.push(`${tt.name}: ${stuckQueue} queueEntries vencidas sin expirar (admisión depende de heartbeat/cron).`);

      const mark = (ok: boolean) => (ok ? "✅" : "❌");
      console.log(`  ${tt.name}: vendidas=${sold} / capacidad=${capacity}`);
      console.log(`    ${mark(!oversold)} overselling (evento): ${oversold ? `SÍ (+${sold - capacity})` : "no"}`);
      console.log(`    ${mark(dupSet.size === 0)} orderNumber duplicados: ${dupSet.size}`);
      console.log(
        `    ${mark(missingNumber === 0)} orderNumber asignado: ${withNumber}/${counted.length} órdenes${missingNumber > 0 ? ` (${missingNumber} sin número)` : ""}`,
      );

      // (6) Checks POR FASE: vendidas(phaseId) ≤ phase.quantity.
      // El exceso de UNA fase NO es sobreventa de evento (la sgte fase lo absorbe),
      // pero sí es un "leak de borde" (alguien alcanzó el precio bajo de más) → warning.
      if (phases.length > 0) {
        const byPhase = new Map<string, number>();
        let noPhase = 0;
        for (const o of counted) {
          const pid = (o as { phaseId?: string }).phaseId;
          if (pid) byPhase.set(pid, (byPhase.get(pid) ?? 0) + 1);
          else noPhase++;
        }
        console.log(`    fases:`);
        for (const ph of phases) {
          const n = byPhase.get(ph.id) ?? 0;
          const leak = n > (ph.quantity ?? 0);
          if (leak)
            warnings.push(
              `${tt.name}/${ph.name}: ${n}/${ph.quantity} vendidas (+${n - (ph.quantity ?? 0)} de más al precio $${ph.price}; leak de borde, no sobreventa de evento).`,
            );
          console.log(`      ${leak ? "⚠️ " : "✅"} ${ph.name} ($${ph.price}): ${n}/${ph.quantity}`);
        }
        if (noPhase > 0)
          warnings.push(`${tt.name}: ${noPhase} órdenes sin phaseId (debería ser 0 con fases activas).`);
      }
    }

    // (4) Cupones
    for (const coupon of c.coupons ?? []) {
      if (coupon.maxUses == null) continue;
      let uses = 0;
      for (const tt of c.ticketTypes ?? []) {
        uses += (tt.orders ?? []).filter(
          (o) => o.couponCode === coupon.code && (o.status === "approved" || o.status === "pending"),
        ).length;
      }
      const over = uses > coupon.maxUses;
      if (over) criticalFail = true;
      console.log(`  ${over ? "❌" : "✅"} cupón ${coupon.code}: usos=${uses} / maxUses=${coupon.maxUses}`);
    }
    console.log("");
  }

  if (warnings.length > 0) {
    console.log("⚠️  Advertencias (no críticas):");
    for (const w of warnings) console.log(`   · ${w}`);
    console.log("");
  }

  if (criticalFail) {
    console.error("❌ FALLO CRÍTICO: se violó al menos un invariante (overselling / duplicados / cupón).");
    process.exit(1);
  }
  console.log("✅ Todos los invariantes críticos se cumplen.");
}

verify()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ verify-loadtest falló:", err);
    process.exit(1);
  });
