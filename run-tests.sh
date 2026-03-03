#!/bin/bash

# Konfiguration
LOG_FILE="run-tests_output.log"
TOTAL_STEPS=5
STEP=0
SERVER_PID=""

# Farben & Icons
G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; B="\033[1m"; D="\033[2m"; RS="\033[0m"
OK="${G}✔${RS}"; FAIL="${R}✘${RS}"; RUN="${Y}◌${RS}"; WARN="${Y}⚠${RS}"

div() { printf "${D}────────────────────────────────────────────────${RS}\n"; }

# Aufräum-Funktion bei Abbruch oder Ende
cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null
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
    
    # set -o pipefail: Fehler in der Pipeline (npm) werden erkannt
    # grep -vE: Filtert massives Rauschen aus dem Log
    (set -o pipefail; eval "DEBUG=false $cmd" 2>&1 | grep -vE "SERIAL_EVENT|\[DEBUG\]|wrapper stderr" >> "$LOG_FILE") &
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

# 1. Statische Analyse
run_task "Statische Analyse" "npm run check && npm run check:raw-hex"

# 2. Unit-Tests & Coverage
run_task "Unit-Tests & Coverage" "NODE_OPTIONS='--no-warnings' npm run test:coverage -- --reporter=default --maxConcurrency=1"
parse_test_results "Tests.*passed"

# --- VORBEREITUNG SERVER (Kein nummerierter Task) ---
echo -e "\n${B}▸ [Vorbereitung] Server-Start${RS}"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

export NODE_ENV=test
export PORT=3000
DEBUG=false npm run dev >> "$LOG_FILE" 2>&1 &
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
run_task "E2E-Tests (Playwright)" "npx playwright test --workers=1"
parse_test_results "([0-9]+ passed|[0-9]+ failed|[0-9]+ skipped)"

# 4. Integration-Tests (Cache)
run_task "Cache-Optimization Tests" "npx vitest run tests/server/cache-optimization.test.ts --reporter=default"
parse_test_results "Tests.*passed"

# Server stoppen
cleanup
SERVER_PID=""

# 5. Produktions-Build
run_task "Produktions-Build" "npm run build"

echo
div
printf "  ${G}${B}${OK} Pipeline erfolgreich abgeschlossen${RS}\n"
div