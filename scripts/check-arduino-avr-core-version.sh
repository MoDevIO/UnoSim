#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/arduino-avr-core-version"

INSTALLED_VERSIONS="$(arduino-cli core list | awk '$1 == "arduino:avr" { print $2 }')"
if ! printf '%s\n' "$INSTALLED_VERSIONS" | grep -Fxq "$ARDUINO_AVR_CORE_VERSION"; then
  FOUND_VERSION="${INSTALLED_VERSIONS:-none}"
  echo "Expected arduino:avr ${ARDUINO_AVR_CORE_VERSION}; found ${FOUND_VERSION}" >&2
  exit 1
fi

echo "Verified arduino:avr ${ARDUINO_AVR_CORE_VERSION}"
