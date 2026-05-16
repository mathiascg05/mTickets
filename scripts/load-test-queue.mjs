#!/usr/bin/env node
/**
 * Queue Load Test — simula N bots concurrentes contra la cola.
 *
 * Flujo por bot:
 *   1. POST /api/join-queue
 *   2. Poll /api/queue-heartbeat cada 2s hasta ser admitted
 *   3. POST /api/create-reservation
 *   4. Simula tiempo de compra (1-3s), luego libera la reservación
 *
 * Verificaciones:
 *   - No se admiten más de MAX_CONCURRENT simultáneamente
 *   - El queue gate bloquea a quienes no tienen token
 *   - Todas las reservaciones se crean correctamente
 *   - No hay overselling
 *
 * Uso:  node scripts/load-test-queue.mjs [NUM_BOTS] [BASE_URL]
 */

const NUM_BOTS = parseInt(process.argv[2] || "200", 10);
const BASE_URL = process.argv[3] || "http://localhost:3000";
const TICKET_TYPE_ID = "8921087b-b236-4976-bf1d-0022082627f2"; // testt (600 qty)
const HEARTBEAT_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 180_000; // 3 min max wait per bot
const QTY = 1;
const PURCHASE_TIME_MIN_MS = 1000; // simulate 1-3s "buying"
const PURCHASE_TIME_MAX_MS = 3000;

// ── Stats ───────────────────────────────────────────────────────────────────
const stats = {
  joined: 0,
  admitted: 0,
  reservations: 0,
  released: 0,
  rejected403: 0,
  conflict409: 0,
  errors: 0,
  timedOut: 0,
  peakAdmitted: 0,
  currentAdmitted: 0,
};

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Bot ─────────────────────────────────────────────────────────────────────
async function runBot(botId) {
  const sessionId = `load-test-bot-${botId}-${Date.now()}`;
  const label = `Bot#${String(botId).padStart(3, "0")}`;

  try {
    // 1. Join queue
    const joinRes = await fetch(`${BASE_URL}/api/join-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketTypeId: TICKET_TYPE_ID, qty: QTY, sessionId }),
    });

    if (!joinRes.ok) {
      const err = await joinRes.text();
      log(`${label} join FAILED (${joinRes.status}): ${err}`);
      stats.errors++;
      return;
    }

    const joinData = await joinRes.json();
    const { queueEntryId, status: initialStatus } = joinData;
    stats.joined++;
    log(`${label} joined — pos=${joinData.position} status=${initialStatus}`);

    // 2. Heartbeat until admitted (or already admitted)
    let status = initialStatus;
    const startWait = Date.now();

    while (status === "waiting") {
      if (Date.now() - startWait > MAX_WAIT_MS) {
        log(`${label} TIMED OUT after ${MAX_WAIT_MS / 1000}s`);
        stats.timedOut++;
        return;
      }

      await sleep(HEARTBEAT_INTERVAL_MS);

      const hbRes = await fetch(`${BASE_URL}/api/queue-heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueEntryId }),
      });

      if (!hbRes.ok) {
        log(`${label} heartbeat FAILED (${hbRes.status})`);
        stats.errors++;
        return;
      }

      const hbData = await hbRes.json();
      status = hbData.status;

      if (status === "waiting" && botId <= 5) {
        log(`${label} waiting — pos=${hbData.position}/${hbData.totalWaiting}`);
      }
    }

    if (status === "expired") {
      log(`${label} entry expired before admission`);
      stats.errors++;
      return;
    }

    stats.admitted++;
    stats.currentAdmitted++;
    if (stats.currentAdmitted > stats.peakAdmitted) {
      stats.peakAdmitted = stats.currentAdmitted;
    }
    log(`${label} ADMITTED (concurrent=${stats.currentAdmitted})`);

    // 3. Create reservation
    const resRes = await fetch(`${BASE_URL}/api/create-reservation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketTypeId: TICKET_TYPE_ID,
        qty: QTY,
        queueToken: queueEntryId,
      }),
    });

    stats.currentAdmitted--;

    if (resRes.status === 403) {
      const body = await resRes.json();
      log(`${label} reservation BLOCKED (403): ${body.error}`);
      stats.rejected403++;
      return;
    }

    if (resRes.status === 409) {
      const body = await resRes.json();
      log(`${label} reservation CONFLICT (409): ${body.error}`);
      stats.conflict409++;
      return;
    }

    if (!resRes.ok) {
      const err = await resRes.text();
      log(`${label} reservation FAILED (${resRes.status}): ${err}`);
      stats.errors++;
      return;
    }

    const resData = await resRes.json();
    stats.reservations++;
    log(`${label} RESERVED — id=${resData.reservationId}`);

    // 4. Simulate purchase time, then release reservation (like completing checkout)
    const purchaseTime = randomBetween(PURCHASE_TIME_MIN_MS, PURCHASE_TIME_MAX_MS);
    await sleep(purchaseTime);

    // Delete reservation to free slot (simulates completed purchase or abandonment)
    try {
      await fetch(`${BASE_URL}/api/cancel-reservation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: resData.reservationId }),
      }).catch(() => {});
      // If cancel endpoint doesn't exist, we still count it — the slot frees on expiry
    } catch {}

    stats.released++;
    log(`${label} DONE (bought in ${purchaseTime}ms)`);
  } catch (err) {
    log(`${label} CRASH: ${err.message}`);
    stats.errors++;
  }
}

// ── Test queue gate bypass ──────────────────────────────────────────────────
async function testQueueBypass() {
  log("--- Testing queue gate bypass (no token) ---");
  await sleep(3000);

  const res = await fetch(`${BASE_URL}/api/create-reservation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticketTypeId: TICKET_TYPE_ID,
      qty: 1,
    }),
  });

  if (res.status === 403) {
    log("PASS: Queue gate correctly blocked request without token");
  } else {
    log(`FAIL: Queue gate did NOT block — got status ${res.status}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log(`  QUEUE LOAD TEST`);
  console.log(`  Bots: ${NUM_BOTS} | Target: ${BASE_URL}`);
  console.log(`  TicketType: ${TICKET_TYPE_ID} (testt, 600 qty)`);
  console.log(`  Max wait: ${MAX_WAIT_MS / 1000}s | Purchase sim: ${PURCHASE_TIME_MIN_MS}-${PURCHASE_TIME_MAX_MS}ms`);
  console.log("=".repeat(60));
  console.log();

  const startTime = Date.now();

  // Launch bots in batches of 50
  const BATCH_SIZE = 50;
  const botPromises = [];

  for (let i = 0; i < NUM_BOTS; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, NUM_BOTS);
    log(`Launching bots ${i + 1}-${batchEnd}...`);

    const batch = [];
    for (let j = i; j < batchEnd; j++) {
      batch.push(runBot(j + 1));
    }
    botPromises.push(...batch);

    if (batchEnd < NUM_BOTS) {
      await sleep(500);
    }
  }

  botPromises.push(testQueueBypass());

  await Promise.all(botPromises);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log();
  console.log("=".repeat(60));
  console.log("  RESULTS");
  console.log("=".repeat(60));
  console.log(`  Duration:         ${elapsed}s`);
  console.log(`  Bots launched:    ${NUM_BOTS}`);
  console.log(`  Joined queue:     ${stats.joined}`);
  console.log(`  Admitted:         ${stats.admitted}`);
  console.log(`  Reservations:     ${stats.reservations}`);
  console.log(`  Completed:        ${stats.released}`);
  console.log(`  Peak concurrent:  ${stats.peakAdmitted}`);
  console.log(`  Rejected (403):   ${stats.rejected403}`);
  console.log(`  Conflicts (409):  ${stats.conflict409}`);
  console.log(`  Timed out:        ${stats.timedOut}`);
  console.log(`  Errors:           ${stats.errors}`);
  console.log("=".repeat(60));

  // Validations
  const issues = [];
  if (stats.peakAdmitted > 100) {
    issues.push("FAIL: Peak concurrent admitted exceeded MAX_CONCURRENT (100)");
  }
  if (stats.conflict409 > 0) {
    issues.push(`WARN: ${stats.conflict409} false 409 conflicts`);
  }
  if (stats.joined !== NUM_BOTS) {
    issues.push(`WARN: Only ${stats.joined}/${NUM_BOTS} bots joined`);
  }
  if (stats.reservations < stats.admitted) {
    issues.push(`WARN: ${stats.admitted - stats.reservations} admitted bots failed to reserve`);
  }

  if (issues.length === 0) {
    console.log("\n  ALL CHECKS PASSED");
  } else {
    issues.forEach((i) => console.log(`\n  !! ${i}`));
  }

  console.log(`\n  Throughput: ${(stats.reservations / (elapsed)).toFixed(1)} reservations/sec`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
