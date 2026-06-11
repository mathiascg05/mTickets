import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Counter, Trend } from "k6/metrics";

// ── Custom metrics ──────────────────────────────────────────────────
const ordersCreated = new Counter("orders_created");
const ordersFailed = new Counter("orders_failed");
const queueRejected = new Counter("queue_rejected");
const reservationFailed = new Counter("reservation_failed");
const queueWaitTime = new Trend("queue_wait_time_ms");

// ── Config ──────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    full_flow: {
      executor: "shared-iterations",
      vus: 600,
      iterations: 600,
      maxDuration: "15m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.5"],
    orders_created: ["count>0"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;

const HEARTBEAT_INTERVAL_S = 3; // seconds between heartbeat polls
const MAX_WAIT_S = 600; // 10 min max wait in queue

export default function () {
  if (!TICKET_TYPE_ID) {
    fail("TICKET_TYPE_ID env var is required");
  }

  const sessionId = `k6-vu${__VU}-iter${__ITER}-${Date.now()}`;
  const headers = {
    "Content-Type": "application/json",
    // Origin debe coincidir con NEXT_PUBLIC_APP_URL o el middleware responde 403 (CSRF).
    Origin: BASE_URL,
    "X-Forwarded-For": `10.0.${Math.floor(__VU / 256)}.${__VU % 256}`,
  };

  // ── Step 1: Join queue ────────────────────────────────────────────
  const joinRes = http.post(
    `${BASE_URL}/api/join-queue`,
    JSON.stringify({
      ticketTypeId: TICKET_TYPE_ID,
      qty: 1,
      sessionId,
    }),
    { headers, tags: { step: "join-queue" } },
  );

  const joinOk = check(joinRes, {
    "join-queue: status 200": (r) => r.status === 200,
  });

  if (!joinOk) {
    queueRejected.add(1);
    console.log(
      `VU${__VU}: join-queue failed (${joinRes.status}): ${joinRes.body}`,
    );
    return;
  }

  const joinData = joinRes.json();
  const queueEntryId = joinData.queueEntryId;
  let status = joinData.status;

  // ── Step 2: Poll heartbeat until admitted ─────────────────────────
  const waitStart = Date.now();

  while (status === "waiting") {
    const elapsed = (Date.now() - waitStart) / 1000;
    if (elapsed > MAX_WAIT_S) {
      console.log(`VU${__VU}: timed out waiting in queue after ${elapsed}s`);
      queueRejected.add(1);
      return;
    }

    sleep(HEARTBEAT_INTERVAL_S + Math.random() * 2);

    const hbRes = http.post(
      `${BASE_URL}/api/queue-heartbeat`,
      JSON.stringify({ queueEntryId }),
      { headers, tags: { step: "heartbeat" } },
    );

    if (hbRes.status === 200) {
      const hbData = hbRes.json();
      status = hbData.status;
    } else {
      console.log(
        `VU${__VU}: heartbeat error (${hbRes.status}): ${hbRes.body}`,
      );
    }
  }

  const waitMs = Date.now() - waitStart;
  queueWaitTime.add(waitMs);

  if (status !== "admitted") {
    console.log(`VU${__VU}: unexpected queue status "${status}"`);
    queueRejected.add(1);
    return;
  }

  // ── Step 3: Create reservation ────────────────────────────────────
  const resRes = http.post(
    `${BASE_URL}/api/create-reservation`,
    JSON.stringify({
      ticketTypeId: TICKET_TYPE_ID,
      qty: 1,
      queueToken: queueEntryId,
    }),
    { headers, tags: { step: "create-reservation" } },
  );

  const resOk = check(resRes, {
    "create-reservation: status 200 or 409": (r) =>
      r.status === 200 || r.status === 409,
  });

  if (resRes.status !== 200) {
    reservationFailed.add(1);
    console.log(
      `VU${__VU}: reservation failed (${resRes.status}): ${resRes.body}`,
    );
    return;
  }

  const resData = resRes.json();
  const reservationId = resData.reservationId;

  // Stagger order creation to reduce contention on lastOrderSeq counter
  sleep(Math.random() * 3);

  // ── Step 4: Create order ──────────────────────────────────────────
  const orderRes = http.post(
    `${BASE_URL}/api/create-order`,
    JSON.stringify({
      ticketTypeId: TICKET_TYPE_ID,
      qty: 1,
      attendees: [
        {
          firstName: "Load",
          lastName: `Test${__VU}`,
          email: `loadtest-vu${__VU}@test.local`,
          cedula: `${10000000 + __VU}`,
          phone: "+584140000000",
        },
      ],
      paymentMethodName: "Load Test",
      reservationId,
      queueToken: queueEntryId,
    }),
    { headers, tags: { step: "create-order" } },
  );

  const orderOk = check(orderRes, {
    "create-order: status 200 or 409": (r) =>
      r.status === 200 || r.status === 409,
  });

  if (orderRes.status === 200) {
    ordersCreated.add(1);
  } else {
    ordersFailed.add(1);
    console.log(
      `VU${__VU}: order failed (${orderRes.status}): ${orderRes.body}`,
    );
  }
}
