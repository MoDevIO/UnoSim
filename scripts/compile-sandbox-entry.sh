#!/bin/sh
# Entry point of the compile sandbox (plan P2.4, image Dockerfile.compile-sandbox).
#
#   unosim-compile <timeout-seconds> <arduino-cli compile arguments...>
#
# Compiles one sketch inside the container and prints one framed result on
# stdout, so the container never writes to the host: its only bind mount, the
# sketch, is read-only. arduino-cli's stderr passes through unchanged. Frame:
#
#   unosim-compile-result 1
#   exit <arduino-cli exit code; 137 after the time limit>
#   truncated <1 when arduino-cli's stdout exceeded the limit, else 0>
#   stdout <base64 of arduino-cli's stdout, at most STDOUT_LIMIT bytes>
#   file <name> <base64>        one line per *.hex and *.elf, only after exit 0
#   end
#
# A frame without `end` means the container itself was stopped.
set -u

STDOUT_LIMIT=8388608
timeout_seconds="$1"
shift

# The core of every catalog board is precompiled into the image (read-only).
# arduino-cli also writes its sketch build next to it, so it works on a copy in
# the tmpfs (spike P0.2: about 1 MB, saves the core build of about 200 ms).
cache=/tmp/build-cache
out=/tmp/out
cp -a "$HOME/.cache/arduino" "$cache" || exit 90

ARDUINO_BUILD_CACHE_PATH="$cache" timeout --signal=KILL "$timeout_seconds" \
  arduino-cli "$@" --output-dir "$out" >/tmp/cli-stdout
code=$?

size=$(wc -c </tmp/cli-stdout)
truncated=0
[ "$size" -gt "$STDOUT_LIMIT" ] && truncated=1

printf 'unosim-compile-result 1\n'
printf 'exit %s\n' "$code"
printf 'truncated %s\n' "$truncated"
printf 'stdout '
head -c "$STDOUT_LIMIT" /tmp/cli-stdout | base64 -w0
printf '\n'
if [ "$code" -eq 0 ]; then
  for file in "$out"/*.hex "$out"/*.elf; do
    # Regular files only: a link would point outside the build.
    if [ -f "$file" ] && [ ! -L "$file" ]; then
      printf 'file %s ' "$(basename "$file")"
      base64 -w0 "$file"
      printf '\n'
    fi
  done
fi
printf 'end\n'
