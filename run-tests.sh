#!/bin/bash

# Konfiguration
TIMEOUT_SECS=90
LOG_FILE="run-tests_output.log"
WORKERS=1

# UI / Styling
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
BOLD="\033[1m"
RESET="\033[0m"

TOTAL_STEPS=4
STEP=0

clear
echo "🛡️  Starte vollständigen System-Check & Build..."
rm -f "$LOG_FILE"

# Einfache Funktion für die Schritte
run_step() {
    local label="$1"
    local command="$2"
    STEP=$((STEP+1))

    # fixed layout: ICON [i/n] LABEL(40) STATUS
    local icon_run="⏳"
    printf "%s [%d/%d] %-40s" "$icon_run" "$STEP" "$TOTAL_STEPS" "$label"
    start_time=$(date +%s)

    if eval "$command" >> "$LOG_FILE" 2>&1; then
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        # overwrite line with success
        printf "\r${GREEN}✅${RESET} [%d/%d] %-40s %s (%ds)\n" "$STEP" "$TOTAL_STEPS" "$label" "OK" "$duration"
        return 0
    else
        printf "\r${RED}❌${RESET} [%d/%d] %-40s %s\n" "$STEP" "$TOTAL_STEPS" "$label" "FAILED"
        return 1
    fi
}

# Special runner for background E2E step with timeout and live countdown
run_e2e_step() {
    local label="$1"
    STEP=$((STEP+1))
    local icon_run="⏳"
    printf "%s [%d/%d] %-40s" "$icon_run" "$STEP" "$TOTAL_STEPS" "$label"
    start_time=$(date +%s)

    npm run test:e2e >> "$LOG_FILE" 2>&1 &
    local pid=$!

    for ((i=TIMEOUT_SECS; i>0; i--)); do
        if ! kill -0 $pid 2>/dev/null; then break; fi
        printf "\r%s [%d/%d] %-40s %s" "$icon_run" "$STEP" "$TOTAL_STEPS" "$label" "Running... ${i}s"
        sleep 1
    done

    if kill -0 $pid 2>/dev/null; then
        kill $pid
        printf "\r${RED}❌${RESET} [%d/%d] %-40s %s\n" "$STEP" "$TOTAL_STEPS" "$label" "TIMEOUT"
        return 1
    else
        wait $pid
        if [ $? -eq 0 ]; then
            end_time=$(date +%s)
            duration=$((end_time - start_time))
            printf "\r${GREEN}✅${RESET} [%d/%d] %-40s %s (%ds)\n" "$STEP" "$TOTAL_STEPS" "$label" "OK" "$duration"
            return 0
        else
            printf "\r${RED}❌${RESET} [%d/%d] %-40s %s\n" "$STEP" "$TOTAL_STEPS" "$label" "FAILED"
            return 1
        fi
    fi
}

# 1. Statische Analyse
run_step "Linting/Check" "npm run check" || { echo "🛑 Abbruch bei Check"; exit 1; }

# 2. Unit-Tests & Coverage
run_step "Unit-Tests & Coverage" "npm run test:coverage" || { 
    echo "${RED}🛑 Abbruch: Tests oder Coverage fehlgeschlagen.${RESET}"
    echo "👉 Tipp: Prüfe ob 'npm install -D @vitest/coverage-v8' ausgeführt wurde."
    exit 1 
}

# 3. E2E Tests
echo "🚀 Starte E2E-Tests (Parallel: $WORKERS Worker)..."

# Cleanup: Kill any existing dev servers on port 3000
if lsof -i :3000 >/dev/null 2>&1; then
    echo "🧹 Cleaning up port 3000..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

run_e2e_step "E2E-Tests" || { echo "${RED}🛑 Abbruch: E2E fehlgeschlagen${RESET}"; tail -n 20 "$LOG_FILE"; exit 1; }

# 4. Finaler Build
echo "🏗️  Tests bestanden. Starte Produktions-Build..."

run_step "Produktions-Build (Vite/Esbuild)" "npm run build" || {
    echo "🛑 Build fehlgeschlagen! Siehe $LOG_FILE"
    exit 1
}

echo "🎉 ALLES ERLEDIGT! System geprüft und erfolgreich gebaut."
echo -e "👉 Die Dateien befinden sich im ${BOLD}/dist${RESET} Ordner."

# 5. Quellcode-Statistik
echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"
echo "📊 Quellcode-Statistik (eigene Dateien):"
echo
# Aggregate into a temp file, then print sorted rows and a summary in MB
TMP_AGG=$(mktemp)
find ./src ./client ./server ./shared ./tests ./e2e \
    -type f \
    \( -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.css' -o -name '*.scss' -o -name '*.html' -o -name '*.md' -o -name '*.py' -o -name '*.java' -o -name '*.go' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' \) \
    -exec bash -c 'ext="${1##*.}"; lines=$(wc -l < "$1"); size=$(stat -f%z "$1"); printf "%s %d %d\n" "$ext" "$lines" "$size"' _ {} \; > "$TMP_AGG"

AGG_OUT=$(awk '{count[$1]++; loc[$1]+=$2; size[$1]+=$3; total_count++; total_loc+=$2; total_size+=$3} END {for (t in count) printf "%s %d %d %d\n", t, count[t], loc[t], size[t]; printf "__TOTAL__ %d %d %d\n", total_count, total_loc, total_size}' "$TMP_AGG")

# print header
echo "| Typ | Anzahl | LOC | Bytes |"
echo "|:----|------:|-----:|------:|"

# print sorted rows
printf "%s\n" "$AGG_OUT" | grep -v '^__TOTAL__' | sort | awk '{printf "| %-3s | %5d | %6d | %8d |\n", $1, $2, $3, $4}'

# print total
TOTAL_LINE=$(printf "%s\n" "$AGG_OUT" | grep '^__TOTAL__')
TOTAL_FILES=$(printf "%s" "$TOTAL_LINE" | awk '{print $2}')
TOTAL_LOC=$(printf "%s" "$TOTAL_LINE" | awk '{print $3}')
TOTAL_BYTES=$(printf "%s" "$TOTAL_LINE" | awk '{print $4}')
printf "\nSUMME:   %d Dateien, %d LOC, %.2f MB\n" "$TOTAL_FILES" "$TOTAL_LOC" "$(echo "$TOTAL_BYTES/1024/1024" | bc -l)"

rm -f "$TMP_AGG"
echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"