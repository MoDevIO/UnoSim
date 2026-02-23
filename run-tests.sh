#!/bin/bash

# ─────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────
TIMEOUT_SECS=600
LOG_FILE="run-tests_output.log"
WORKERS=1

TOTAL_STEPS=5
STEP=0
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

ICO_OK="✔"
ICO_FAIL="✘"
ICO_RUN="◌"
ICO_INFO="›"
ICO_WARN="!"

div() { printf "${DIM}%s${RESET}\n" "────────────────────────────────────────────────"; }

section() {
    echo
    printf "${CYAN}${BOLD}  %s${RESET}\n" "$1"
    div
}

# ─────────────────────────────────────────────────────────────────
run_step() {
    local label="$1" command="$2" start dur
    STEP=$((STEP+1))
    printf " ${YELLOW}${ICO_RUN}${RESET} [%d/%d] %-40s" "$STEP" "$TOTAL_STEPS" "$label"
    start=$(date +%s)
    if eval "$command" >> "$LOG_FILE" 2>&1; then
        dur=$(( $(date +%s) - start ))
        printf "\r ${GREEN}${ICO_OK}${RESET} [%d/%d] %-40s ${DIM}%ds${RESET}\n" "$STEP" "$TOTAL_STEPS" "$label" "$dur"
    else
        printf "\r ${RED}${ICO_FAIL}${RESET} [%d/%d] %-40s ${RED}FAILED${RESET}\n" "$STEP" "$TOTAL_STEPS" "$label"
        return 1
    fi
}

run_e2e_step() {
    local label="$1" start dur pid
    STEP=$((STEP+1))
    printf " ${YELLOW}${ICO_RUN}${RESET} [%d/%d] %-40s" "$STEP" "$TOTAL_STEPS" "$label"
    start=$(date +%s)
    npm run test:e2e >> "$LOG_FILE" 2>&1 &
    pid=$!
    for ((i=TIMEOUT_SECS; i>0; i--)); do
        kill -0 "$pid" 2>/dev/null || break
        printf "\r ${YELLOW}${ICO_RUN}${RESET} [%d/%d] %-40s ${DIM}%ds${RESET}" "$STEP" "$TOTAL_STEPS" "$label" "$i"
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        printf "\r ${RED}${ICO_FAIL}${RESET} [%d/%d] %-40s ${RED}TIMEOUT${RESET}\n" "$STEP" "$TOTAL_STEPS" "$label"
        return 1
    fi
    wait "$pid"; local rc=$?
    dur=$(( $(date +%s) - start ))
    if [ $rc -eq 0 ]; then
        printf "\r ${GREEN}${ICO_OK}${RESET} [%d/%d] %-40s ${DIM}%ds${RESET}\n" "$STEP" "$TOTAL_STEPS" "$label" "$dur"
    else
        printf "\r ${RED}${ICO_FAIL}${RESET} [%d/%d] %-40s ${RED}FAILED${RESET}\n" "$STEP" "$TOTAL_STEPS" "$label"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────
# Codeanalyse
# ─────────────────────────────────────────────────────────────────
print_group() {
    local title="$1"; shift
    local dirs=("$@")
    local tmp total_loc=0 total_files=0

    tmp=$(mktemp)
    for d in "${dirs[@]}"; do
        [ -d "$d" ] || continue
        find "$d" -type f \( \
            -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" \
            -o -name "*.css" -o -name "*.scss" -o -name "*.html" \
            -o -name "*.py" -o -name "*.go" -o -name "*.c" \
            -o -name "*.cpp" -o -name "*.h" \
        \) | while read -r f; do
            loc=$(wc -l < "$f")
            printf "%d\t%s\n" "$loc" "${f#./}"
        done >> "$tmp"
    done

    sort -rn "$tmp" > "${tmp}.sorted"

    printf "\n  ${BOLD}${CYAN}%s${RESET}\n" "$title"
    printf "  ${DIM}%-55s %6s${RESET}\n" "Datei" "LOC"
    printf "  ${DIM}%s${RESET}\n" "$(printf '%.0s─' {1..62})"

    while IFS=$'\t' read -r loc file; do
        [ -z "$file" ] && continue
        printf "  %-55s %6d\n" "$file" "$loc"
        total_loc=$((total_loc + loc))
        total_files=$((total_files + 1))
    done < "${tmp}.sorted"

    printf "  ${DIM}%s${RESET}\n" "$(printf '%.0s─' {1..62})"
    printf "  ${BOLD}%-55s %6d${RESET}  ${DIM}(%d Dateien)${RESET}\n" "GESAMT" "$total_loc" "$total_files"
    rm -f "$tmp" "${tmp}.sorted"
}

print_code_analysis() {
    section "≡  Codeanalyse"
    print_group "Backend   (server / shared)"      ./server  ./shared
    print_group "Frontend  (client / e2e / tests)"  ./client  ./e2e  ./tests
    echo
    div
}

# ═════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════
clear
echo
div
printf "${BOLD}  System-Check & Build${RESET}   ${DIM}Log: %s${RESET}\n" "$LOG_FILE"
div
rm -f "$LOG_FILE"

# 1+2 – Statische Analyse
section "▸  Statische Analyse"
run_step "Linting / Check"   "npm run check"          || { printf " ${RED}${ICO_FAIL} Abbruch.${RESET}\n\n"; exit 1; }
run_step "Color-Token Check" "npm run check:raw-hex"   || { printf " ${RED}${ICO_FAIL} Abbruch.${RESET}\n\n"; exit 1; }

# 3 – Unit-Tests
section "▸  Unit-Tests & Coverage"
run_step "Unit-Tests & Coverage" "npm run test:coverage" || {
    printf " ${RED}${ICO_FAIL} Abbruch: Tests/Coverage fehlgeschlagen.${RESET}\n"
    printf " ${YELLOW}${ICO_WARN} Tipp: npm install -D @vitest/coverage-v8${RESET}\n\n"; exit 1
}
VSUM=$(grep "Test Files" "$LOG_FILE" | tail -n1)
[ -n "$VSUM" ] && printf "  ${DIM}%s${RESET}\n" "$VSUM"

# 4 – E2E
section "▸  E2E-Tests  (Workers: ${WORKERS})"
if lsof -i :3000 >/dev/null 2>&1; then
    printf " ${YELLOW}${ICO_WARN} Port 3000 belegt – bereinige...${RESET}\n"
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true; sleep 1
fi
run_e2e_step "E2E-Tests (Playwright)" || {
    printf " ${RED}${ICO_FAIL} Abbruch: E2E fehlgeschlagen.${RESET}\n\n"
    tail -n 20 "$LOG_FILE"; exit 1
}

# 5 – Build
section "▸  Produktions-Build"
run_step "Vite / Esbuild Build" "npm run build" || {
    printf " ${RED}${ICO_FAIL} Build fehlgeschlagen! Siehe %s${RESET}\n\n" "$LOG_FILE"; exit 1
}

# Ergebnis
echo
div
printf " ${GREEN}${BOLD}${ICO_OK}  Alles erledigt! Build-Artefakte: /dist${RESET}\n"
div

# Codeanalyse
print_code_analysis