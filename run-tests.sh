#!/bin/bash

# Konfiguration
LOG_FILE="run-tests_output.log"
TOTAL_STEPS=4
STEP=0

# Farben & Icons
G="\033[32m"; Y="\033[33m"; R="\033[31m"; C="\033[36m"; B="\033[1m"; D="\033[2m"; RS="\033[0m"
OK="${G}✔${RS}"; FAIL="${R}✘${RS}"; RUN="${Y}◌${RS}"; WARN="${Y}⚠${RS}"

div() { printf "${D}────────────────────────────────────────────────${RS}\n"; }

# Die Kern-Funktion mit Live-Counter
run_task() {
    local label=$1 cmd=$2 
    STEP=$((STEP+1))
    local start=$(date +%s)
    
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] $label${RS}"
    
    eval "$cmd" >> "$LOG_FILE" 2>&1 &
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
        printf "\r  %b %-35s ${R}FEHLER${RS}\n" "$FAIL" "$label"
        echo -e "  ${R}${FAIL} Abbruch: Siehe $LOG_FILE${RS}"
        exit 1
    fi
}

parse_test_results() {
    local pattern=$1
    local line=$(grep -E "$pattern" "$LOG_FILE" | tail -n 1)
    [ -z "$line" ] && return

    local p=$(echo "$line" | grep -oE "[0-9]+ passed" | cut -d' ' -f1 || echo "0")
    local f=$(echo "$line" | grep -oE "[0-9]+ failed" | cut -d' ' -f1 || echo "0")
    local s=$(echo "$line" | grep -oE "[0-9]+ skipped" | cut -d' ' -f1 || echo "0")

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
printf "  ${B}Test & Build Pipeline${RS} ${D}(Log: %s)${RS}\n" "$LOG_FILE"
div
rm -f "$LOG_FILE"

# 1. Statische Analyse
run_task "Statische Analyse" "npm run check && npm run check:raw-hex"
echo -e "    ${OK} Linting & Farb-Token Check abgeschlossen"

# 2. Unit-Tests
run_task "Unit-Tests & Coverage" "npm run test:coverage"
parse_test_results "Tests.*passed"
echo -e "    ${OK} Unit-Tests & Coverage abgeschlossen"

# 3. E2E-Tests
echo -e "    ${D}Reinige Ports & Cooldown...${RS}"
# zuerst sämtliche Prozesse auf Port 3000 abbrechen – falls der Server
# unberechtigt weiterläuft, führt das bei parallelen Tests zu Kollisionen.
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
for port in {3001..3005}; do
  lsof -ti:$port | xargs -r kill -9 2>/dev/null || true
done
pkill -f "tsx server/index.ts" 2>/dev/null || true

# WICHTIG: 5 Sekunden warten, damit der Server komplett herunterfährt
# und später frisch starten kann – besonders wichtig beim Wiederholen.
sleep 5

# Umgebungsvariablen setzen, damit Playwright eine gültige baseURL nutzt
export PORT=3000
export BASE_URL="http://localhost:3000"

# Starte E2E seriell mit eindeutiger Workerzahl
run_task "E2E-Tests" "npx playwright test --workers=1"
parse_test_results "([0-9]+ passed|[0-9]+ failed|[0-9]+ skipped)"
echo -e "    ${OK} E2E-Tests abgeschlossen"

# 4. Produktions-Build
run_task "Produktions-Build" "npm run build"
echo -e "    ${OK} Build abgeschlossen"

echo
div
printf "  ${G}${B}${OK} Pipeline erfolgreich abgeschlossen${RS}\n"
div