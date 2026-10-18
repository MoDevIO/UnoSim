#!/bin/sh
# Spike P0.5 – install ATTinyCore into an isolated arduino-cli data directory
# (the local Arduino installation stays untouched) and build the sketches.
# Usage: spikes/p0-5/build-sketches.sh <work-dir>
set -eu
WORK="$1"
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export ARDUINO_DIRECTORIES_DATA="$WORK/ard/data"
export ARDUINO_DIRECTORIES_DOWNLOADS="$WORK/ard/staging"
export ARDUINO_DIRECTORIES_USER="$WORK/ard/user"
export ARDUINO_BOARD_MANAGER_ADDITIONAL_URLS="https://drazzy.com/package_drazzy.com_index.json"
arduino-cli core update-index
arduino-cli core install ATTinyCore:avr@1.5.2
for dir in "$HERE"/sketches/*/; do
  name="$(basename "$dir")"
  arduino-cli compile --fqbn ATTinyCore:avr:attinyx5:chip=85,clock=8internal \
    --output-dir "$WORK/build/$name" "$dir"
done
