#!/usr/bin/env bash

# Runs real-Docker capacity validation against a backend process owned by this
# invocation. Candidate profiles are staging-test inputs, never production defaults.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

OUTPUT_DIR="${CAPACITY_TEST_OUTPUT_DIR:-./capacity-test-results}"
PROFILE_FILTER=""
BURST_FILTER=""
DEDICATED_HOST_ACK=0
SERVER_PID=""
SERVER_RUN_ID=""
SERVER_LOG=""
BASELINE_RECEIPT="${OUTPUT_DIR}/baseline-validation.json"
EFFECTIVE_COMPILE_MAX_CONCURRENT=""

usage() {
  cat <<'EOF'
Usage:
  scripts/run-capacity-tests.sh
  scripts/run-capacity-tests.sh --profile BASELINE [--burst 5|25|40]
  scripts/run-capacity-tests.sh --profile R20|R40|R60|R80|R80_BURST --burst N --dedicated-host

Default behavior runs the historical 5/5/25 baseline in staged bursts of
5, 25, and 40 clients, then runs a 6-client queue-timeout check. Candidate
profiles require a successful baseline receipt and explicit dedicated-host
acknowledgement. This command always starts its own backend on a random
loopback port; it never accepts an existing server URL.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      [[ $# -ge 2 ]] || { echo "--profile needs a value" >&2; exit 2; }
      PROFILE_FILTER="$2"
      shift 2
      ;;
    --burst)
      [[ $# -ge 2 ]] || { echo "--burst needs a value" >&2; exit 2; }
      BURST_FILTER="$2"
      shift 2
      ;;
    --dedicated-host)
      DEDICATED_HOST_ACK=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable" >&2
  exit 1
fi
if ! docker image inspect unosim-sandbox:latest >/dev/null 2>&1; then
  echo "Required image unosim-sandbox:latest is missing; build it with npm run build:sandbox" >&2
  exit 1
fi
if [[ ! -x ./node_modules/.bin/tsx || ! -x ./node_modules/.bin/vitest ]]; then
  echo "Dependencies are missing; run npm install first" >&2
  exit 1
fi

DOCKER_HOST_INFO="$(docker info --format 'cpus={{.NCPU}} memory_bytes={{.MemTotal}}')"
echo "Docker host: ${DOCKER_HOST_INFO}"
echo "Results directory: ${OUTPUT_DIR}"

HARNESS_FILES=(
  scripts/run-capacity-tests.sh
  scripts/capacity-validation-config.ts
  tests/server/capacity-validation-config.test.ts
  tests/server/capacity-validation.test.ts
  server/config.ts
  server/routes/status.routes.ts
  server/services/docker-command-builder.ts
  server/services/sandbox/execution-manager.ts
  server/services/sandbox/execution-phases/start-phase.ts
)

harness_signature() {
  shasum -a 256 "${HARNESS_FILES[@]}" | shasum -a 256 | awk '{print $1}'
}

require_baseline_receipt() {
  [[ -f "${BASELINE_RECEIPT}" ]] || {
    echo "Candidate runs require a successful baseline receipt at ${BASELINE_RECEIPT}" >&2
    exit 1
  }
  local current_head current_signature receipt_ok
  current_head="$(git rev-parse HEAD)"
  current_signature="$(harness_signature)"
  receipt_ok="$(node -e 'const fs=require("node:fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(r.completed===true && r.head===process.argv[2] && r.harnessSignature===process.argv[3]));' "${BASELINE_RECEIPT}" "${current_head}" "${current_signature}")"
  [[ "${receipt_ok}" == "true" ]] || {
    echo "Baseline receipt does not match this HEAD and harness; rerun the full baseline first" >&2
    exit 1
  }
  [[ "${DEDICATED_HOST_ACK}" == "1" ]] || {
    echo "Candidate profiles are for suitable dedicated staging hosts; pass --dedicated-host only after moving there" >&2
    exit 1
  }
}

stop_owned_backend() {
  if [[ -n "${SERVER_PID}" ]]; then
    if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      kill -TERM "${SERVER_PID}" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        kill -0 "${SERVER_PID}" >/dev/null 2>&1 || break
        sleep 0.25
      done
      kill -KILL "${SERVER_PID}" >/dev/null 2>&1 || true
    fi
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
    SERVER_PID=""
  fi
  if [[ -n "${SERVER_RUN_ID}" ]]; then
    local owned_ids
    owned_ids="$(docker ps -aq --filter "label=unosim.capacity-test-run-id=${SERVER_RUN_ID}" 2>/dev/null || true)"
    if [[ -n "${owned_ids}" ]]; then
      # Cleanup is constrained to containers labeled by this exact test run.
      while IFS= read -r container_id; do
        [[ -n "${container_id}" ]] && docker rm -f "${container_id}" >/dev/null 2>&1 || true
      done <<< "${owned_ids}"
    fi
    SERVER_RUN_ID=""
  fi
}

trap stop_owned_backend EXIT INT TERM

choose_loopback_port() {
  node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{const address=server.address(); console.log(address.port); server.close();});'
}

run_one() {
  local profile="$1"
  local burst="$2"
  local scenario="$3"
  local hold_ms="$4"
  local simulation_timeout_sec="$5"
  local profile_values simulation_max sandbox_start_max admission_max
  local port base_url readiness_code

  profile_values="$(node --import tsx --input-type=module -e 'import {getCapacityProfile} from "./scripts/capacity-validation-config.ts"; const p=getCapacityProfile(process.argv[1]); console.log(`${p.simulationMaxConcurrent}\t${p.sandboxStartMaxConcurrent}\t${p.admissionMax}`);' "${profile}")"
  IFS=$'\t' read -r simulation_max sandbox_start_max admission_max <<< "${profile_values}"
  port="$(choose_loopback_port)"
  base_url="http://127.0.0.1:${port}"
  SERVER_RUN_ID="capacity_${profile}_${scenario}_${burst}_$$_$(date +%s)"
  SERVER_LOG="${OUTPUT_DIR}/backend-${SERVER_RUN_ID}.log"
  mkdir -p "${OUTPUT_DIR}"

  echo "Starting owned backend: profile=${profile}, simulation=${simulation_max}, sandbox-start=${sandbox_start_max}, admission=${admission_max}, port=${port}, run=${SERVER_RUN_ID}"
  env \
    NODE_ENV=test \
    UNOSIM_SERVER_MODE=docker \
    UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1 \
    DISABLE_RATE_LIMIT=1 \
    PORT="${port}" \
    UNOSIM_LISTEN_HOST=127.0.0.1 \
    SIMULATION_MAX_CONCURRENT="${simulation_max}" \
    SANDBOX_START_MAX_CONCURRENT="${sandbox_start_max}" \
    SIMULATION_ADMISSION_MAX="${admission_max}" \
    SIMULATION_QUEUE_TIMEOUT_MS=60000 \
    DOCKER_SANDBOX_IMAGE=unosim-sandbox:latest \
    CAPACITY_TEST_RUN_ID="${SERVER_RUN_ID}" \
    LOG_LEVEL=warn \
    ./node_modules/.bin/tsx server/index.ts >"${SERVER_LOG}" 2>&1 &
  SERVER_PID=$!

  local ready=0
  for _ in {1..360}; do
    if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      echo "Owned backend exited during startup. Log: ${SERVER_LOG}" >&2
      cat "${SERVER_LOG}" >&2
      return 1
    fi
    readiness_code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 1 "${base_url}/api/readiness" 2>/dev/null || true)"
    if [[ "${readiness_code}" == "200" ]]; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "${ready}" != "1" ]]; then
    echo "Owned Docker backend failed readiness. Log: ${SERVER_LOG}" >&2
    cat "${SERVER_LOG}" >&2
    return 1
  fi

  local status_payload
  status_payload="$(curl -fsS "${base_url}/api/status")"
  EFFECTIVE_COMPILE_MAX_CONCURRENT="$(node -e 'const r=JSON.parse(process.argv[1]); const value=r.capacity?.compile?.maxConcurrent; if (!Number.isInteger(value)) process.exit(1); console.log(value);' "${status_payload}")"

  CAPACITY_TEST_ENABLED=1 \
  CAPACITY_TEST_PROFILE="${profile}" \
  CAPACITY_TEST_SCENARIO="${scenario}" \
  CAPACITY_TEST_BURST_SIZE="${burst}" \
  CAPACITY_TEST_HOLD_MS="${hold_ms}" \
  CAPACITY_TEST_SIMULATION_TIMEOUT_SEC="${simulation_timeout_sec}" \
  CAPACITY_TEST_SERVER_URL="${base_url}" \
  CAPACITY_TEST_RUN_ID="${SERVER_RUN_ID}" \
  CAPACITY_TEST_OUTPUT_DIR="${OUTPUT_DIR}" \
    ./node_modules/.bin/vitest run --project=unit-node tests/server/capacity-validation.test.ts --reporter=verbose

  stop_owned_backend
}

if [[ -z "${PROFILE_FILTER}" && -z "${BURST_FILTER}" ]]; then
  mkdir -p "${OUTPUT_DIR}"
  run_one BASELINE 5 burst 5000 60
  run_one BASELINE 25 burst 5000 60
  run_one BASELINE 40 burst 5000 60
  run_one BASELINE 6 queue-timeout 65000 300

  node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({completed:true, profile:"BASELINE", simulationMaxConcurrent:5, sandboxStartMaxConcurrent:5, admissionMax:25, queueTimeoutMs:60000, compileMaxConcurrent:Number(process.argv[4]), bursts:[5,25,40], queueTimeoutCheck:true, head:process.argv[2], harnessSignature:process.argv[3], completedAt:new Date().toISOString()},null,2)+"\n");' \
    "${BASELINE_RECEIPT}" "$(git rev-parse HEAD)" "$(harness_signature)" "${EFFECTIVE_COMPILE_MAX_CONCURRENT}"
  echo "Historical baseline and 60-second queue timeout check passed. Receipt: ${BASELINE_RECEIPT}"
  exit 0
fi

case "${PROFILE_FILTER}" in
  BASELINE)
    [[ -n "${BURST_FILTER}" ]] || {
      echo "Use --burst with --profile BASELINE, or omit all filters to run the complete baseline" >&2
      exit 2
    }
    case "${BURST_FILTER}" in
      5|25|40) run_one BASELINE "${BURST_FILTER}" burst 5000 60 ;;
      *) echo "Baseline burst must be 5, 25, or 40" >&2; exit 2 ;;
    esac
    ;;
  R20|R40|R60|R80|R80_BURST)
    [[ -n "${BURST_FILTER}" ]] || { echo "Candidate runs require --burst" >&2; exit 2; }
    require_baseline_receipt
    run_one "${PROFILE_FILTER}" "${BURST_FILTER}" burst 5000 60
    ;;
  *) echo "Profile must be BASELINE, R20, R40, R60, R80, or R80_BURST" >&2; exit 2 ;;
esac
