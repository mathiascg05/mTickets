# Runbook del día del evento — venta a volumen (~500 concurrentes)

Guía operativa para el pico de venta. Pensada para tener a mano en el teléfono/laptop
mientras la gente compra. No requiere tocar código.

---

## 0. Lo primero que debes entender: la cola es el escudo

El sistema **no intenta atender a 500 personas comprando a la vez**. Las pone en fila:

- `QUEUE_THRESHOLD = 80` → cuando hay ~80 compradores activos, se activa la cola.
- `MAX_CONCURRENT = 100` → como máximo ~100 personas están "comprando" simultáneamente;
  el resto espera ordenado (FIFO) y entra a medida que se liberan cupos.
  (`src/lib/queueConstants.ts`, `src/lib/queueAdmission.ts`)

Consecuencia: aunque entren 500, 1.000 o 3.000 de golpe, la carga real sobre la compra
queda **acotada a ~100**. Por eso el sistema no se desploma por saturación. Si ves la cola
activarse, **es el sistema funcionando bien**, no un fallo.

---

## 1. Monitoreo en vivo (ten estas 2 pestañas abiertas)

1. **Sentry** → https://sentry.io (proyecto maTickets). Filtra por errores nuevos.
   Configurado en `sentry.server.config.ts` (muestreo 20% de traces).
2. **Vercel → proyecto `ma-tickets` → Deployments → (deploy en producción) → Runtime Logs.**
   Aquí ves latencia y errores de funciones en tiempo real.

---

## 2. Señales: qué es NORMAL y qué es ALARMA

| Señal en logs / Sentry | ¿Qué significa? | Acción |
|---|---|---|
| `[create-order] Transaction attempt N failed` | Contención normal de InstantDB; reintenta solo. | Ninguna (salvo que sean masivos y crezcan). |
| `CONCURRENT_CONFLICT` (409) | El guard anti-sobreventa hizo su trabajo: rechazó una orden de más. | Ninguna. Es protección sana. |
| `NOT_ENOUGH_TICKETS` (409) | Agotado / sin cupo en ese momento. | Ninguna. Esperado al llenarse. |
| Cola activa, gente esperando | El escudo funcionando. | Ninguna. |
| **`5xx` / `504` sostenidos** | **Saturación real o caída de dependencia.** | **Ir a sección 3.** |
| Sentry dispara errores nuevos en ráfaga | Algo se rompió de verdad. | **Ir a sección 3.** |

---

## 3. Si algo se degrada de verdad (5xx/504 sostenidos)

⚠️ **No hay "kill switch".** No existe un botón para apagar features bajo presión sin
re-deploy (y el código está congelado). Estas son las palancas reales:

1. **Identifica la dependencia.** Casi siempre el problema no es tu código sino un proveedor:
   - **InstantDB** caído/lento → revisa https://status.instantdb.com y el dashboard de Instant.
     Es la mayor incógnita externa; si es esto, no hay fix local, solo esperar/escalar con soporte.
   - **Vercel** → https://vercel-status.com
   - **SMTP/Resend** → los correos fallan pero **la compra NO se bloquea** (ver sección 4).
2. **No empeores la carga:** **no dispares broadcasts/comunicados masivos durante el pico**
   (el cron `process-broadcasts` compite por funciones y conexiones SMTP).
3. **IP compartida del recinto:** si mucha gente compra desde el mismo WiFi/NAT y ves 429,
   pídeles que usen **datos móviles** (el rate limit es por IP: 500/min en create-order).
4. **Verificación de integridad** en cualquier momento (no toca prod, lee la DB):
   `DOTENV_CONFIG_PATH=.env.staging npm run loadtest:verify` → confirma 0 sobreventa.
   Para prod, revisa el panel de órdenes del organizador.
5. **Contactos de escalamiento:** ten a mano soporte de InstantDB y Vercel.

---

## 4. Correos: pueden tardar, NO es un fallo

Los correos de confirmación se envían en segundo plano (`after()` en `create-order`) por un
pool SMTP de 2 conexiones. Bajo pico, **pueden llegar con minutos de retraso**, pero **la
compra se completa igual** (el ticket existe en cuanto la orden se crea). Avisa a la gente:
"tu ticket puede tardar unos minutos en llegar al correo, no compres de nuevo".

---

## 5. Checklist pre-venta (minutos antes de abrir)

- [ ] Confirmar que el evento real tiene el stock correcto cargado.
- [ ] Tener abiertas las pestañas de Sentry y Vercel Runtime Logs.
- [ ] No tener programado ningún broadcast masivo durante la ventana de venta pico.
- [ ] Mensaje listo para la gente sobre "el correo puede tardar".
- [ ] Tener a mano links de status: InstantDB, Vercel.

---

## 6. Arreglar EN CALIENTE (hotfix / rollback durante la venta)

Dos velocidades de recuperación. Elige según la causa (ver triage abajo).

### A. Rollback instantáneo (segundos) — si un cambio reciente quedó mal
Vercel conserva los deploys anteriores; volver a uno bueno **no reconstruye**:
- Dashboard → proyecto `ma-tickets` → **Deployments** → último deploy bueno → **Instant
  Rollback / Promote to Production**. Vivo en segundos.
- CLI: `npx vercel rollback <url-del-deploy-bueno> --yes`
Es la recuperación más rápida si la falla empezó justo después de un push.

### B. Hotfix con deploy (~2-4 min) — si hay que cambiar código
1. Edita el cambio mínimo.
2. **Despliega directo por CLI — NO confíes en el webhook de GitHub** (la última vez no
   disparó y hubo que forzarlo):
   ```
   npx vercel --prod --yes
   ```
   (CLI ya autenticado como `mcarstensg-3101`.) Construye y publica a prod en ~2-4 min.
3. Si el hotfix empeora → rollback (sección A).

### Palanca pre-identificada más probable: bajar MAX_CONCURRENT
Si bajo carga ves create-order lento / 500s / cola de lecturas saturada, el lever más seguro
es **admitir menos compradores a la vez** (menos contención + menos presión de heartbeats).
En `src/lib/queueConstants.ts`:
```
export const MAX_CONCURRENT = 100;   →   export const MAX_CONCURRENT = 60;
```
Más gente espera en cola (ordenada), pero el sistema respira. Deploy con `vercel --prod`.
⚠️ Subir los rate limits (`src/middleware.ts`) casi nunca es el arreglo — no lo toques sin diagnóstico.

### Triage de 10 segundos
| Síntoma | Causa probable | Acción más rápida |
|---|---|---|
| Empezó justo tras un push | Deploy malo | **Rollback** (A) |
| 5xx/504 que crecen con la carga, sin push reciente | Saturación | Bajar `MAX_CONCURRENT` (B) |
| Un endpoint puntual revienta (stack en Sentry) | Bug específico | Hotfix dirigido (B), o rollback si dudas |
| Lento pero SIN errores | Free tier bajo carga | No es bug; aguanta. Tier no es fix instantáneo |
| Solo fallan correos | SMTP/Resend | Ignorar en vivo — no bloquea la compra |

### Apóyate en Claude en vivo
Si algo falla, **pega aquí el error de Sentry o de los Vercel Runtime Logs** y te devuelvo el
diff exacto listo para `vercel --prod`. Diagnóstico + parche en minutos, no horas.

---

## Evidencia de respaldo

- **Back a escala:** suite k6 S1–S8 en verde (re-validado 2026-06-11 sobre el código actual;
  re-verificado localmente contra staging 2026-06-12: 200 intentos concurrentes → 0 sobreventa).
- **Front bajo carga:** `e2e/buy-flow-load.spec.ts` (clics repetidos → 1 sola orden;
  visitantes concurrentes sin caída).
- **Pendiente conocido (bajo riesgo, diferido post-evento):** idempotencia de cliente en
  create-order. La protección actual es el botón que se deshabilita al enviar.
