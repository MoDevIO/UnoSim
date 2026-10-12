#!/usr/bin/env bash
# Prepares the host directories that docker-compose.yml bind-mounts into the
# backend container so that the container's unprivileged user can write to them.
#
#   sudo ./scripts/prepare-runtime-dirs.sh [--project-dir DIR] [--uid UID] [--gid GID]
#
# The backend image runs as its `node` user, numeric UID/GID 1000 (Dockerfile).
# The directories are handed to that numeric ID and not to a host account: the
# host user may have any UID (1001 on a second account, for example), and a
# missing mount source would otherwise be created by Docker as root:root.
# Mode 0750 keeps the directories closed to other host users; there is no
# world-writable mode and the backend never needs to run as root.
set -Eeuo pipefail

# Keep in sync with the `node` user of the unosim-server image. The installer
# deployment test compares these values with `id` inside the built image.
RUNTIME_UID='1000'
RUNTIME_GID='1000'
RUNTIME_DIRECTORIES=(server/arduino-cache temp storage)

usage() {
  cat <<'USAGE'
Usage: sudo ./scripts/prepare-runtime-dirs.sh [--project-dir DIR] [--uid UID] [--gid GID]

Creates server/arduino-cache, temp and storage below the project directory
(default: this checkout) and gives them to the backend container user
(default UID/GID 1000). Run it before the first `docker compose up`.
USAGE
}

fail() {
  printf 'Fehler: %s\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(dirname -- "$SCRIPT_DIR")"
uid="$RUNTIME_UID"
gid="$RUNTIME_GID"

while (($# > 0)); do
  case "$1" in
    --project-dir)
      (($# >= 2)) || fail 'Nach --project-dir fehlt das Verzeichnis.'
      project_dir="$2"
      shift 2
      ;;
    --uid)
      (($# >= 2)) || fail 'Nach --uid fehlt die numerische Benutzer-ID.'
      uid="$2"
      shift 2
      ;;
    --gid)
      (($# >= 2)) || fail 'Nach --gid fehlt die numerische Gruppen-ID.'
      gid="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unbekanntes Argument: $1"
      ;;
  esac
done

[[ "$uid" =~ ^[0-9]+$ ]] || fail '--uid muss eine numerische Benutzer-ID sein.'
[[ "$gid" =~ ^[0-9]+$ ]] || fail '--gid muss eine numerische Gruppen-ID sein.'
[[ -d "$project_dir" ]] || fail "Projektverzeichnis nicht gefunden: $project_dir"

# Handing a directory to another account needs root; the account that already
# is the target may prepare its own directories without it.
if [[ "$(id -u)" -ne 0 && ( "$(id -u)" != "$uid" || "$(id -g)" != "$gid" ) ]]; then
  fail "Die Verzeichnisse gehen an UID:GID ${uid}:${gid}; starte das Skript dafür mit sudo."
fi

# Validate everything before the first change so a refusal leaves no partial state.
for relative in "${RUNTIME_DIRECTORIES[@]}"; do
  target="$project_dir/$relative"
  if [[ -L "$target" ]]; then
    fail "$target ist ein symbolischer Link; das Skript ändert keine Ziele außerhalb des Projekts."
  fi
  if [[ -e "$target" && ! -d "$target" ]]; then
    fail "$target existiert, ist aber kein Verzeichnis."
  fi
done

for relative in "${RUNTIME_DIRECTORIES[@]}"; do
  target="$project_dir/$relative"
  mkdir -p -- "$target"
  # -h: never follow a link planted inside the tree. This also repairs content
  # that an earlier container start left behind as root:root.
  chown -hR -- "${uid}:${gid}" "$target"
  chmod -- 0750 "$target"
  printf 'Bereit für UID:GID %s:%s: %s\n' "$uid" "$gid" "$target"
done
