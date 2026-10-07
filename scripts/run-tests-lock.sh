#!/bin/bash
# Single-instance lock for run-tests.sh (sourced, not executed).
#
# Two pipelines in one working directory delete each other's log, temp files, containers and
# port 3000, which shows up as random step failures. The lock is a directory (mkdir is atomic,
# macOS has no flock) holding the owner's PID. A lock whose owner is gone, or whose PID now
# belongs to an unrelated process, is stale and taken over.

run_tests_lock_acquire() {
    local dir=$1 owner command attempt
    for attempt in 1 2 3; do
        if mkdir "$dir" 2>/dev/null; then
            echo "$$" > "$dir/pid"
            return 0
        fi
        owner=$(cat "$dir/pid" 2>/dev/null)
        if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then
            command=$(ps -p "$owner" -o command= 2>/dev/null)
            if [[ "$command" == *run-tests* ]]; then
                echo "Another run-tests.sh is already running (PID $owner) in this directory." >&2
                echo "Two pipelines would delete each other's log, temp files, containers and port 3000." >&2
                echo "Wait for it to finish, or remove $dir only if you are sure it is stale." >&2
                return 1
            fi
        fi
        # Stale (no owner, dead owner, or reused PID) or half-created lock: take it over and retry.
        rm -rf "$dir"
    done
    echo "Could not acquire the run-tests.sh lock at $dir." >&2
    return 1
}

run_tests_lock_release() {
    local dir=$1
    [ "$(cat "$dir/pid" 2>/dev/null)" = "$$" ] && rm -rf "$dir"
    return 0
}
