import "dotenv/config";
import { adminDb } from "../src/lib/adminDb";

/**
 * Configuración compartida y guard de seguridad para los scripts de load test.
 *
 * Los scripts seed / reset / verify SOLO deben correr contra una app InstantDB
 * de staging. Para evitar borrar datos de producción por accidente, todas las
 * operaciones destructivas exigen la env `LOADTEST_CONFIRM=1`.
 *
 * Uso (apuntando a staging):
 *   DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 \
 *     npx tsx scripts/seed-loadtest.ts
 */

export const LOADTEST = {
  /** Prefijo de slug que identifica a los conciertos de prueba. */
  slugPrefix: "loadtest-",
  events: [
    {
      key: "A",
      name: "Load Test Evento A",
      slug: "loadtest-evento-a",
      orderNumberPrefix: "LDTA",
      stockEnv: "STOCK_A",
      defaultStock: 1000,
    },
    {
      key: "B",
      name: "Load Test Evento B",
      slug: "loadtest-evento-b",
      orderNumberPrefix: "LDTB",
      stockEnv: "STOCK_B",
      defaultStock: 1000,
    },
  ] as const,
  organizerEmail: "loadtest@matickets.local",
  ticketTypeName: "General",
  paymentMethodName: "Load Test",
  // `coupons.code` es único GLOBAL en Instant → un código distinto por evento.
  coupon: { maxUses: 5, discountValue: 10 },
};

/** Código de cupón por evento (único global). p.ej. LOADTESTA / LOADTESTB. */
export function couponCodeFor(key: string): string {
  return `LOADTEST${key}`;
}

export function targetAppId(): string {
  return process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "(sin definir)";
}

/**
 * Aborta si no se confirmó explícitamente. Imprime la app destino para que
 * el operador verifique que NO es producción antes de continuar.
 */
export function assertSafeToMutate(action: string): void {
  const appId = targetAppId();
  console.log(`\n⚠️  Acción destructiva: ${action}`);
  console.log(`    App InstantDB destino: ${appId}`);
  console.log(`    NEXT_PUBLIC_APP_URL: ${process.env.NEXT_PUBLIC_APP_URL ?? "(sin definir)"}`);

  if (process.env.LOADTEST_CONFIRM !== "1") {
    console.error(
      "\n❌ Abortado. Para ejecutar contra ESTA app, corre de nuevo con LOADTEST_CONFIRM=1.\n" +
        "   Verifica primero que el appId de arriba sea el de STAGING, no producción.\n",
    );
    process.exit(1);
  }
}

export function stockFor(ev: (typeof LOADTEST.events)[number]): number {
  const raw = process.env[ev.stockEnv];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : ev.defaultStock;
}

/** Busca conciertos de prueba existentes (por prefijo de slug) con sus hijos. */
export async function findLoadtestConcerts() {
  const { concerts } = await adminDb.query({
    concerts: {
      $: { where: { slug: { $like: `${LOADTEST.slugPrefix}%` } } },
      ticketTypes: {
        orders: {},
        reservations: {},
        queueEntries: {},
        phases: {},
      },
      coupons: {},
      paymentMethods: {},
      platformFeeConfig: {},
    },
  });
  return concerts;
}
