#!/bin/bash

# ─────────────────────────────────────────────────────────────────
# UnoSim Test & Build Pipeline (Stability & Resource Guard)
# ─────────────────────────────────────────────────────────────────

# Konfiguration
LOG_FILE="run-tests_output.log"
TOTAL_STEPS=10
STEP=0
SERVER_PID=""

# Policy: Standard Log-Level für die Pipeline ist ERROR (1)
export LOG_LEVEL=1 
export NODE_ENV=test

# Docker-Konfiguration (überschreibbar per Umgebungsvariable)
# unix:// + absolute path = 3 slashes total; $HOME already starts with /
DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.docker/run/docker.sock}"
DOCKER_SANDBOX_IMAGE="${DOCKER_SANDBOX_IMAGE:-unosim-sandbox:latest}"
# Temp-Verzeichnis unter /Users/… damit Docker Desktop es per default mounten kann
UNOSIM_SHARED_TEMP_DIR="${UNOSIM_SHARED_TEMP_DIR:-$(pwd)/temp}"
export DOCKER_HOST DOCKER_SANDBOX_IMAGE UNOSIM_SHARED_TEMP_DIR

# Farben & Icons
G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; B="\033[1m"; D="\033[2m"; RS="\033[0m"
OK="${G}✔${RS}"; FAIL="${R}✘${RS}"; RUN="${Y}◌${RS}"; WARN="${Y}⚠${RS}"

div() { printf "${D}────────────────────────────────────────────────${RS}\n"; }

# Helfer: Alle Sandbox-Container finden (Name- UND Kommando-basiert,
# damit auch namenlose Container mit alten Image-IDs erfasst werden).
find_sandbox_containers() {
    local filter="${1:---filter status=exited}"  # default: nur beendete
    {
        docker ps -aq $filter --filter "name=unosim-sandbox" 2>/dev/null
        docker ps -a  $filter --format '{{.ID}} {{.Command}}' 2>/dev/null \
            | grep 'g++ /sandbox' | awk '{print $1}'
    } | sort -u
}

# Aufräum-Funktion bei Abbruch oder Ende
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null
    fi
    if docker info > /dev/null 2>&1; then
        local containers
        containers=$(find_sandbox_containers)
        if [ -n "$containers" ]; then
            echo "$containers" | xargs docker rm -f > /dev/null 2>&1 || true
        fi
    fi
}
trap cleanup EXIT

run_task() {
    local label=$1 cmd=$2 
    STEP=$((STEP+1))
    local start=$(date +%s)
    
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] $label${RS}"
    
    # Verzeichnisse sicherstellen
    mkdir -p temp build
    
    # Policy-Konforme Ausführung
    (set -o pipefail; eval "$cmd" >> "$LOG_FILE" 2>&1) &
    local pid=$!

    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  %b %-35s Sek.: %d" "$RUN" "$label" $(( $(date +%s) - start ))
        sleep 1
    done

    wait "$pid"
    local exit_code=$?
    local duration=$(( $(date +%s) - start ))

    if [ $exit_code -eq 0 ]; then
        printf "\r  %b %-35s Sek.: %d\n" "$OK" "$label" "$duration"
        return 0
    else
        printf "\r  %b %-35s ${R}FEHLER${RS} (Code: $exit_code)\n" "$FAIL" "$label"
        echo -e "  ${R}${FAIL} Aborted: See $LOG_FILE${RS}"
        exit 1
    fi
}

parse_test_results() {
    local pattern=$1
    # Prüfe die letzten 30 Zeilen auf Zusammenfassungen
    local line=$(tail -n 30 "$LOG_FILE" | grep -E "$pattern" | tail -n 1)
    [ -z "$line" ] && return

    local p; p=$(echo "$line" | grep -oE "[0-9]+ passed" | head -n 1 | cut -d' ' -f1); p=${p:-0}
    local f; f=$(echo "$line" | grep -oE "[0-9]+ failed" | head -n 1 | cut -d' ' -f1); f=${f:-0}
    local s; s=$(echo "$line" | grep -oE "[0-9]+ skipped" | head -n 1 | cut -d' ' -f1); s=${s:-0}

    local res="    "
    [[ $p -gt 0 ]] && res+="${OK} Passed: ${G}$p${RS}   "
    [[ $f -gt 0 ]] && res+="${FAIL} Failed: ${R}$f${RS}   "
    [[ $s -gt 0 ]] && res+="${WARN} Skipped: ${Y}$s${RS}"
    
    [[ -n $(echo $res | tr -d ' ') ]] && echo -e "$res"
}

# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
clear
div
printf "  ${B}UnoSim Test & Build Pipeline${RS} ${D}(Log: %s)${RS}\n" "$LOG_FILE"
div
rm -f "$LOG_FILE"
[ -d temp ] && rm -rf temp/*

# ─────── PRE-FLIGHT ───────
echo -e "\n${B}▸ [Pre-Flight] System checks & cleanup${RS}"

# Node.js / npm
if ! command -v npm &>/dev/null; then
    echo -e "  ${FAIL} npm not found – please install Node.js"
    exit 1
fi
echo -e "  ${OK} Node.js $(node -v)"

# Docker
DOCKER_AVAILABLE=0
if command -v docker &>/dev/null && docker info >/dev/null 2>&1; then
    DOCKER_AVAILABLE=1
    echo -e "  ${OK} Docker $(docker version --format '{{.Client.Version}}' 2>/dev/null)"

    # Stop conflicting unosim-server container (would block port 3000)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^unosim-server$"; then
        docker stop unosim-server >/dev/null 2>&1 || true
        echo -e "  ${OK} Stopped unosim-server (port 3000 conflict)"
    fi

    # Remove stale sandbox containers (name- and command-based)
    stale=$(find_sandbox_containers)
    if [ -n "$stale" ]; then
        count=$(echo "$stale" | wc -l | tr -d ' ')
        echo "$stale" | xargs docker rm -f >/dev/null 2>&1
        echo -e "  ${OK} Removed $count stale sandbox container(s)"
    fi

    # Sandbox image
    if docker image inspect "$DOCKER_SANDBOX_IMAGE" >/dev/null 2>&1; then
        echo -e "  ${OK} Sandbox image present"
    else
        echo -e "  ${WARN} Sandbox image missing – will be built if needed"
    fi
else
    echo -e "  ${WARN} Docker not available – Docker tests and sandbox will be skipped"
fi

# Free port 3000 (after Docker stop so no docker-proxy lingers)
if lsof -ti:3000 >/dev/null 2>&1; then
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
    echo -e "  ${OK} Port 3000 released"
else
    echo -e "  ${OK} Port 3000 free"
fi

# SonarQube (optional, informational)
if [ -n "$SONAR_TOKEN" ] && curl -sf http://localhost:9000/api/system/status >/dev/null 2>&1; then
    echo -e "  ${OK} SonarQube reachable"
else
    echo -e "  ${D}ℹ  SonarQube not available (optional)${RS}"
fi

# Compiler process leak cleanup
./check-leaks.sh --cleanup >> "$LOG_FILE" 2>&1 && echo -e "  ${OK} Leaked compiler processes cleaned up" || true

# 1. Static analysis
run_task "Static Analysis" "npm run check"

# 2. Dead-code check (knip) — non-blocking, zeigt unused exports/types als Warnung
STEP=$((STEP+1))
echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] Dead-Code Check (knip)${RS}"
KNIP_OUT=$(npx knip 2>&1)
KNIP_EXIT=$?
if [ $KNIP_EXIT -eq 0 ]; then
    echo -e "  ${OK} Dead-Code Check                    no issues"
else
    KNIP_LINES=$(echo "$KNIP_OUT" | wc -l | tr -d ' ')
    echo -e "  ${WARN} Dead-Code Check                    ${KNIP_LINES} line(s) – see $LOG_FILE"
    echo "=== knip output ==" >> "$LOG_FILE"
    echo "$KNIP_OUT" >> "$LOG_FILE"
fi

# 3. Unit tests
run_task "Unit Tests" "NODE_OPTIONS='--no-warnings' npm run test:unit -- --reporter=default"
parse_test_results "Tests.*passed"

# 4. Real Arduino CLI integration tests, isolated from the fast unit gate
run_task "Toolchain Integration Tests" "NODE_OPTIONS='--no-warnings' npm run test:integration -- --reporter=default"
parse_test_results "Tests.*passed"

# 5+6. Sandbox image build & Docker tests (optional, requires Docker)
# Re-check Docker: heavy load can temporarily freeze the daemon after unit tests.
DOCKER_LOST=0
if [ "$DOCKER_AVAILABLE" -eq 1 ] && ! docker info >/dev/null 2>&1; then
    echo -e "  ${WARN} Docker unreachable after unit tests – Docker tests will be skipped"
    DOCKER_AVAILABLE=0
    DOCKER_LOST=1
fi

if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
    # Build sandbox image only if it does not exist yet
    if ! docker image inspect "$DOCKER_SANDBOX_IMAGE" > /dev/null 2>&1; then
        run_task "Sandbox Image Build" "docker build -f Dockerfile.sandbox -t $DOCKER_SANDBOX_IMAGE ."
    else
        STEP=$((STEP+1))
        echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] Sandbox Image Build${RS}"
        echo -e "  ${OK} Sandbox image already present – skipping build"
    fi

    run_task "Docker Tests (Timing/Pause/Sandbox/Flow)" \
        "DOCKER_SANDBOX_IMAGE=$DOCKER_SANDBOX_IMAGE npm run test:docker -- --reporter=default"
    parse_test_results "Tests.*passed"

    # Container cleanup after Docker tests: reduce load on Docker Desktop before E2E phase
    stale_after=$(find_sandbox_containers)
    if [ -n "$stale_after" ]; then
        echo "$stale_after" | xargs docker rm -f >/dev/null 2>&1
    fi
else
    [ "$DOCKER_LOST" -eq 0 ] && echo -e "  ${WARN} Docker not available – Docker tests skipped (Steps 5+6)"
    STEP=$((STEP+2))
fi

# --- SERVER START (unnumbered) ---
echo -e "\n${B}▸ [Pre-E2E] Server startup${RS}"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Docker-Gesundheitsprüfung: Docker Desktop auf macOS braucht nach Heavy-Load
# manchmal einige Sekunden bis der Daemon wieder stabil antwortet.
DOCKER_FOR_E2E=0
if [ "$DOCKER_AVAILABLE" -eq 1 ]; then
    for _i in {1..10}; do
        if docker info > /dev/null 2>&1; then
            DOCKER_FOR_E2E=1
            [ "$_i" -gt 1 ] && echo -e "  ${OK} Docker recovered after $((_i * 3))s"
            break
        fi
        [ "$_i" -eq 1 ] && echo -e "  ${RUN} Docker not responding – waiting for recovery (max. 30s)..."
        sleep 3
    done
fi

if [ "$DOCKER_FOR_E2E" -eq 0 ]; then
    echo -e "  ${WARN} Docker nicht verfügbar – E2E-Tests erfordern Docker-Sandbox"
    STEP=$((STEP+1))
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] E2E-Tests (Playwright)${RS}"
    echo -e "  ${WARN} Übersprungen – Docker nicht verfügbar (Sandbox benötigt)"
    STEP=$((STEP+1))
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] Post-Test Integrity Check${RS}"
    echo -e "  ${WARN} Übersprungen – kein E2E-Lauf"
else
    export PORT=3000
    echo -e "  ${OK} Docker available – E2E with sandbox support"
    export FORCE_DOCKER=1
    DOCKER_SANDBOX_IMAGE=$DOCKER_SANDBOX_IMAGE UNOSIM_SHARED_TEMP_DIR=$UNOSIM_SHARED_TEMP_DIR \
    DISABLE_COMPILE_GATEKEEPER=true DISABLE_RATE_LIMIT=true \
    VITE_DISABLE_HMR=true VITE_DISABLE_TOASTS=true \
    SANDBOX_POOL_MIN_RUNNERS=5 SANDBOX_POOL_MAX_RUNNERS=5 \
    NODE_ENV=development npm run dev >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!

    for i in {1..15}; do
        if curl -s http://localhost:3000 > /dev/null; then
            echo -e "    ${G}${OK} Server ready (PID $SERVER_PID)${RS}"
            break
        fi
        [ $i -eq 15 ] && echo -e "    ${R}${FAIL} Server startup timeout!${RS}" && exit 1
        sleep 1
    done

    # 7. E2E-Tests (Playwright)
    run_task "E2E-Tests (Playwright)" "npm run test:e2e -- --timeout 60000"
    parse_test_results "([0-9]+ passed|[0-9]+ failed|[0-9]+ skipped)"

    # 8. Post-test integrity check (leak detection after all tests)
    run_task "Post-Test Integrity Check" "./check-leaks.sh --cleanup"

    # Stop server before build
    cleanup
    SERVER_PID=""
fi

# 9. Production build
run_task "Production Build" "npm run build"

# 10. SonarQube Quality Gate Check
if [ -n "$SONAR_TOKEN" ] && curl -sf http://localhost:9000/api/system/status > /dev/null 2>&1; then
    STEP=$((STEP+1))
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] SonarQube Quality Gate${RS}"
    if ! command -v python3 >/dev/null 2>&1; then
        echo -e "    ${WARN} python3 not found – Quality Gate details unavailable"
        echo -e "    ${D}(informational — does not block pipeline)${RS}"
    else
        SQ_PROJECT_KEY="unosim"
        SQ_URL="http://localhost:9000"

        # Fetch quality gate status
        QG_JSON=$(curl -sf -H "Authorization: Bearer $SONAR_TOKEN" \
            "${SQ_URL}/api/qualitygates/project_status?projectKey=${SQ_PROJECT_KEY}" 2>/dev/null)

        if [ -n "$QG_JSON" ]; then
            QG_STATUS=$(echo "$QG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['projectStatus']['status'])" 2>/dev/null)

            echo -e "    Quality Gate: $([ "$QG_STATUS" = "OK" ] && echo "${G}${OK} PASSED${RS}" || echo "${R}${FAIL} $QG_STATUS${RS}")"

            # Display individual conditions
            echo "$QG_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d['projectStatus']['conditions']:
    status = c['status']
    metric = c['metricKey'].replace('new_', '').replace('_', ' ').title()
    actual = c['actualValue']
    threshold = c['errorThreshold']
    comp = c['comparator']
    icon = '✔' if status == 'OK' else '✘'
    unit = '%' if 'density' in c['metricKey'] or 'coverage' in c['metricKey'] or 'reviewed' in c['metricKey'] else ''
    print(f'      {icon} {metric}: {actual}{unit} (Threshold: {comp} {threshold}{unit})')
" 2>/dev/null

            # Fetch open issues count
            ISSUES_JSON=$(curl -sf -H "Authorization: Bearer $SONAR_TOKEN" \
                "${SQ_URL}/api/issues/search?componentKeys=${SQ_PROJECT_KEY}&statuses=OPEN&ps=1" 2>/dev/null)
            if [ -n "$ISSUES_JSON" ]; then
                ISSUE_COUNT=$(echo "$ISSUES_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['paging']['total'])" 2>/dev/null)
                echo -e "      Open Issues: ${ISSUE_COUNT:-?}"
            fi

            # Quality gate status is informational, not blocking
            echo -e "    ${D}(informational — does not block pipeline)${RS}"
        else
            echo -e "    ${WARN} Could not fetch quality gate status"
        fi
    fi
else
    STEP=$((STEP+1))
    echo -e "\n  ${WARN} SonarQube not available – Quality Gate check skipped (Step $STEP)"
fi

echo
div
printf "  ${G}${B}${OK} Pipeline completed successfully${RS}\n"
div
