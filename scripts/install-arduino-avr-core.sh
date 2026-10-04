#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/arduino-avr-core-version"

if ! sh "$SCRIPT_DIR/check-arduino-avr-core-version.sh" >/dev/null 2>&1; then
  arduino-cli core update-index
  arduino-cli core install "arduino:avr@${ARDUINO_AVR_CORE_VERSION}"
fi

sh "$SCRIPT_DIR/check-arduino-avr-core-version.sh"
