#!/usr/bin/env bash
set -Eeuo pipefail

# ─────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────
ROOTS=(../client ../server ../shared ../tests e../2e)
EXTENSIONS=("*.ts" "*.tsx" "*.js" "*.jsx")
EXCLUDES=(
  "*/node_modules/*"
  "*/dist/*"
  "*/build/*"
  "*/coverage/*"
  "*/.git/*"
)

# ─────────────────────────────────────────────
# Build find-Parameter
# ─────────────────────────────────────────────
find_args=()
for dir in "${ROOTS[@]}"; do
  [[ -d "$dir" ]] && find_args+=("$dir")
done

name_args=()
for ext in "${EXTENSIONS[@]}"; do
  name_args+=(-name "$ext" -o)
done
unset 'name_args[${#name_args[@]}-1]'

exclude_args=()
for ex in "${EXCLUDES[@]}"; do
  exclude_args+=(! -path "$ex")
done

# ─────────────────────────────────────────────
# Analyse
# ─────────────────────────────────────────────
find "${find_args[@]}" -type f \
  \( "${name_args[@]}" \) \
  "${exclude_args[@]}" \
  -exec wc -l {} + \
| sort -nr \
| awk '{ printf "%6d  %s\n", $1, $2 }'