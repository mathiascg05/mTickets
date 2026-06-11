# Pruebas de estrés — matickets

Runbook para validar que **dos eventos vendan entradas a la vez** bajo alta afluencia
(~500–1.000 compradores concurrentes) sin overselling, sin caídas y sin errores.

## ⚠️ Entorno

Correr **solo contra una app InstantDB de staging** + un deploy de preview en Vercel.
Nunca contra producción: generaría órdenes/balances reales, dispararía emails reales y
gastaría cuota de Instant de prod.

1. Crear app de staging: `npx instant-cli init-without-files --title matickets-staging`
   → guardar `appId`/`adminToken` en `.env.staging`; `npx instant-cli push schema/perms`.
2. Deploy de preview en Vercel apuntando a esa app. SMTP → sink (Mailtrap) para no enviar
   emails reales. `CRON_SECRET` propio.
3. Instalar k6: `brew install k6`.

Todos los comandos de scripts cargan `.env.staging` y exigen `LOADTEST_CONFIRM=1` para
operaciones destructivas (guard anti-prod en `scripts/loadtest-config.ts`).

### 🔒 Aislamiento (no afecta a eventos reales)

El harness corre **exclusivamente** contra la app InstantDB de **staging** (`ab553da0…`) y
el proyecto Vercel de **staging** (`matickets-staging-r1`), **nunca** contra producción
(`66280f75…` / `matickets.net`). Doble seguro en `assertSafeToMutate`:

1. **Aborta SIEMPRE** si el `appId` destino empieza con el prefijo de producción
   (`PROD_APP_ID_PREFIX = "66280f75"`), sin importar nada más.
2. Exige `LOADTEST_CONFIRM=1` para cualquier escritura.

Por eso las pruebas de carga **no pueden tocar ni degradar eventos de otros organizadores**:
viven en una base de datos distinta. (Nota de PROD aparte: en el plan free, todos los eventos
reales comparten una sola app InstantDB, así que un evento de alto tráfico sí puede afectar a
otros el día del evento — eso es harina de otro costal, no de este harness.)

### Fases (tramos de precio)

Para sembrar tipos de entrada **con fases** (Early Bird / General / Last Minute que suman el
stock), añade `WITH_PHASES=1` al seed. El servidor deriva la fase activa solo, así que los
scripts k6 no cambian. `loadtest:verify` reporta vendidas por fase y marca cualquier
"leak de borde" (vender de más en una fase, sin sobreventa de evento).

## Ciclo de cada corrida

```bash
# 1) Sembrar (idempotente; imprime los TICKET_TYPE_ID)
DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 \
  STOCK_A=1000 STOCK_B=1000 npm run loadtest:seed

# 2) Correr el escenario (ver tabla abajo)
BASE_URL=<preview-url> TICKET_TYPE_ID=<idA> k6 run load-tests/buy-flow.js

# 3) Verificar invariantes (overselling, orderNumbers, cupones, huérfanas)
DOTENV_CONFIG_PATH=.env.staging npm run loadtest:verify

# 4) Limpiar antes de la siguiente corrida (mantiene los IDs estables)
DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 npm run loadtest:reset
# (usar `npm run loadtest:reset -- --purge` para borrar los conciertos por completo)
```

## Escenarios

| ID | Objetivo | Comando |
|----|----------|---------|
| **S1** Flash sale (overselling) | Stock escaso, ráfaga directa. 0 overselling, sin 500. | `STOCK_A=100 …seed`; `TICKET_TYPE_ID=<idA> k6 run buy-flow.js` |
| **S2** Cola, un evento | Espera FIFO, admisión, nadie sin token entra. | `TICKET_TYPE_ID=<idA> k6 run full-flow.js` |
| **S3** Dos eventos en paralelo | Degradación cruzada (Instant + email + Vercel). | `TICKET_TYPE_ID_A=<idA> TICKET_TYPE_ID_B=<idB> k6 run dual-event.js` |
| **S4** Punto de quiebre | Rampa 0→1.500 VU/evento hasta que algo rompa. | `MODE=ramp TICKET_TYPE_ID_A=<idA> TICKET_TYPE_ID_B=<idB> k6 run dual-event.js` |
| **S5** Carrera de cupón | `LOADTEST5` maxUses=5; nunca >5 redenciones. | añadir `couponCode:"LOADTEST5"` al payload y 200 VU |
| **S6** Reservas abandonadas | Crear reservas sin orden; verificar recuperación de stock. | `loadtest:verify` reporta reservas vencidas vivas |
| **S7** Organizador (entrada) | Aprobar N órdenes + entry rush concurrente; guard anti-doble-escaneo. | `BASE_URL=<url> N=200 CONC=60 npm run loadtest:scan` |
| **S8** Borde de fase | Siembra con fases y ráfaga que cruza el límite de la fase 1; mide leak de borde. | `WITH_PHASES=1 …seed`; `TICKET_TYPE_ID=<idA> k6 run buy-flow.js` |

`BASE_URL` = URL del preview de Vercel en todos los comandos.

La suite completa (incluye S7/S8): `BASE_URL=<url> DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 ./load-tests/run-loadtest-suite.sh`

## Qué vigilar durante cada corrida

- **k6**: `orders_created`, `orders_failed`, `queue_rejected`, `queue_wait_time_ms`,
  `http_req_duration{step:create-order}` p95<3s, tasa de 200/409/429/500/504.
  En `dual-event.js` las métricas llevan tag `{event:A|B}` → comparar A vs B.
- **Vercel**: duración/memoria de funciones, cold starts, 504s, y logs
  `[create-order] Transaction attempt N failed` (señal de contención del contador).
- **InstantDB dashboard**: latencia de queries/transacts, errores, uso vs límite del tier.
- **Email sink**: confirmaciones recibidas vs órdenes (pool de 2 conexiones → cuello).

## Criterios de aprobación

1. Cero overselling (`loadtest:verify` en verde).
2. Cero `orderNumber` duplicados.
3. A ~1.000 concurrentes (S3): 0% de 5xx/504, rechazos solo 409, p95 create-order <3s.
4. Cola admite en orden; nadie sin token llega al checkout.
5. Cupones ≤ maxUses; stock de reservas abandonadas se recupera.
6. Punto de quiebre (S4) holgadamente por encima del pico esperado.

Ver el plan completo (riesgos y mitigaciones) en
`~/.claude/plans/en-matickets-voy-a-proud-fairy.md`.
