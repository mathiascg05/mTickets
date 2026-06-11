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

/**
 * Prefijo del appId de PRODUCCIÓN. El harness JAMÁS debe correr contra prod
 * (generaría órdenes/emails reales y afectaría a eventos de otros organizadores
 * que comparten la misma app InstantDB). Si el appId destino empieza con esto,
 * abortamos siempre, sin importar LOADTEST_CONFIRM.
 */
export const PROD_APP_ID_PREFIX = "66280f75";

/** Fases: tipo y partición por defecto del stock (3 tramos de precio). */
export type LoadtestPhase = {
  name: string;
  price: number;
  quantity: number;
  sortOrder: number;
};

/** ¿Sembrar fases? Activar con WITH_PHASES=1. */
export function withPhases(): boolean {
  return process.env.WITH_PHASES === "1";
}

/**
 * Parte el stock en 3 fases (Early 30% / General 40% / Last 30%), con precios
 * crecientes, repartiendo el resto del redondeo en la última fase para que
 * Σ quantities == stock exacto. Permite override con PHASES_PCT="30,40,30".
 */
export function phasesForStock(stock: number): LoadtestPhase[] {
  const pctRaw = process.env.PHASES_PCT || "30,40,30";
  const pcts = pctRaw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  const weights = pcts.length >= 2 ? pcts : [30, 40, 30];
  const total = weights.reduce((s, w) => s + w, 0);
  const names = ["Early Bird", "General", "Last Minute"];
  const prices = [8, 10, 14];
  const qtys = weights.map((w) => Math.floor((stock * w) / total));
  // El redondeo va a la última fase para cuadrar Σ == stock.
  const assigned = qtys.reduce((s, q) => s + q, 0);
  qtys[qtys.length - 1] += stock - assigned;
  return weights.map((_, i) => ({
    name: names[i] ?? `Fase ${i + 1}`,
    price: prices[i] ?? 10 + i * 2,
    quantity: qtys[i],
    sortOrder: i,
  }));
}

/** Código de cupón por evento (único global). p.ej. LOADTESTA / LOADTESTB. */
export function couponCodeFor(key: string): string {
  return `LOADTEST${key}`;
}

export function targetAppId(): string {
  return process.env.NEXT_PUBLIC_INSTANT_APP_ID ?? "(sin definir)";
}

/**
 * Guard duro: nunca contra producción, ni siquiera en lecturas. Aborta si el
 * appId destino es el de prod. Lo usan TODOS los scripts (mutantes y verify).
 */
export function assertNotProd(): void {
  const appId = targetAppId();
  if (appId.startsWith(PROD_APP_ID_PREFIX)) {
    console.error(
      `\n🛑 ABORTADO: el appId destino (${appId}) es PRODUCCIÓN.\n` +
        "   El harness solo corre contra la app InstantDB de STAGING.\n" +
        "   Revisa DOTENV_CONFIG_PATH=.env.staging.\n",
    );
    process.exit(1);
  }
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

  assertNotProd(); // nunca contra prod, pase lo que pase

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
