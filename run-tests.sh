#!/bin/bash

# ─────────────────────────────────────────────────────────────────
# UnoSim Test & Build Pipeline (Stability & Resource Guard)
# ─────────────────────────────────────────────────────────────────

# Konfiguration
LOG_FILE="run-tests_output.log"
TOTAL_STEPS=8
STEP=0
SERVER_PID=""

# Policy: Standard Log-Level für die Pipeline ist ERROR (1)
export LOG_LEVEL=1 
export NODE_ENV=test

# Docker-Konfiguration (überschreibbar per Umgebungsvariable)
# unix:// + absolute path = 3 slashes total; $HOME already starts with /
DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.docker/run/docker.sock}"
DOCKER_IMAGE="unosim:latest"
DOCKER_SANDBOX_IMAGE="${DOCKER_SANDBOX_IMAGE:-unosim-sandbox:latest}"
# Temp-Verzeichnis unter /Users/… damit Docker Desktop es per default mounten kann
UNOSIM_SHARED_TEMP_DIR="${UNOSIM_SHARED_TEMP_DIR:-$(pwd)/temp}"
export DOCKER_HOST DOCKER_SANDBOX_IMAGE UNOSIM_SHARED_TEMP_DIR

# Farben & Icons
G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; B="\033[1m"; D="\033[2m"; RS="\033[0m"
OK="${G}✔${RS}"; FAIL="${R}✘${RS}"; RUN="${Y}◌${RS}"; WARN="${Y}⚠${RS}"

div() { printf "${D}────────────────────────────────────────────────${RS}\n"; }

# Aufräum-Funktion bei Abbruch oder Ende
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null
    fi
    # Docker-Container aufräumen: alle laufenden unosim-Container stoppen und entfernen
    if docker info > /dev/null 2>&1; then
        local containers
        containers=$(docker ps -aq --filter "ancestor=$DOCKER_IMAGE" 2>/dev/null)
        if [ -n "$containers" ]; then
            echo "$containers" | xargs docker stop --time 5 > /dev/null 2>&1 || true
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
        echo -e "  ${R}${FAIL} Abbruch: Siehe $LOG_FILE${RS}"
        exit 1
    fi
}

parse_test_results() {
    local pattern=$1
    # Prüfe die letzten 30 Zeilen auf Zusammenfassungen
    local line=$(tail -n 30 "$LOG_FILE" | grep -E "$pattern" | tail -n 1)
    [ -z "$line" ] && return

    local p=$(echo "$line" | grep -oE "[0-9]+ passed" | head -n 1 | cut -d' ' -f1 || echo "0")
    local f=$(echo "$line" | grep -oE "[0-9]+ failed" | head -n 1 | cut -d' ' -f1 || echo "0")
    local s=$(echo "$line" | grep -oE "[0-9]+ skipped" | head -n 1 | cut -d' ' -f1 || echo "0")

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

# Pre-Flight: Altlasten bereinigen (kein nummerierter Schritt)
echo -e "\n${B}▸ [Pre-Flight] Cleanup leaked compiler processes${RS}"
./check-leaks.sh --cleanup >> "$LOG_FILE" 2>&1 && echo -e "  ${OK} Bereinigung abgeschlossen" || true

# 1. Statische Analyse
run_task "Statische Analyse" "npm run check"

# 2. Unit-Tests
run_task "Unit-Tests" "NODE_OPTIONS='--no-warnings' npm run test:fast -- --reporter=default --maxConcurrency=2"
parse_test_results "Tests.*passed"

# 4+5. Docker Image Build & Docker-Tests (optional, wenn Docker verfügbar)
if docker info > /dev/null 2>&1; then
    run_task "Docker Image Build" "docker build -t $DOCKER_IMAGE ."

    # Sandbox Image nur bauen wenn es noch nicht existiert
    if ! docker image inspect "$DOCKER_SANDBOX_IMAGE" > /dev/null 2>&1; then
        run_task "Sandbox Image Build" "docker build -f Dockerfile.sandbox -t $DOCKER_SANDBOX_IMAGE ."
    else
        STEP=$((STEP+1))
        echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] Sandbox Image Build${RS}"
        echo -e "  ${OK} Sandbox Image bereits vorhanden – wird übersprungen"
    fi

    run_task "Docker-Tests (Timing/Pause/Sandbox/Flow)" \
        "FORCE_DOCKER=1 DOCKER_SANDBOX_IMAGE=$DOCKER_SANDBOX_IMAGE SKIP_HEAVY_TESTS=false LOG_LEVEL=warn \
        npx vitest run --reporter=default --maxWorkers=1 \
        tests/server/timing-delay.test.ts \
        tests/server/pause-resume-timing.test.ts \
        tests/server/pause-resume-digitalread.test.ts \
        tests/integration/serial-flooding.test.ts \
        tests/integration/serial-flow.test.ts \
        tests/server/services/sandbox-lifecycle.integration.test.ts \
        tests/server/services/serial-backpressure.test.ts"
    parse_test_results "Tests.*passed"
else
    echo -e "  ${WARN} Docker nicht verfügbar – Docker-Tests werden übersprungen (Steps 4+5)"
    STEP=$((STEP+2))
fi

# --- VORBEREITUNG SERVER (Kein nummerierter Task) ---
echo -e "\n${B}▸ [Vorbereitung] Server-Start${RS}"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

export PORT=3000
# Server startet im Hintergrund (NODE_ENV=development für Vite-Snapshots)
# FORCE_DOCKER + DOCKER_SANDBOX_IMAGE werden gesetzt, wenn Docker verfügbar ist (s. oben)
if docker info > /dev/null 2>&1; then
    FORCE_DOCKER=1 DOCKER_SANDBOX_IMAGE=$DOCKER_SANDBOX_IMAGE UNOSIM_SHARED_TEMP_DIR=$UNOSIM_SHARED_TEMP_DIR NODE_ENV=development npm run dev >> "$LOG_FILE" 2>&1 &
else
    NODE_ENV=development npm run dev >> "$LOG_FILE" 2>&1 &
fi
SERVER_PID=$!

for i in {1..15}; do
    if curl -s http://localhost:3000 > /dev/null; then
        echo -e "    ${G}${OK} Server bereit (PID $SERVER_PID)${RS}"
        break
    fi
    [ $i -eq 15 ] && echo -e "    ${R}${FAIL} Server-Start Timeout!${RS}" && exit 1
    sleep 1
done

# 3. E2E-Tests (Playwright)
run_task "E2E-Tests (Playwright)" "npx playwright test --timeout 60000"
parse_test_results "([0-9]+ passed|[0-9]+ failed|[0-9]+ skipped)"

# 4. Post-Test Integrity Check (Leak-Detection nach allen Tests)
run_task "Post-Test Integrity Check" "./check-leaks.sh --cleanup"

# Server stoppen bevor der Build startet
cleanup
SERVER_PID=""

# 5. Produktions-Build
run_task "Produktions-Build" "npm run build"

# 6. SonarQube Quality Gate Check
if [ -n "$SONAR_TOKEN" ] && curl -sf http://localhost:9000/api/system/status > /dev/null 2>&1; then
    STEP=$((STEP+1))
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] SonarQube Quality Gate${RS}"
    
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
else
    STEP=$((STEP+1))
    echo -e "\n  ${WARN} SonarQube nicht verfügbar – Quality Gate Check übersprungen (Step $STEP)"
fi

echo
div
printf "  ${G}${B}${OK} Pipeline erfolgreich abgeschlossen${RS}\n"
div