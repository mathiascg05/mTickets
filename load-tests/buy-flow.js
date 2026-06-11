import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const successCount = new Counter("successful_orders");
const failCount = new Counter("failed_orders");

// VUs / iteraciones / duración configurables por env (para ajustar a la
// capacidad del entorno: local de proceso único satura ~100-150 conexiones).
const VUS = parseInt(__ENV.VUS || "600", 10);
const ITERS = parseInt(__ENV.ITERS || String(VUS), 10);
const DURATION = __ENV.DURATION || "60s";

export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: ITERS,
      maxDuration: DURATION,
    },
  },
  // Sin thresholds que aborten: el objetivo es medir y verificar invariantes
  // en DB, no que k6 "pase". El overselling se valida con verify-loadtest.
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;
// S5 (carrera de cupón): si se define COUPON_CODE, todas las VUs lo envían.
// Solo `maxUses` órdenes deben aplicarlo; el resto recibe 400 COUPON_LIMIT_REACHED.
// La verificación final del tope la hace scripts/verify-loadtest.ts.
const COUPON_CODE = __ENV.COUPON_CODE;

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
        phone: "+584140000000",
      },
    ],
    paymentMethodName: "Load Test",
    ...(COUPON_CODE ? { couponCode: COUPON_CODE } : {}),
  });

  const res = http.post(`${BASE_URL}/api/create-order`, payload, {
    headers: {
      "Content-Type": "application/json",
      // Origin debe coincidir con NEXT_PUBLIC_APP_URL o el middleware responde 403 (CSRF).
      Origin: BASE_URL,
      // IP sintética por VU para no chocar con el rate limiter (500/min por IP).
      "X-Forwarded-For": `10.5.${Math.floor(__VU / 256)}.${__VU % 256}`,
    },
  });

  // En modo cupón, 400 (COUPON_LIMIT_REACHED) es un rechazo esperado, no un fallo.
  const success = check(res, {
    "status esperado": (r) =>
      r.status === 200 || r.status === 409 || (!!COUPON_CODE && r.status === 400),
  });

  if (res.status === 200) {
    successCount.add(1);
  } else {
    failCount.add(1);
  }

  sleep(0.1);
}
