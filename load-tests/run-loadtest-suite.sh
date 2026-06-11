#!/usr/bin/env bash
# Orquesta la suite de pruebas de estrés: seed → k6 → verify por escenario.
# Deja logs en load-tests/results/<timestamp>/.
#
# Requisitos:
#   - El server bajo prueba debe estar corriendo (BASE_URL).
#   - DOTENV_CONFIG_PATH apuntando a .env.staging (para los scripts tsx).
#   - LOADTEST_CONFIRM=1 (guard anti-prod de los scripts tsx).
#
# Uso:
#   BASE_URL=http://localhost:3000 DOTENV_CONFIG_PATH=.env.staging LOADTEST_CONFIRM=1 \
#     ./load-tests/run-loadtest-suite.sh            # corre S1 S2 S3 S5 S6
#   ... ./load-tests/run-loadtest-suite.sh S1 S3    # solo escenarios indicados
set -euo pipefail

cd "$(dirname "$0")/.."  # raíz del repo

: "${BASE_URL:?Define BASE_URL (p.ej. http://localhost:3000)}"
: "${LOADTEST_CONFIRM:?Define LOADTEST_CONFIRM=1}"
: "${DOTENV_CONFIG_PATH:?Define DOTENV_CONFIG_PATH=.env.staging}"

SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(S1 S2 S3 S5 S6)

TS="$(date +%Y%m%d-%H%M%S)"
OUT="load-tests/results/$TS"
mkdir -p "$OUT"
echo "📂 Resultados en $OUT"

read_id() { node -e "console.log(require('./load-tests/.loadtest-ids.json').$1 || '')"; }

seed() { STOCK_A="$1" STOCK_B="${2:-$1}" npx tsx scripts/seed-loadtest.ts >"$OUT/seed-$3.log" 2>&1; }
verify() { npx tsx scripts/verify-loadtest.ts | tee "$OUT/verify-$1.log"; }

run_S1() {
  echo "── S1 Flash sale (overselling), stock=100 ──"
  seed 100 100 S1
  TICKET_TYPE_ID="$(read_id A)" k6 run load-tests/buy-flow.js 2>&1 | tee "$OUT/k6-S1.log"
  verify S1
}
run_S2() {
  echo "── S2 Cola, un evento, stock=300 ──"
  seed 300 300 S2
  TICKET_TYPE_ID="$(read_id A)" k6 run load-tests/full-flow.js 2>&1 | tee "$OUT/k6-S2.log"
  verify S2
}
run_S3() {
  echo "── S3 Dos eventos en paralelo, stock=1000 c/u ──"
  seed 1000 1000 S3
  TICKET_TYPE_ID_A="$(read_id A)" TICKET_TYPE_ID_B="$(read_id B)" \
    k6 run load-tests/dual-event.js 2>&1 | tee "$OUT/k6-S3.log"
  verify S3
}
run_S4() {
  echo "── S4 Punto de quiebre (rampa) ──"
  seed 5000 5000 S4
  TICKET_TYPE_ID_A="$(read_id A)" TICKET_TYPE_ID_B="$(read_id B)" MODE=ramp \
    k6 run load-tests/dual-event.js 2>&1 | tee "$OUT/k6-S4.log"
  verify S4
}
run_S5() {
  echo "── S5 Carrera de cupón (maxUses=5) ──"
  seed 1000 1000 S5
  TICKET_TYPE_ID="$(read_id A)" COUPON_CODE="$(read_id coupon)" \
    k6 run load-tests/buy-flow.js 2>&1 | tee "$OUT/k6-S5.log"
  verify S5
}
run_S6() {
  echo "── S6 Reservas abandonadas (recuperación de stock) ──"
  seed 1000 1000 S6
  ACTIVE_RES=50 EXPIRED_RES=50 npx tsx scripts/abandon-reservations-loadtest.ts \
    2>&1 | tee "$OUT/S6.log"
  verify S6
}

for s in "${SCENARIOS[@]}"; do
  case "$s" in
    S1) run_S1 ;; S2) run_S2 ;; S3) run_S3 ;; S4) run_S4 ;; S5) run_S5 ;; S6) run_S6 ;;
    *) echo "⚠️ escenario desconocido: $s (válidos: S1 S2 S3 S4 S5 S6)" ;;
  esac
done

echo ""
echo "✅ Suite terminada. Logs en $OUT"
echo "   Revisa cada verify-*.log: 'Todos los invariantes críticos se cumplen' = OK."
