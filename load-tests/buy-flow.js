import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const successCount = new Counter("successful_orders");
const failCount = new Counter("failed_orders");

export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: 600,
      iterations: 600,
      maxDuration: "60s",
    },
  },
  thresholds: {
    successful_orders: ["count<=100"],
    http_req_failed: ["rate<0.99"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;

export default function () {
  if (!TICKET_TYPE_ID) {
    console.error("TICKET_TYPE_ID env var is required");
    return;
  }

  const payload = JSON.stringify({
    ticketTypeId: TICKET_TYPE_ID,
    qty: 1,
    attendees: [
      {
        firstName: `User`,
        lastName: `VU${__VU}`,
        email: `vu${__VU}@loadtest.local`,
        cedula: `${10000000 + __VU}`,
      },
    ],
    paymentMethodName: "Load Test",
  });

  const res = http.post(`${BASE_URL}/api/create-order`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const success = check(res, {
    "status is 200 or 409": (r) => r.status === 200 || r.status === 409,
  });

  if (res.status === 200) {
    successCount.add(1);
  } else {
    failCount.add(1);
  }

  sleep(0.1);
}
