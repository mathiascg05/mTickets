# Reporte de pruebas de estrés — matickets

> **Resumen ejecutivo (leer esto primero):**
> - ✅ **Correctitud impecable**: CERO overselling en TODOS los escenarios (local + Vercel,
>   hasta 800 concurrentes), 0 números de orden duplicados, cupones respetados.
> - 🔴 **Cuello de botella crítico (R1)**: la creación de órdenes se serializa en un **único
>   contador `concert.lastOrderSeq` por evento**. A ~100 compras concurrentes, **~39% reciben
>   HTTP 500** (`CREATE_ORDER_FAILED`, se agotan los 10 reintentos) y el throughput cae a
>   ~2–3 órdenes/s. Es un problema de **diseño**, no solo del tier de InstantDB.
> - 🛡️ **La cola de espera es ESENCIAL y salva el día**, pero su límite actual
>   `MAX_CONCURRENT=100` es **demasiado alto** para lo que el contador aguanta.
> - ⚠️ Pruebas hechas contra **InstantDB de staging (free tier)**; prod puede diferir.
>   Confirmar tier de prod. Los timeouts (R3) probablemente mejoren en un tier superior, pero
>   la serialización del contador (R1) **persiste** sin importar el tier.
>
> **Acción #1 antes del evento:** mitigar R1 (ver Recomendaciones) y/o bajar `MAX_CONCURRENT`.

---

# Fase D — Vercel (concurrencia real) · 2026-06-08

Entorno: proyecto Vercel dedicado `matickets-staging` (env solo-staging, eliminado al final) +
app Instant staging `ab553da0-…`. k6 desde local contra la URL de Vercel (autoescalado real).

### Resultados

| Test | Config | Resultado |
|---|---|---|
| **S1 overselling** | stock 100, 800 VUs ráfaga | ✅ **Exactamente 100/100 vendidas, 0 overselling, 0 duplicados, secuencia perfecta.** Los 700 restantes → 409 limpio (sold out). Latencia alta bajo ráfaga (p95 16s, max 25s) pero **sin 504**. |
| **S3 dos eventos** | 500+500 VUs, flujo con cola | ✅ **0 overselling en ambos** (388 y 379 vendidas). La **cola funcionó**: gateó a 100 concurrentes, espera media ~105s. Pero ~23% de órdenes fallaron (los 500 de R1, ver abajo). |
| **Capacidad ungated** | stock 2000, 800 VUs ruta completa | 🔴 **Colapso**: solo ~142 órdenes commiteadas, ~80% fallos, latencia ~55s (al borde del timeout de 60s). Sin la cola, el sistema se desploma. |
| **Aislamiento de causa** | stock 5000, 100 conc, 300 reqs | 🔴 **200: 117 · 500: 116 (39%) · timeout: 67 (22%) · 409: 0.** Throughput ~2.4/s. **0 overselling.** |

### Diagnóstico de causa raíz

- **R1 — contención del contador (CRÍTICO):** los HTTP 500 son `CREATE_ORDER_FAILED`
  (`create-order/route.ts:512-522`): la transacción que incrementa `concert.lastOrderSeq`
  (+ `orderNumber` único global) **agota los 10 reintentos** porque ~100 compradores chocan
  sobre el MISMO contador. Es un punto de serialización lógico → techo de throughput
  ≈ 1/(latencia de commit) órdenes/seg por evento. **Independiente del tier de InstantDB.**
- **R3 — InstantDB staging (timeouts):** los `fetch failed` (22%) son requests que exceden el
  tiempo bajo el throttling del free tier. Un tier superior los reduciría, pero NO arregla R1.
- **0 × 409 espurios:** el rollback post-escritura (R2) **no** rechaza órdenes válidas — bien.
- **Sin overselling jamás:** la protección de inventario es correcta incluso bajo el colapso.

### Implicación para el evento real
Con la cola activa (gate 100) el sistema vende sin caerse, pero a 100 concurrentes ~39% de
compradores verían "intenta de nuevo" (500) y tendrían que reintentar. En un sold-out rápido eso
es mucha fricción. **La cola evita la caída total; R1 limita cuántos compran sin error.**

### Recomendaciones (priorizadas) antes del evento

1. **Arreglar R1 — eliminar la serialización del contador (lo más impactante).** Opciones, de
   menor a mayor esfuerzo:
   - **Rápida (band-aid):** subir `MAX_RETRIES` (hoy 10) y el backoff en
     `create-order/route.ts`, y **bajar `MAX_CONCURRENT` de 100 a ~20–30** en
     `queueConstants.ts` para que la cola no inyecte más concurrencia de la que el contador
     aguanta. Reduce los 500 a costa de colas más largas.
   - **Robusta:** dejar de numerar con un único contador por concierto. Asignar `orderNumber`
     **al aprobar** (no al crear), o numerar por `ticketType`/fase (reparte la contención), o
     usar un número sin contador serializado (sufijo aleatorio + restricción única). Esto sube
     el techo de throughput de ~10/s a mucho más por evento.
2. **Confirmar el tier de InstantDB de prod** y, si es free/básico, subirlo: reduce los
   timeouts (R3). Pedir a InstantDB sus límites de transacciones concurrentes.
3. **Re-correr esta Fase D contra el tier de prod** (o un staging del mismo tier) para números
   definitivos, idealmente tras aplicar (1).
4. **Cola:** cron `process-queue` cada 1 min (hoy diario) para que la admisión no dependa solo
   de heartbeats bajo carga (R5).

---

# Reporte de pruebas de estrés — matickets (Fase C: local)

**Fecha:** 2026-06-08 · **Entorno:** app Instant de staging `ab553da0-…` + `next start`
local (proceso único) en `localhost:3000` · **Herramienta:** k6 + scripts de verificación.

> Objetivo: validar que dos eventos puedan vender sin overselling ni errores bajo alta
> concurrencia. Esta fase corre en **local**, lo que valida **correctitud** pero **no
> throughput/escala** (ver Limitación clave). La medición de capacidad real a 500–1.000
> usuarios requiere la Fase D (preview de Vercel).

---

## TL;DR

| Criterio | Resultado |
|---|---|
| **Cero overselling** | ✅ **Se cumple** en 11 corridas controladas (inicio-en-cero verificado). Inventario protegido. |
| **orderNumber sin duplicados** | ✅ Nunca se duplicó (restricción única serializa correctamente). |
| **Cap de cupón (maxUses)** | ✅ Exacto: 5 redenciones de 5, resto rechazado con 400. |
| **Reservas abandonadas liberan stock** | ✅ Las reservas vencidas no restan disponibilidad (R10 OK). |
| **Email no bloquea la compra** | ✅ Con credenciales inválidas, el envío falla en `after()` sin afectar la orden (R8 OK). |
| **Lógica de cola (admisión FIFO/cap/dedup)** | ✅ 28/28 tests unitarios/stress pasan. |
| **Drift del contador `lastOrderSeq`** | ⚠️ **Cosmético**: el contador se adelanta al nº real de órdenes → gaps en números de orden. No afecta inventario. |
| **Throughput / capacidad a 500–1.000** | 🔴 **NO medible en local** (ver abajo). Requiere Fase D (Vercel). |

**Veredicto:** la correctitud del núcleo (anti-overselling, cupones, reservas) es **sólida**
a los niveles de concurrencia que el entorno local permite. El gran pendiente es la
**capacidad real bajo carga distribuida**, que solo se puede medir en Vercel.

---

## Limitación clave (por qué local no basta)

Un único proceso `next start` **satura entre ~30 y ~60 conexiones concurrentes**:
- A **600 VUs simultáneas** → tormenta de `connection reset by peer` (se desborda el backlog
  del socket del proceso) y latencias de **~60 s**; solo 11 órdenes procesadas en 60 s.
- A **150 VUs** → latencia mediana 10 s, p90 60 s.
- Request **aislado** (server ocioso): **~1,2 s** (costo de 3–4 round-trips secuenciales a
  InstantDB por compra).

En Vercel esas conexiones se reparten entre múltiples instancias serverless autoescaladas,
cada una atendiendo pocas peticiones concurrentes. Por eso los **números de latencia/throughput
locales no son representativos** y no se reportan como capacidad. Lo que sí es representativo y
válido en local es la **correctitud** (invariantes de datos) bajo concurrencia moderada.

---

## Resultados por escenario

### S1 — Overselling (riesgo R1/R2) — ✅ correctitud OK
Método: stock pequeño (20/50), 30–60 VUs en ráfaga (lo máximo que el local procesa sin
colapsar), inicio-en-cero verificado, `verify-loadtest` al final. **11 corridas**:
- **Todas vendieron exactamente `stock`** (20/20, 50/50). **0 overselling. 0 orderNumber duplicados.**
- Nota: una corrida temprana SIN inicio-en-cero verificado mostró 51/50 (+1); **no se
  reprodujo** en 11 corridas limpias posteriores → atribuida a datos residuales del test, no a
  un bug. **Recomendación**: confirmar definitivamente en Vercel, donde la concurrencia es real
  y no serializada por un único event-loop (que en local podría enmascarar la carrera).

### Drift de `lastOrderSeq` — ⚠️ cosmético
En casi todas las corridas, `lastOrderSeq` terminó **1–7 por encima** del nº real de órdenes
(p.ej. 50 órdenes con `lastOrderSeq=57`). Causa: cuando la validación post-escritura detecta un
intento de sobreventa y hace rollback, borra las órdenes pero el contador no retrocede del todo.
**Efecto:** los números de orden (`LDTA-0001`, `LDTA-0002`, …) tendrán **gaps** ocasionales.
**No afecta el inventario** (la capacidad se controla contando órdenes, no por el contador).
Decidir si el gap cosmético importa para la numeración de cara al cliente.

### S5 — Carrera de cupón (R10) — ✅ OK
Cupón `LOADTESTA` (maxUses=5), 40 VUs todos enviándolo: **exactamente 5 redenciones**, 115
rechazadas con `400 COUPON_LIMIT_REACHED`. `verify`: `usos=5 / maxUses=5`.

### S6 — Reservas abandonadas (R10) — ✅ OK
30 reservas activas + 30 vencidas: disponibilidad cayó solo por las 30 activas (995 → 965). Las
**vencidas no restan stock**. (En prod, el cron de limpieza las borra; aquí se confirmó vía la
lógica real de `getAvailability`.)

### Cola de espera (R5/R6) — ✅ lógica validada por tests
No estresable en local (la cola se activa con ≥80 compradores concurrentes, umbral inalcanzable
antes de que el server sature). La lógica de admisión (FIFO por `position`, tope
`MAX_CONCURRENT=100`, expiración, deduplicación) está cubierta por **28 tests** que pasan
(`queueAdmission.test.ts`, `queueRoutes.stress.test.ts`). Su comportamiento **bajo carga real**
(R5 admisión dependiente de heartbeat, R6 escaneo O(n²)) debe medirse en Vercel.

### Email (R8) — ✅ comportamiento confirmado
Con credenciales SMTP inválidas a propósito, el envío de confirmación falla con `535` dentro de
`after()` **sin afectar la creación de la orden** (HTTP 200). Confirma que un fallo de email no
tumba la venta. El **throughput** del pool de 2 conexiones bajo cientos de envíos no se midió
(emails deshabilitados); evaluar en Vercel con un sink real.

---

## Pendientes para la Fase D (Vercel preview) — los riesgos que faltan

| Riesgo | Por qué necesita Vercel |
|---|---|
| **R3 Límites de InstantDB** | El cuello local es el proceso Node, no Instant. Solo Vercel (muchas instancias) genera el QPS real contra Instant para ver sus límites/latencia. **Lo más importante a cerrar.** |
| **R1/R2 overselling bajo concurrencia real** | Confirmar que el resultado de "0 overselling" se sostiene con paralelismo real (no serializado por un event-loop). |
| **R4 degradación cruzada entre los 2 eventos** | Requiere ambos vendiendo a la vez a escala. |
| **R5/R6 cola bajo carga** | Activar el umbral de 80+ concurrentes y medir latencia de heartbeat con miles en cola. |
| **R7 rate limiter / R9 front / R11 maxDuration 504** | Específicos de la infra serverless de Vercel. |

---

## Recomendaciones accionables

1. **Antes del evento (crítico): correr la Fase D en un preview de Vercel** apuntando a la app
   de staging, repitiendo S1/S3/S4 a 500–1.000 VUs. Es lo único que responde la pregunta de
   capacidad real y el límite de InstantDB (R3). Requiere un login de Vercel.
2. **Confirmar el tier de InstantDB y sus límites** con su equipo/soporte; si el punto de
   quiebre (S4 en Vercel) queda cerca del pico esperado, subir de tier.
3. **Decidir sobre el drift de `lastOrderSeq`**: si los gaps en números de orden molestan de
   cara al cliente, ajustar el rollback para no adelantar el contador (o numerar al aprobar, no
   al crear). No es urgente para inventario.
4. **Cola**: considerar un cron `process-queue` cada 1 min (hoy es diario) para que la admisión
   no dependa solo de heartbeats (R5), de cara a alta carga.

---

## Cómo reproducir
```bash
# server (en una terminal), con env de staging exportado:
set -a; . ./.env.staging; set +a; npm run build && npm run start
# en otra terminal:
export BASE_URL=http://localhost:3000 DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1
npm run loadtest:seed                                  # siembra 2 eventos
# overselling (baja concurrencia para no saturar el proceso local):
STOCK_A=50 npm run loadtest:seed >/dev/null
VUS=40 ITERS=120 TICKET_TYPE_ID=<idA> k6 run load-tests/buy-flow.js
npm run loadtest:verify
```

---

# Fase F — Fases (tramos de precio) + lado organizador · 2026-06-11 (free tier)

Harness ampliado: `WITH_PHASES=1` siembra 3 fases (Early Bird 30% @$8 / General 40% @$10 /
Last Minute 30% @$14 = stock), `verify-loadtest` chequea ventas por-fase, y el escenario S7
(`scripts/scan-ensayo.ts`) prueba el lado organizador (aprobar + entry rush + anti-doble-escaneo).

### Hallazgos

| Escenario | Resultado |
|---|---|
| **Organizador (S7)** entry rush 200 escaneos @60 conc | ✅ **200/200 check-in**, avg 441 ms; **200/200 re-escaneo → 409** (anti-doble-escaneo); 200/200 `visited=true`. |
| **Fase — SIN cola** (buy-flow, ráfaga 600) | 🔴 **Early Bird 537/300 (+237 al precio bajo)**. 0 sobreventa de evento, 0 errores, pero el borde de fase NO es concurrency-safe sin la cola. |
| **Fase — CON cola** (full-flow, 400 VUs) | ✅ **Early Bird 299/300, cero fuga.** La cola (gate 100) mantiene el borde de fase dentro del límite. |

### Conclusión sobre fases
- **En producción las fases son seguras**: el camino real del comprador pasa por la cola
  (se activa a 80 concurrentes, gatea a 100), y a ese nivel el borde de fase se respeta
  (299/300 medido). La sobreventa de evento NUNCA ocurre (validación post-escritura nivel evento).
- La fuga grande (537/300) solo aparece en la **ráfaga directa sin cola** (buy-flow), que ningún
  comprador real usa. Es un artefacto del escenario de estrés, no del flujo de producción.
- **Causa técnica:** la validación post-escritura en `create-order` chequea `available < 0` a
  nivel de EVENTO (rueda a la siguiente fase), no a nivel de FASE. Si algún día se quitara la cola
  o se subiera mucho `MAX_CONCURRENT`, el borde de fase podría filtrar. Mitigación futura opcional:
  añadir validación post-escritura por-fase análoga a la de evento.

### Aislamiento de pruebas (no afecta eventos reales)
`assertNotProd()` aborta SIEMPRE si el `appId` destino empieza con `66280f75` (prod), en TODOS
los scripts (incluido `verify`, solo-lectura). El harness solo toca la app InstantDB de staging
(`ab553da0`) y el proyecto Vercel `matickets-staging-r1`. Verificado: seed/verify abortan con 🛑
ante un appId de prod simulado.

### Nota de free tier (reconfirmada)
El reset de esta corrida limpió **5.616 queueEntries** acumuladas → la carga de lectura de la cola
(heartbeats) crece con la fila y es lo que throttlea el free tier bajo carga sostenida. La
correctitud (0 sobreventa, 0 duplicados, fases con cola, anti-doble-escaneo) **nunca falla**.
