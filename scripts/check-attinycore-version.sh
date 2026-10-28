#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/attinycore-version"

INSTALLED_VERSIONS="$(arduino-cli core list | awk '$1 == "ATTinyCore:avr" { print $2 }')"
if ! printf '%s\n' "$INSTALLED_VERSIONS" | grep -Fxq "$ATTINYCORE_VERSION"; then
  FOUND_VERSION="${INSTALLED_VERSIONS:-none}"
  echo "Expected ATTinyCore:avr ${ATTINYCORE_VERSION}; found ${FOUND_VERSION}" >&2
  exit 1
fi

# The post-build hooks must be off (install-attinycore.sh): they write into the read-only sketch.
PLATFORM_DIR="$(arduino-cli config get directories.user)/hardware/ATTinyCore/avr"
if ! grep -Fxq "recipe.hooks.savehex.presavehex.5.pattern.linux=" "$PLATFORM_DIR/platform.local.txt" 2>/dev/null; then
  echo "ATTinyCore:avr ${ATTINYCORE_VERSION} lacks the UnoSim platform.local.txt; run scripts/install-attinycore.sh" >&2
  exit 1
fi

echo "Verified ATTinyCore:avr ${ATTINYCORE_VERSION}"
