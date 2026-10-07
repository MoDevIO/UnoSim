#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-ubuntu-vbox.sh"

if output="$(bash "$INSTALLER" --lan-ip 300.300.1.2 2>&1)"; then
  echo "Installer unexpectedly accepted an invalid IPv4 address." >&2
  exit 1
fi

if [[ "$output" != *"--lan-ip"* || "$output" != *"IPv4"* ]]; then
  echo "Installer did not reject invalid --lan-ip input before system checks:" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

echo "Installer rejects malformed --lan-ip before system changes."
