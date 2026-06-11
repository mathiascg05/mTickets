import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Counter, Trend } from "k6/metrics";

// ── Escenario S3/S4: DOS eventos vendiendo a la vez ──────────────────
// Cada evento corre el flujo completo (cola → heartbeat → reserva → orden)
// contra su propio TICKET_TYPE_ID. Mide degradación cruzada (mismo backend
// InstantDB + mismo pool de email + mismas instancias Vercel).
//
// Uso S3 (carga fija, ~500 VU por evento = 1.000 concurrentes):
//   BASE_URL=<preview> TICKET_TYPE_ID_A=<idA> TICKET_TYPE_ID_B=<idB> \
//     k6 run load-tests/dual-event.js
//
// Uso S4 (rampa hasta el punto de quiebre):
//   ... MODE=ramp k6 run load-tests/dual-event.js
//
// Variables: VUS_A, VUS_B (default 500), ITERS_A, ITERS_B (default = VUS).

const ordersCreated = new Counter("orders_created");
const ordersFailed = new Counter("orders_failed");
const queueRejected = new Counter("queue_rejected");
const reservationFailed = new Counter("reservation_failed");
const queueWaitTime = new Trend("queue_wait_time_ms");
const pageLoad = new Trend("page_load_ms");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TT_A = __ENV.TICKET_TYPE_ID_A;
const TT_B = __ENV.TICKET_TYPE_ID_B;
const MODE = __ENV.MODE || "fixed";

const VUS_A = parseInt(__ENV.VUS_A || "500", 10);
const VUS_B = parseInt(__ENV.VUS_B || "500", 10);
const ITERS_A = parseInt(__ENV.ITERS_A || String(VUS_A), 10);
const ITERS_B = parseInt(__ENV.ITERS_B || String(VUS_B), 10);

const HEARTBEAT_INTERVAL_S = 3;
const MAX_WAIT_S = 600;

function fixedScenario(exec, vus, iters, startTime) {
  return {
    executor: "shared-iterations",
    vus,
    iterations: iters,
    maxDuration: "15m",
    exec,
    startTime,
  };
}

// Rampa común para descubrir el punto de quiebre (S4).
const RAMP_STAGES = [
  { duration: "1m", target: 250 },
  { duration: "2m", target: 750 },
  { duration: "2m", target: 1500 },
  { duration: "2m", target: 1500 },
];
function rampScenario(exec) {
  return {
    executor: "ramping-vus",
    startVUs: 0,
    stages: RAMP_STAGES,
    exec,
    gracefulRampDown: "30s",
  };
}

export const options =
  MODE === "ramp"
    ? {
        scenarios: { eventA: rampScenario("eventA"), eventB: rampScenario("eventB") },
        thresholds: {
          orders_created: ["count>0"],
          "http_req_failed{kind:server}": ["rate<0.01"], // 0% de 5xx idealmente
        },
      }
    : {
        scenarios: {
          // startTime 0 en ambos → arrancan al mismo tiempo (pico simultáneo).
          eventA: fixedScenario("eventA", VUS_A, ITERS_A, "0s"),
          eventB: fixedScenario("eventB", VUS_B, ITERS_B, "0s"),
        },
        thresholds: {
          http_req_failed: ["rate<0.5"],
          orders_created: ["count>0"],
          "http_req_duration{step:create-order}": ["p(95)<3000"],
        },
      };

function headers(ev) {
  return {
    "Content-Type": "application/json",
    // Origin debe coincidir con NEXT_PUBLIC_APP_URL o el middleware responde 403 (CSRF).
    Origin: BASE_URL,
    // IPs sintéticas distintas por evento+VU para repartir el rate-limit por IP.
    "X-Forwarded-For": `10.${ev === "A" ? 1 : 2}.${Math.floor(__VU / 256)}.${__VU % 256}`,
  };
}

function runFlow(ev, ticketTypeId) {
  if (!ticketTypeId) fail(`TICKET_TYPE_ID_${ev} env var is required`);

  const h = headers(ev);
  const t = { event: ev };
  const sessionId = `k6-${ev}-vu${__VU}-iter${__ITER}-${Date.now()}`;

  // ── Paso 0: cargar la página del evento (R9) ──
  const eventPage = http.get(`${BASE_URL}/es/events`, { headers: h, tags: { ...t, step: "page-events" } });
  pageLoad.add(eventPage.timings.duration);

  // ── Paso 1: join queue ──
  const joinRes = http.post(
    `${BASE_URL}/api/join-queue`,
    JSON.stringify({ ticketTypeId, qty: 1, sessionId }),
    { headers: h, tags: { ...t, step: "join-queue" } },
  );
  if (!check(joinRes, { "join-queue 200": (r) => r.status === 200 })) {
    queueRejected.add(1, t);
    return;
  }
  let { queueEntryId, status } = joinRes.json();

  // ── Paso 2: heartbeat hasta admisión ──
  const waitStart = Date.now();
  while (status === "waiting") {
    if ((Date.now() - waitStart) / 1000 > MAX_WAIT_S) {
      queueRejected.add(1, t);
      return;
    }
    sleep(HEARTBEAT_INTERVAL_S + Math.random() * 2);
    const hb = http.post(
      `${BASE_URL}/api/queue-heartbeat`,
      JSON.stringify({ queueEntryId }),
      { headers: h, tags: { ...t, step: "heartbeat" } },
    );
    if (hb.status === 200) status = hb.json().status;
  }
  queueWaitTime.add(Date.now() - waitStart, t);
  if (status !== "admitted") {
    queueRejected.add(1, t);
    return;
  }

  // ── Paso 3: reserva ──
  const resRes = http.post(
    `${BASE_URL}/api/create-reservation`,
    JSON.stringify({ ticketTypeId, qty: 1, queueToken: queueEntryId }),
    { headers: h, tags: { ...t, step: "create-reservation" } },
  );
  check(resRes, { "reservation 200/409": (r) => r.status === 200 || r.status === 409 });
  if (resRes.status !== 200) {
    reservationFailed.add(1, t);
    return;
  }
  const reservationId = resRes.json().reservationId;

  // Escalonar para reducir contención en lastOrderSeq.
  sleep(Math.random() * 3);

  // ── Paso 4: orden ──
  const orderRes = http.post(
    `${BASE_URL}/api/create-order`,
    JSON.stringify({
      ticketTypeId,
      qty: 1,
      attendees: [
        {
          firstName: "Load",
          lastName: `${ev}${__VU}`,
          email: `loadtest-${ev}-vu${__VU}-${__ITER}@test.local`,
          cedula: `${(ev === "A" ? 20000000 : 30000000) + __VU * 100 + (__ITER % 100)}`,
          phone: "+584140000000",
        },
      ],
      paymentMethodName: "Load Test",
      reservationId,
      queueToken: queueEntryId,
    }),
    { headers: h, tags: { ...t, step: "create-order" } },
  );
  check(orderRes, { "order 200/409": (r) => r.status === 200 || r.status === 409 });
  if (orderRes.status === 200) {
    ordersCreated.add(1, t);
  } else {
    ordersFailed.add(1, t);
    if (orderRes.status >= 500) {
      console.log(`[${ev}] VU${__VU} order ${orderRes.status}: ${orderRes.body}`);
    }
  }
}

export function eventA() {
  runFlow("A", TT_A);
}
export function eventB() {
  runFlow("B", TT_B);
}
