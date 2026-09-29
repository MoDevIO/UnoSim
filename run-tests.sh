#!/bin/bash

# ─────────────────────────────────────────────────────────────────
# UnoSim Test & Build Pipeline (Stability & Resource Guard)
# ─────────────────────────────────────────────────────────────────

# Konfiguration
LOG_FILE="run-tests_output.log"
TOTAL_STEPS=11
STEP=0
SERVER_PID=""
REQUIRE_RELEASE_GATE="${REQUIRE_RELEASE_GATE:-0}"

# Policy: Standard Log-Level für die Pipeline ist ERROR (1)
export LOG_LEVEL=1 
export NODE_ENV=test
# Keep the test pipeline on the supported local profile and prevent removed
# shell-level mode selectors from leaking into Vitest or later pipeline steps.
unset UNOSIM_SIMULATION_MODE UNOSIM_TRUST_MODE FORCE_DOCKER \
    UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL UNOSIM_DOCKER_TEST_BYPASS_GATEWAY
export UNOSIM_SERVER_MODE=local

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
    local label=$1 cmd=$2 note=${3:-}
    STEP=$((STEP+1))
    local start=$(date +%s)
    
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] $label${RS}"
    [ -n "$note" ] && echo -e "  $note"
    
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
EXPECTED_NODE=""
if [ -f ".nvmrc" ]; then
    EXPECTED_NODE=$(tr -d '[:space:]' < .nvmrc)
fi
ACTUAL_NODE=$(node -p 'process.versions.node')
if [ -n "$EXPECTED_NODE" ] && [ "$ACTUAL_NODE" != "$EXPECTED_NODE" ]; then
    echo -e "  ${FAIL} Node.js v${ACTUAL_NODE} (repository requires v${EXPECTED_NODE}; run: nvm use)"
    exit 1
fi
echo -e "  ${OK} Node.js v${ACTUAL_NODE}"

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

# 2. Dead-code check (knip) — known findings are tracked in a reviewed baseline
STEP=$((STEP+1))
echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] Dead-Code Check (knip)${RS}"
KNIP_BASELINE_FILE="${KNIP_BASELINE_FILE:-quality/knip-baseline.txt}"
KNIP_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/unosim-knip.XXXXXX")
if [ $? -ne 0 ] || [ -z "$KNIP_TMP_DIR" ] || [ ! -d "$KNIP_TMP_DIR" ]; then
    echo -e "  ${FAIL} Dead-Code Check                    FAIL: could not create scratch directory"
    exit 1
fi

knip_gate_fail() {
    echo -e "  ${FAIL} Dead-Code Check                    FAIL: $1"
    rm -rf "$KNIP_TMP_DIR"
    exit 1
}

if [ ! -f "$KNIP_BASELINE_FILE" ] || [ ! -r "$KNIP_BASELINE_FILE" ]; then
    knip_gate_fail "baseline missing or unreadable: $KNIP_BASELINE_FILE"
fi

# Baseline records are data, never generated or updated by this pipeline.
if ! awk -v errors="$KNIP_TMP_DIR/baseline-errors" '
    function trim(value) {
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        return value
    }
    function valid_path(path) {
        return path ~ /^([[:alnum:]_.-]+\/)+[[:alnum:]_.-]+$/ && path !~ /(^|\/)\.\.?($|\/)/
    }
    function valid_record(category, detail, fields, field_count) {
        field_count = split(detail, fields, " ")
        if (field_count < 2 || !valid_path(fields[field_count])) return 0

        if (category == "Unused exports") {
            if (field_count != 2 && field_count != 3) return 0
            return field_count == 2 || fields[2] ~ /^[[:alpha:]_][[:alnum:]_-]*$/
        }
        if (category == "Unused exported types") {
            return field_count == 3 && fields[2] == "type"
        }
        if (category == "Duplicate exports") {
            if (field_count != 2 || fields[1] !~ /^[^|]+\|[^|]+$/) return 0
            return 1
        }
        return 0
    }
    {
        original = $0
        sub(/\r$/, "", original)
        line = trim(original)
        if (line == "" || line ~ /^#/) next

        normalized = line
        gsub(/[[:space:]]+/, " ", normalized)
        delimiter = index(line, " :: ")
        category = substr(line, 1, delimiter - 1)
        detail = substr(line, delimiter + 4)
        if (delimiter < 2 || delimiter + 4 > length(line) || normalized != line ||
            line ~ /:[0-9]+:[0-9]+$/ || !valid_record(category, detail)) {
            print NR ": " original >> errors
            invalid = 1
            next
        }
        print line
        records++
    }
    END {
        if (records == 0) {
            print "baseline contains no finding records" >> errors
            invalid = 1
        }
        if (invalid) exit 1
    }
' "$KNIP_BASELINE_FILE" > "$KNIP_TMP_DIR/baseline.raw"; then
    if [ -s "$KNIP_TMP_DIR/baseline-errors" ]; then
        sed 's/^/    /' "$KNIP_TMP_DIR/baseline-errors"
    fi
    knip_gate_fail "invalid baseline: $KNIP_BASELINE_FILE"
fi

LC_ALL=C sort -u "$KNIP_TMP_DIR/baseline.raw" > "$KNIP_TMP_DIR/baseline.sorted"
KNIP_BASELINE_COUNT=$(wc -l < "$KNIP_TMP_DIR/baseline.raw" | tr -d '[:space:]')
KNIP_BASELINE_UNIQUE_COUNT=$(wc -l < "$KNIP_TMP_DIR/baseline.sorted" | tr -d '[:space:]')
if [ "$KNIP_BASELINE_COUNT" -ne "$KNIP_BASELINE_UNIQUE_COUNT" ]; then
    knip_gate_fail "duplicate finding records in baseline: $KNIP_BASELINE_FILE"
fi

KNIP_OUT=$(npx knip 2>&1)
KNIP_EXIT=$?
if [ -n "$KNIP_OUT" ] || [ "$KNIP_EXIT" -ne 0 ]; then
    printf '=== knip output (exit %s) ===\n' "$KNIP_EXIT" >> "$LOG_FILE"
    if [ -n "$KNIP_OUT" ]; then
        printf '%s\n' "$KNIP_OUT" >> "$LOG_FILE"
    fi
fi

# Convert each Knip section into a stable record, independent of line/column
# positions and terminal alignment. Unrecognized output fails closed.
: > "$KNIP_TMP_DIR/current.raw"
if ! awk -v records="$KNIP_TMP_DIR/current.raw" -v errors="$KNIP_TMP_DIR/parse-errors" '
    function trim(value) {
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        return value
    }
    function valid_path(path) {
        return path ~ /^([[:alnum:]_.-]+\/)+[[:alnum:]_.-]+$/ && path !~ /(^|\/)\.\.?($|\/)/
    }
    function valid_record(category, detail, fields, field_count) {
        field_count = split(detail, fields, " ")
        if (field_count < 2 || !valid_path(fields[field_count])) return 0

        if (category == "Unused exports") {
            if (field_count != 2 && field_count != 3) return 0
            return field_count == 2 || fields[2] ~ /^[[:alpha:]_][[:alnum:]_-]*$/
        }
        if (category == "Unused exported types") {
            return field_count == 3 && fields[2] == "type"
        }
        if (category == "Duplicate exports") {
            if (field_count != 2 || fields[1] !~ /^[^|]+\|[^|]+$/) return 0
            return 1
        }
        return 0
    }
    function fail(message) {
        print message >> errors
        invalid = 1
    }
    {
        original = $0
        sub(/\r$/, "", original)
        line = trim(original)
        if (line == "") next
        nonempty++

        if (line ~ /^.+ \([0-9]+\)$/) {
            category = line
            sub(/ \([0-9]+\)$/, "", category)
            count = line
            sub(/^.* \(/, "", count)
            sub(/\)$/, "", count)
            if (category != "Unused exports" && category != "Unused exported types" && category != "Duplicate exports") {
                fail("unrecognized section heading: " line)
            }
            if (category == "" || seen[category]++) {
                fail("invalid or duplicate section heading: " line)
            }
            section = category
            expected[category] = count + 0
            sections++
            next
        }

        if (section == "") {
            fail("unclassified Knip output: " line)
            gsub(/[[:space:]]+/, " ", line)
            print "__UNCLASSIFIED__ :: " line >> records
            next
        }

        finding = line
        sub(/:[0-9]+:[0-9]+$/, "", finding)
        finding = trim(finding)
        gsub(/[[:space:]]+/, " ", finding)
        if (!valid_record(section, finding)) {
            fail("malformed finding in section " section ": " finding)
            next
        }
        print section " :: " finding >> records
        actual[section]++
        findings++
    }
    END {
        for (category in expected) {
            if (actual[category] != expected[category]) {
                fail("section " category " declared " expected[category] " finding(s), parsed " (actual[category] + 0))
            }
        }
        if (nonempty > 0 && sections == 0) {
            fail("Knip output has no parseable section headings")
        }
        if (invalid) exit 1
    }
' <<< "$KNIP_OUT"; then
    if [ -s "$KNIP_TMP_DIR/parse-errors" ]; then
        sed 's/^/    /' "$KNIP_TMP_DIR/parse-errors"
    fi
    knip_gate_fail "Knip output was not fully interpretable; see $LOG_FILE"
fi

LC_ALL=C sort -u "$KNIP_TMP_DIR/current.raw" > "$KNIP_TMP_DIR/current.sorted"
KNIP_CURRENT_COUNT=$(wc -l < "$KNIP_TMP_DIR/current.raw" | tr -d '[:space:]')
KNIP_CURRENT_UNIQUE_COUNT=$(wc -l < "$KNIP_TMP_DIR/current.sorted" | tr -d '[:space:]')
if [ "$KNIP_CURRENT_COUNT" -ne "$KNIP_CURRENT_UNIQUE_COUNT" ]; then
    knip_gate_fail "duplicate normalized Knip findings; see $LOG_FILE"
fi
if { [ "$KNIP_EXIT" -eq 0 ] && [ "$KNIP_CURRENT_COUNT" -ne 0 ]; } || \
   { [ "$KNIP_EXIT" -ne 0 ] && [ "$KNIP_CURRENT_COUNT" -eq 0 ]; } || \
   [ "$KNIP_EXIT" -gt 1 ]; then
    knip_gate_fail "Knip exited with status $KNIP_EXIT inconsistent with parsed findings; see $LOG_FILE"
fi

LC_ALL=C comm -23 "$KNIP_TMP_DIR/current.sorted" "$KNIP_TMP_DIR/baseline.sorted" > "$KNIP_TMP_DIR/new"
LC_ALL=C comm -12 "$KNIP_TMP_DIR/current.sorted" "$KNIP_TMP_DIR/baseline.sorted" > "$KNIP_TMP_DIR/known"
LC_ALL=C comm -13 "$KNIP_TMP_DIR/current.sorted" "$KNIP_TMP_DIR/baseline.sorted" > "$KNIP_TMP_DIR/resolved"
KNIP_NEW_COUNT=$(wc -l < "$KNIP_TMP_DIR/new" | tr -d '[:space:]')
KNIP_KNOWN_COUNT=$(wc -l < "$KNIP_TMP_DIR/known" | tr -d '[:space:]')
KNIP_RESOLVED_COUNT=$(wc -l < "$KNIP_TMP_DIR/resolved" | tr -d '[:space:]')

if [ "$KNIP_NEW_COUNT" -gt 0 ]; then
    echo -e "  ${FAIL} Dead-Code Check                    $KNIP_NEW_COUNT new finding(s)"
    echo "    Known baseline: $KNIP_KNOWN_COUNT"
    echo "    New findings:"
    sed 's/^/      ✘ /' "$KNIP_TMP_DIR/new"
    printf '=== normalized new knip findings ===\n' >> "$LOG_FILE"
    cat "$KNIP_TMP_DIR/new" >> "$LOG_FILE"
    rm -rf "$KNIP_TMP_DIR"
    exit 1
fi

echo -e "  ${OK} Dead-Code Check                    new: 0, baseline: $KNIP_KNOWN_COUNT, resolved: $KNIP_RESOLVED_COUNT"
if [ "$KNIP_RESOLVED_COUNT" -gt 0 ]; then
    echo -e "    ${OK} Baseline improved: $KNIP_RESOLVED_COUNT known finding(s) resolved"
fi
rm -rf "$KNIP_TMP_DIR"

# 3. Unit tests and complete coverage report for the SonarQube scan
run_task "Unit Tests" "NODE_OPTIONS='--no-warnings' npm run test:coverage"
parse_test_results "Tests.*passed"

# 4. Real Arduino CLI integration tests, isolated from the fast unit gate
HEAVY_TEST_ENV="RUN_HEAVY_TESTS=${RUN_HEAVY_TESTS:-0}"
if [ "${RUN_HEAVY_TESTS:-0}" = "1" ] || [ "${RUN_HEAVY_TESTS:-0}" = "true" ]; then
    HEAVY_TEST_NOTE="${OK} Heavy stress tests enabled"
else
    HEAVY_TEST_NOTE="${D} Heavy stress tests disabled (use RUN_HEAVY_TESTS=1)${RS}"
fi
run_task "Toolchain Integration Tests" "$HEAVY_TEST_ENV NODE_OPTIONS='--no-warnings' npm run test:integration -- --reporter=default" "$HEAVY_TEST_NOTE"
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
  if [ "$REQUIRE_RELEASE_GATE" = "1" ]; then
    echo -e "  ${FAIL} Release-Gate requires Docker for mandatory Docker tests"
    exit 1
  fi
  STEP=$((STEP+2))
fi

# 7. Local-development E2E path. Playwright starts and stops npm run dev:e2e.
run_task "E2E-Tests (Playwright)" "npm run test:e2e -- --timeout 60000"
parse_test_results "([0-9]+ passed|[0-9]+ failed|[0-9]+ skipped)"

# 8. Post-test integrity check (leak detection after all tests)
run_task "Post-Test Integrity Check" "./check-leaks.sh --cleanup"

# 9. Production build
run_task "Production Build" "NODE_ENV=production npm run build"

# 10. Security audit
run_task "Security Audit" "npm audit --audit-level=high --omit=dev"

# 11. SonarQube Quality Gate Check
if [ -n "$SONAR_TOKEN" ] && curl -sf http://localhost:9000/api/system/status > /dev/null 2>&1; then
    STEP=$((STEP+1))
    echo -e "\n${B}▸ [$STEP/$TOTAL_STEPS] SonarQube Quality Gate${RS}"
    if [ "$REQUIRE_RELEASE_GATE" = "1" ]; then
        run_task "SonarQube Analysis" "npm run sonar"
    fi
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

            if [ "$REQUIRE_RELEASE_GATE" = "1" ] && [ "$QG_STATUS" != "OK" ]; then
                echo -e "    ${FAIL} Release-Gate blocked by SonarQube Quality Gate"
                exit 1
            fi
        else
            echo -e "    ${WARN} Could not fetch quality gate status"
            [ "$REQUIRE_RELEASE_GATE" = "1" ] && exit 1
        fi
    fi
else
  STEP=$((STEP+1))
  echo -e "\n  ${WARN} SonarQube not available – Quality Gate check skipped (Step $STEP)"
  if [ "$REQUIRE_RELEASE_GATE" = "1" ]; then
    echo -e "  ${FAIL} Release-Gate requires reachable SonarQube and SONAR_TOKEN"
    exit 1
  fi
fi

echo
div
printf "  ${G}${B}${OK} Pipeline completed successfully${RS}\n"
div
