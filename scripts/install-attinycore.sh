#!/bin/sh
# Installs the pinned ATTinyCore as a hardware platform of the arduino-cli
# sketchbook (<directories.user>/hardware/ATTinyCore/avr). Not through the board
# manager: that would also install micronucleus and avrdude, which UnoSim does
# not use, from hosts outside the pin. The core compiles with the avr-gcc of
# arduino:avr, which must be installed first (install-arduino-avr-core.sh).
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/attinycore-version"

if sh "$SCRIPT_DIR/check-attinycore-version.sh" >/dev/null 2>&1; then
  sh "$SCRIPT_DIR/check-attinycore-version.sh"
  exit 0
fi

USER_DIR="$(arduino-cli config get directories.user)"
TARGET="$USER_DIR/hardware/ATTinyCore/avr"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ARCHIVE="$WORK_DIR/ATTinyCore.tar.bz2"

curl -fsSL "$ATTINYCORE_ARCHIVE_URL" -o "$ARCHIVE"
if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "$ATTINYCORE_ARCHIVE_SHA256" "$ARCHIVE" | sha256sum -c -
else
  printf '%s  %s\n' "$ATTINYCORE_ARCHIVE_SHA256" "$ARCHIVE" | shasum -a 256 -c -
fi
tar -xjf "$ARCHIVE" -C "$WORK_DIR"

rm -rf "$TARGET"
mkdir -p "$(dirname "$TARGET")"
mv "$WORK_DIR/ATTinyCore-${ATTINYCORE_VERSION}" "$TARGET"

# The core's post-build hooks write a disassembler listing, chmod scripts in the
# core and copy the listing into the sketch directory. None of it changes the
# HEX, and in the compile sandbox core and sketch are read-only: disable them.
{
  echo "# UnoSim: post-build hooks off (scripts/install-attinycore.sh)."
  for os in linux macosx; do
    for hook in 1 2 3 4 5; do echo "recipe.hooks.savehex.presavehex.${hook}.pattern.${os}="; done
  done
} > "$TARGET/platform.local.txt"

sh "$SCRIPT_DIR/check-attinycore-version.sh"
