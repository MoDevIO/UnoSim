#!/usr/bin/env bash
# check-leaks.sh
# Detects and optionally cleans up leaked compiler processes from Arduino sketch compilation.
# Targets: g++, cc1plus, arduino-cli, avr-gcc, avr-g++, avr-ld
#
# Usage:
#   ./check-leaks.sh              # Snapshot: list zombie compiler processes
#   ./check-leaks.sh --watch      # Watch mode: refresh every 5s, warn if leak persists
#   ./check-leaks.sh --cleanup    # Kill all matching processes (process-group kill)
#   ./check-leaks.sh --watch --cleanup  # Watch + auto-kill

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Processes to track (matched against the comm column, which is the base name)
readonly TARGETS=("g++" "cc1plus" "arduino-cli" "avr-gcc" "avr-g++" "avr-ld")

# A process is considered a "zombie" if it has been running for more than this
# many seconds. Compile jobs should never take longer than a few minutes.
readonly ZOMBIE_THRESHOLD_SEC=120  # 2 minutes

# Watch mode: interval between polls and the settle timeout
readonly WATCH_INTERVAL_SEC=5
readonly SETTLE_TIMEOUT_SEC=10     # warn if count > 0 for this long after a drop

# /dev/shm RAM-disk path used by the test workers
readonly SHM_TEMP_DIR="/dev/shm/unosim-temp"
# Warn when the directory exceeds this many megabytes
readonly SHM_WARN_MB=500

# ---------------------------------------------------------------------------
# Colour helpers (disabled when not a tty or NO_COLOR is set)
# ---------------------------------------------------------------------------

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; YELLOW=''; GREEN=''; CYAN=''; BOLD=''; RESET=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Build the grep pattern once so it can be reused
build_pattern() {
  local IFS='|'
  echo "^(${TARGETS[*]})$"
}

PATTERN="$(build_pattern)"

# Convert etime field (ps output) to seconds for comparison.
# ps etime format: [[DD-]HH:]MM:SS
etime_to_sec() {
  local etime="$1"
  local days=0 hours=0 mins=0 secs=0

  # Strip leading/trailing whitespace
  etime="${etime// /}"

  if [[ "$etime" =~ ^([0-9]+)-([0-9]+):([0-9]+):([0-9]+)$ ]]; then
    days="${BASH_REMATCH[1]}"; hours="${BASH_REMATCH[2]}"
    mins="${BASH_REMATCH[3]}";  secs="${BASH_REMATCH[4]}"
  elif [[ "$etime" =~ ^([0-9]+):([0-9]+):([0-9]+)$ ]]; then
    hours="${BASH_REMATCH[1]}"; mins="${BASH_REMATCH[2]}"; secs="${BASH_REMATCH[3]}"
  elif [[ "$etime" =~ ^([0-9]+):([0-9]+)$ ]]; then
    mins="${BASH_REMATCH[1]}"; secs="${BASH_REMATCH[2]}"
  fi

  echo $(( days*86400 + hours*3600 + mins*60 + secs ))
}

# Collect matching processes. Returns lines of:
#   PID PPID PGID COMM ETIME ARGS...
collect_procs() {
  # Use a temp variable to avoid set -e killing us when grep finds nothing
  local raw
  raw=$(ps -eo pid,ppid,pgid,comm,etime,args --no-headers 2>/dev/null || true)

  while IFS= read -r line; do
    # comm is field 4
    local comm
    comm=$(echo "$line" | awk '{print $4}')
    if [[ "$comm" =~ $PATTERN ]]; then
      echo "$line"
    fi
  done <<< "$raw"
}

# Pretty-print a process list with zombie highlighting
print_procs() {
  local procs="$1"
  if [[ -z "$procs" ]]; then
    echo -e "  ${GREEN}No matching compiler processes found.${RESET}"
    return
  fi

  printf "  ${BOLD}%-8s %-8s %-8s %-12s %-12s %s${RESET}\n" \
    "PID" "PPID" "PGID" "COMM" "ETIME" "ARGS"
  printf "  %s\n" "$(printf '%.0s-' {1..80})"

  while IFS= read -r line; do
    local pid ppid pgid comm etime
    pid=$(echo "$line"   | awk '{print $1}')
    ppid=$(echo "$line"  | awk '{print $2}')
    pgid=$(echo "$line"  | awk '{print $3}')
    comm=$(echo "$line"  | awk '{print $4}')
    etime=$(echo "$line" | awk '{print $5}')
    local args
    args=$(echo "$line"  | awk '{for(i=6;i<=NF;i++) printf "%s ", $i; print ""}')

    local age_sec
    age_sec=$(etime_to_sec "$etime")

    if (( age_sec >= ZOMBIE_THRESHOLD_SEC )); then
      printf "  ${RED}%-8s %-8s %-8s %-12s %-12s %s${RESET}\n" \
        "$pid" "$ppid" "$pgid" "$comm" "$etime" "$args"
    else
      printf "  ${YELLOW}%-8s %-8s %-8s %-12s %-12s %s${RESET}\n" \
        "$pid" "$ppid" "$pgid" "$comm" "$etime" "$args"
    fi
  done <<< "$procs"
}

# Kill all processes in the list using process-group kill (-PGID).
# Falls back to killing the PID directly if the group kill fails.
kill_procs() {
  local procs="$1"
  if [[ -z "$procs" ]]; then
    return 0
  fi

  # Collect unique PGIDs first to avoid sending the signal multiple times
  local -A seen_pgids
  while IFS= read -r line; do
    local pid pgid
    pid=$(echo "$line"  | awk '{print $1}')
    pgid=$(echo "$line" | awk '{print $3}')

    if [[ -n "${seen_pgids[$pgid]+_}" ]]; then
      continue
    fi
    seen_pgids[$pgid]=1

    if (( pgid > 1 )); then
      if kill -0 -"$pgid" 2>/dev/null; then
        echo -e "  ${RED}[KILL]${RESET} kill -9 -${pgid}  (process group, comm=$(echo "$line" | awk '{print $4}'), pid=$pid)"
        kill -9 -"$pgid" 2>/dev/null || true
      fi
    else
      # Fallback: kill just this PID if PGID is 1 (init's group – very unlikely)
      echo -e "  ${YELLOW}[KILL-FALLBACK]${RESET} kill -9 $pid  (PGID=1, direct kill)"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done <<< "$procs"
}

# Count non-empty lines
count_procs() {
  local procs="$1"
  if [[ -z "$procs" ]]; then echo 0; return; fi
  echo "$procs" | grep -c '[^[:space:]]' || echo 0
}

# ---------------------------------------------------------------------------
# /dev/shm size check
# ---------------------------------------------------------------------------

# Emit a warning (or error) if the unosim-temp directory on the RAM-disk
# has grown beyond SHM_WARN_MB megabytes.  Returns exit-code 1 when the
# threshold is exceeded so callers can propagate the failure.
check_devshm() {
  if [[ ! -d "$SHM_TEMP_DIR" ]]; then
    echo -e "  ${CYAN}[/dev/shm]${RESET} ${SHM_TEMP_DIR} does not exist — nothing to check."
    return 0
  fi

  # du is available on both Linux and macOS; -sm gives total in MB
  local size_mb
  size_mb=$(du -sm "$SHM_TEMP_DIR" 2>/dev/null | awk '{print $1}' || echo 0)

  if (( size_mb >= SHM_WARN_MB )); then
    echo -e "  ${RED}[/dev/shm] WARNING: ${SHM_TEMP_DIR} is ${size_mb} MB (threshold: ${SHM_WARN_MB} MB).${RESET}"
    echo -e "  ${RED}           A full RAM-disk will cause CI crashes and spurious compile failures.${RESET}"
    # List the 10 largest subdirectories to help identify which worker leaked
    echo -e "  ${YELLOW}  Top 10 largest sub-directories:${RESET}"
    du -sm "${SHM_TEMP_DIR}/"* 2>/dev/null \
      | sort -rn \
      | head -10 \
      | while IFS= read -r line; do echo "    $line"; done
    return 1
  elif (( size_mb >= SHM_WARN_MB / 2 )); then
    echo -e "  ${YELLOW}[/dev/shm] NOTICE: ${SHM_TEMP_DIR} is ${size_mb} MB (${SHM_WARN_MB} MB threshold).${RESET}"
    echo -e "  ${YELLOW}           Usage is above 50 %% of the warning threshold.${RESET}"
    return 0
  else
    echo -e "  ${GREEN}[/dev/shm] ${SHM_TEMP_DIR} is ${size_mb} MB — OK.${RESET}"
    return 0
  fi
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

mode_snapshot() {
  local do_cleanup="${1:-false}"

  echo -e "\n${BOLD}${CYAN}=== Compiler Process Leak Check ===${RESET}"
  echo -e "  Targets: ${TARGETS[*]}"
  echo -e "  Zombie threshold: ${ZOMBIE_THRESHOLD_SEC}s"
  echo -e "  RAM-disk path   : ${SHM_TEMP_DIR} (warn at ${SHM_WARN_MB} MB)\n"

  # RAM-disk size check — runs before process detection so a near-full disk
  # is visible at the top of the output even when there are no leaked procs.
  local shm_ok=0
  check_devshm || shm_ok=1

  local procs
  procs=$(collect_procs)
  local count
  count=$(count_procs "$procs")

  echo -e "${BOLD}Active compiler processes (${count}):${RESET}"
  print_procs "$procs"

  if [[ "$do_cleanup" == "true" && -n "$procs" ]]; then
    echo -e "\n${BOLD}Cleanup requested — killing all found processes:${RESET}"
    kill_procs "$procs"

    # Give the OS a moment to reap
    sleep 1

    local procs_after
    procs_after=$(collect_procs)
    local count_after
    count_after=$(count_procs "$procs_after")

    echo -e "\n${BOLD}Post-cleanup check (${count_after} remaining):${RESET}"
    print_procs "$procs_after"

    if (( count_after > 0 )); then
      echo -e "\n${RED}[FAIL] ${count_after} process(es) still alive after cleanup.${RESET}"
      exit 1
    else
      echo -e "\n${GREEN}[OK] All compiler processes terminated.${RESET}"
    fi
  elif (( count > 0 )); then
    # Count zombies (>= threshold)
    local zombie_count=0
    while IFS= read -r line; do
      local etime
      etime=$(echo "$line" | awk '{print $5}')
      local age
      age=$(etime_to_sec "$etime")
      if (( age >= ZOMBIE_THRESHOLD_SEC )); then
        (( zombie_count++ )) || true
      fi
    done <<< "$procs"

    if (( zombie_count > 0 )); then
      echo -e "\n${RED}[FAIL] ${zombie_count} zombie process(es) running >${ZOMBIE_THRESHOLD_SEC}s detected.${RESET}"
      exit 1
    else
      echo -e "\n${YELLOW}[WARN] ${count} short-lived compiler process(es) found (may be normal during a build).${RESET}"
      # Short-lived processes during an active build are not failures
    fi
  else
    echo -e "\n${GREEN}[OK] No leaked compiler processes.${RESET}"
  fi

  # Propagate RAM-disk failure after the process summary
  if (( shm_ok != 0 )); then
    exit 1
  fi
}

mode_watch() {
  local do_cleanup="${1:-false}"

  echo -e "\n${BOLD}${CYAN}=== Compiler Process Watch Mode ===${RESET}"
  echo -e "  Poll interval : ${WATCH_INTERVAL_SEC}s"
  echo -e "  Settle timeout: ${SETTLE_TIMEOUT_SEC}s"
  echo -e "  RAM-disk path : ${SHM_TEMP_DIR} (warn at ${SHM_WARN_MB} MB)"
  echo -e "  Press Ctrl+C to stop.\n"

  # Check RAM-disk once on entry; in watch mode we don't poll it every tick
  # to keep the output readable.  The teardown / snapshot mode does the
  # authoritative check at the end of a test run.
  check_devshm || true

  local prev_count=0
  local nonzero_since=0   # epoch second when count last went from 0 to >0
  local iteration=0

  while true; do
    (( iteration++ )) || true
    local ts
    ts=$(date '+%H:%M:%S')

    local procs
    procs=$(collect_procs)
    local count
    count=$(count_procs "$procs")

    # Detect rising edge (new compiler processes appeared)
    if (( prev_count == 0 && count > 0 )); then
      nonzero_since=$(date +%s)
    fi

    # Settle-timeout warning: count > 0 for longer than SETTLE_TIMEOUT_SEC
    local warn_settle=false
    if (( count > 0 && nonzero_since > 0 )); then
      local now
      now=$(date +%s)
      if (( now - nonzero_since >= SETTLE_TIMEOUT_SEC )); then
        warn_settle=true
      fi
    fi

    # Reset when count drops back to zero
    if (( count == 0 )); then
      nonzero_since=0
    fi

    # Clear line and print status
    if (( iteration > 1 )); then
      # Move cursor up: header line + table rows from previous iteration
      local lines_up=$(( prev_count + 4 ))
      printf '\033[%dA\033[J' "$lines_up"
    fi

    if [[ "$warn_settle" == "true" ]]; then
      echo -e "${RED}[${ts}] WARNING: ${count} compiler process(es) alive for >${SETTLE_TIMEOUT_SEC}s — possible leak!${RESET}"
    elif (( count > 0 )); then
      echo -e "${YELLOW}[${ts}] ${count} compiler process(es) running…${RESET}"
    else
      echo -e "${GREEN}[${ts}] No compiler processes — clean.${RESET}"
    fi

    print_procs "$procs"
    echo ""  # spacer for cursor-up calculation

    if [[ "$do_cleanup" == "true" && -n "$procs" ]]; then
      echo -e "  ${RED}[AUTO-CLEANUP]${RESET} killing leaked processes…"
      kill_procs "$procs"
    fi

    prev_count=$count
    sleep "$WATCH_INTERVAL_SEC"
  done
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

OPT_WATCH=false
OPT_CLEANUP=false

for arg in "$@"; do
  case "$arg" in
    --watch)   OPT_WATCH=true   ;;
    --cleanup) OPT_CLEANUP=true ;;
    --help|-h)
      echo "Usage: $0 [--watch] [--cleanup]"
      echo ""
      echo "  (no flags)  Snapshot: list active compiler processes and exit"
      echo "  --watch     Poll every ${WATCH_INTERVAL_SEC}s; warn if processes linger"
      echo "  --cleanup   Kill all found processes via process-group kill (-9 -PGID)"
      echo ""
      echo "RAM-disk check:"
      echo "  Checks ${SHM_TEMP_DIR} size on every run."
      echo "  Warns at $((SHM_WARN_MB / 2)) MB, fails at ${SHM_WARN_MB} MB."
      echo ""
      echo "Exit codes:"
      echo "  0  No leaked/zombie processes and RAM-disk below threshold"
      echo "  1  Leaked/zombie processes found OR RAM-disk above threshold (CI failure)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg  (use --help for usage)" >&2
      exit 2
      ;;
  esac
done

if [[ "$OPT_WATCH" == "true" ]]; then
  mode_watch "$OPT_CLEANUP"
else
  mode_snapshot "$OPT_CLEANUP"
fi
