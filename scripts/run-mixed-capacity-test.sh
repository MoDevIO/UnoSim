#!/usr/bin/env bash

# Reproducible mixed REST compile + simulation load measurement. This is an
# opt-in staging/target measurement, never a default CI or production setting.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

OUTPUT_DIR="${CAPACITY_TEST_OUTPUT_DIR:-./capacity-test-results}"
PROFILE="BASELINE"
BURST=""
REST_COMPILE_COUNT=""
REST_COMPILE_CONCURRENCY=""
HOLD_MS="60000"
SIMULATION_TIMEOUT_SEC="120"
TARGET_LABEL=""
TARGET_KIND=""
DEDICATED_HOST_ACK=0
SERVER_PID=""
SERVER_RUN_ID=""
SERVER_LOG=""

usage() {
  cat <<'EOF'
Usage:
  scripts/run-mixed-capacity-test.sh [required workload and target options] --dedicated-host

Required options: --target-label NAME --target-kind production|representative-staging
  --profile PROFILE --burst N --rest-compiles N
Optional: --rest-compile-concurrency N --hold-ms N --simulation-timeout-sec N

Runs an owned Docker-mode backend and starts REST compiles and simulation
starts together. Requires Linux, a local Docker Engine and an explicit
dedicated-host acknowledgement. It records measurements without applying
pass/fail performance thresholds.
EOF
}

valid_uint() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) [[ $# -ge 2 ]] || { echo "--profile needs a value" >&2; exit 2; }; PROFILE="$2"; shift 2 ;;
    --burst) [[ $# -ge 2 ]] || { echo "--burst needs a value" >&2; exit 2; }; BURST="$2"; shift 2 ;;
    --rest-compiles) [[ $# -ge 2 ]] || { echo "--rest-compiles needs a value" >&2; exit 2; }; REST_COMPILE_COUNT="$2"; shift 2 ;;
    --rest-compile-concurrency) [[ $# -ge 2 ]] || { echo "--rest-compile-concurrency needs a value" >&2; exit 2; }; REST_COMPILE_CONCURRENCY="$2"; shift 2 ;;
    --hold-ms) [[ $# -ge 2 ]] || { echo "--hold-ms needs a value" >&2; exit 2; }; HOLD_MS="$2"; shift 2 ;;
    --simulation-timeout-sec) [[ $# -ge 2 ]] || { echo "--simulation-timeout-sec needs a value" >&2; exit 2; }; SIMULATION_TIMEOUT_SEC="$2"; shift 2 ;;
    --target-label) [[ $# -ge 2 ]] || { echo "--target-label needs a value" >&2; exit 2; }; TARGET_LABEL="$2"; shift 2 ;;
    --target-kind) [[ $# -ge 2 ]] || { echo "--target-kind needs a value" >&2; exit 2; }; TARGET_KIND="$2"; shift 2 ;;
    --dedicated-host) DEDICATED_HOST_ACK=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || { echo "Run this measurement on the Linux target host; macOS/Docker Desktop results are not accepted" >&2; exit 2; }
[[ "${DEDICATED_HOST_ACK}" == "1" ]] || { echo "Pass --dedicated-host only on an isolated target or representative staging host" >&2; exit 2; }
[[ -n "${TARGET_LABEL}" && "${TARGET_LABEL}" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || { echo "--target-label must be 1-64 letters, digits, dots, underscores or hyphens" >&2; exit 2; }
[[ "${TARGET_KIND}" == "production" || "${TARGET_KIND}" == "representative-staging" ]] || { echo "--target-kind must be production or representative-staging" >&2; exit 2; }
[[ -n "${BURST}" ]] && valid_uint "${BURST}" && (( BURST <= 180 )) || { echo "--burst must be between 1 and 180" >&2; exit 2; }
[[ -n "${REST_COMPILE_COUNT}" ]] && valid_uint "${REST_COMPILE_COUNT}" && (( REST_COMPILE_COUNT <= 128 )) || { echo "--rest-compiles must be between 1 and 128" >&2; exit 2; }
[[ -n "${REST_COMPILE_CONCURRENCY}" ]] || REST_COMPILE_CONCURRENCY=$(( REST_COMPILE_COUNT < 8 ? REST_COMPILE_COUNT : 8 ))
valid_uint "${REST_COMPILE_CONCURRENCY}" && (( REST_COMPILE_CONCURRENCY <= REST_COMPILE_COUNT && REST_COMPILE_CONCURRENCY <= 64 )) || { echo "REST compile concurrency must be at most min(--rest-compiles, 64)" >&2; exit 2; }
valid_uint "${HOLD_MS}" && (( HOLD_MS >= 1000 && HOLD_MS <= 300000 )) || { echo "--hold-ms must be between 1000 and 300000" >&2; exit 2; }
valid_uint "${SIMULATION_TIMEOUT_SEC}" && (( SIMULATION_TIMEOUT_SEC <= 300 )) || { echo "--simulation-timeout-sec must be between 1 and 300" >&2; exit 2; }

case "${PROFILE}" in BASELINE|R20|R40|R60|R80|R80_BURST) ;; *) echo "Unknown profile: ${PROFILE}" >&2; exit 2 ;; esac
if [[ -n "${DOCKER_HOST:-}" ]]; then
  DOCKER_ENDPOINT="${DOCKER_HOST}"
else
  DOCKER_ENDPOINT="$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')"
fi
[[ "${DOCKER_ENDPOINT}" == unix://* ]] || { echo "Docker must use a local Unix socket; remote Docker would measure the wrong host" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is unavailable" >&2; exit 1; }
docker image inspect unosim-sandbox:latest >/dev/null 2>&1 || { echo "Required image unosim-sandbox:latest is missing; run npm run build:sandbox first" >&2; exit 1; }
[[ -x ./node_modules/.bin/tsx ]] || { echo "Dependencies are missing; run npm install first" >&2; exit 1; }
ARDUINO_CLI_VERSION="$(arduino-cli version 2>/dev/null || true)"
printf '%s\n' "${ARDUINO_CLI_VERSION}" | grep -Fq "Version: 1.5.1 " || { echo "Arduino CLI 1.5.1 is required on the host" >&2; exit 1; }
ARDUINO_AVR_CORE_VERSION="$(arduino-cli core list | awk '$1 == "arduino:avr" {print $2}')"
[[ -n "${ARDUINO_AVR_CORE_VERSION}" ]] || { echo "The arduino:avr core must be installed on the host" >&2; exit 1; }

PROFILE_VALUES="$(node --import tsx --input-type=module -e 'import {getCapacityProfile} from "./scripts/capacity-validation-config.ts"; const p=getCapacityProfile(process.argv[1]); console.log(`${p.simulationMaxConcurrent}\t${p.sandboxStartMaxConcurrent}\t${p.admissionMax}`);' "${PROFILE}")"
IFS=$'\t' read -r SIMULATION_MAX SANDBOX_START_MAX ADMISSION_MAX <<< "${PROFILE_VALUES}"
PORT="$(node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port); server.close();});')"
BASE_URL="http://127.0.0.1:${PORT}"
SERVER_RUN_ID="capacity_mixed_${PROFILE}_$$_$(date +%s)"
SERVER_LOG="${OUTPUT_DIR}/backend-${SERVER_RUN_ID}.log"
REPORT_PATH="${OUTPUT_DIR}/mixed-${SERVER_RUN_ID}.json"
mkdir -p "${OUTPUT_DIR}"

stop_owned_backend() {
  if [[ -n "${SERVER_PID}" ]]; then
    if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      kill -TERM "${SERVER_PID}" >/dev/null 2>&1 || true
      for _ in {1..20}; do kill -0 "${SERVER_PID}" >/dev/null 2>&1 || break; sleep 0.25; done
      kill -KILL "${SERVER_PID}" >/dev/null 2>&1 || true
    fi
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
    SERVER_PID=""
  fi
  if [[ -n "${SERVER_RUN_ID}" ]]; then
    local owned_ids
    owned_ids="$(docker ps -aq --filter "label=unosim.capacity-test-run-id=${SERVER_RUN_ID}" 2>/dev/null || true)"
    if [[ -n "${owned_ids}" ]]; then
      while IFS= read -r container_id; do
        [[ -n "${container_id}" ]] && docker rm -f "${container_id}" >/dev/null 2>&1 || true
      done <<< "${owned_ids}"
    fi
    SERVER_RUN_ID=""
  fi
}
trap stop_owned_backend EXIT INT TERM

echo "Target=${TARGET_LABEL} (${TARGET_KIND}); profile=${PROFILE}; simulations=${BURST}; REST compiles=${REST_COMPILE_COUNT} (concurrency ${REST_COMPILE_CONCURRENCY})"
echo "Docker endpoint=${DOCKER_ENDPOINT}; report=${REPORT_PATH}"
env \
  NODE_ENV=test \
  UNOSIM_SERVER_MODE=docker \
  UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1 \
  DISABLE_RATE_LIMIT=1 \
  PORT="${PORT}" \
  UNOSIM_LISTEN_HOST=127.0.0.1 \
  SIMULATION_MAX_CONCURRENT="${SIMULATION_MAX}" \
  SANDBOX_START_MAX_CONCURRENT="${SANDBOX_START_MAX}" \
  SIMULATION_ADMISSION_MAX="${ADMISSION_MAX}" \
  SIMULATION_QUEUE_TIMEOUT_MS=60000 \
  SANDBOX_START_SLOT_TIMEOUT_MS="${SANDBOX_START_SLOT_TIMEOUT_MS:-30000}" \
  DOCKER_SANDBOX_IMAGE=unosim-sandbox:latest \
  CAPACITY_TEST_RUN_ID="${SERVER_RUN_ID}" \
  LOG_LEVEL=warn \
  ./node_modules/.bin/tsx server/index.ts >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

READY=0
for _ in {1..360}; do
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then echo "Owned backend exited; log: ${SERVER_LOG}" >&2; cat "${SERVER_LOG}" >&2; exit 1; fi
  STATUS_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 1 "${BASE_URL}/api/readiness" 2>/dev/null || true)"
  if [[ "${STATUS_CODE}" == "200" ]]; then READY=1; break; fi
  sleep 0.5
done
[[ "${READY}" == "1" ]] || { echo "Owned backend failed readiness; log: ${SERVER_LOG}" >&2; cat "${SERVER_LOG}" >&2; exit 1; }

CAPACITY_MIXED_TEST_ENABLED=1 \
CAPACITY_MIXED_TARGET_LABEL="${TARGET_LABEL}" \
CAPACITY_MIXED_TARGET_KIND="${TARGET_KIND}" \
CAPACITY_MIXED_OUTPUT_PATH="${REPORT_PATH}" \
CAPACITY_TEST_PROFILE="${PROFILE}" \
CAPACITY_TEST_BURST_SIZE="${BURST}" \
CAPACITY_TEST_HOLD_MS="${HOLD_MS}" \
CAPACITY_TEST_SIMULATION_TIMEOUT_SEC="${SIMULATION_TIMEOUT_SEC}" \
CAPACITY_TEST_REST_COMPILE_COUNT="${REST_COMPILE_COUNT}" \
CAPACITY_TEST_REST_COMPILE_CONCURRENCY="${REST_COMPILE_CONCURRENCY}" \
CAPACITY_TEST_REST_COMPILE_TIMEOUT_MS="${CAPACITY_TEST_REST_COMPILE_TIMEOUT_MS:-120000}" \
CAPACITY_MIXED_ARDUINO_CLI_VERSION="${ARDUINO_CLI_VERSION}" \
CAPACITY_MIXED_AVR_CORE_VERSION="${ARDUINO_AVR_CORE_VERSION}" \
CAPACITY_TEST_SERVER_URL="${BASE_URL}" \
CAPACITY_TEST_RUN_ID="${SERVER_RUN_ID}" \
  ./node_modules/.bin/tsx scripts/capacity-mixed-load.ts
