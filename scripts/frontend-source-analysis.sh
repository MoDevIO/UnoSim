#!/bin/bash
# Gründliche Analyse der Frontend-Quelltexte (client/src und client/public)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."

FRONTEND_DIRS=("$ROOT_DIR/client/src" "$ROOT_DIR/client/public")

# FEHLTE: Definition der Dateiendungen
EXTS=("js" "jsx" "ts" "tsx" "css" "scss" "html" "json")

clear

OUTFILE="$ROOT_DIR/frontend-source-analysis.txt"
USE_FILE=0
[[ "$1" == "--file" ]] && USE_FILE=1

output() {
  ((USE_FILE)) && echo "$1" >> "$OUTFILE" || echo "$1"
}

printf_output() {
  ((USE_FILE)) && printf "$1" "${@:2}" >> "$OUTFILE" || printf "$1" "${@:2}"
}

# Datei initialisieren
if ((USE_FILE)); then
  echo "Frontend-Quelltextanalyse (Stand: $(date))" > "$OUTFILE"
else
  echo "Frontend-Quelltextanalyse (Stand: $(date))"
fi

output "Verzeichnisse:"
output "${FRONTEND_DIRS[0]}"
output "${FRONTEND_DIRS[1]}"
output ""

# 1. Gesamtstatistik pro Dateityp
output "### Gesamtstatistik pro Dateityp"
printf_output "| %-5s | %7s | %7s | %10s |\n" "Typ" "Dateien" "LOC" "Bytes"
printf_output "|:------|--------:|--------:|----------:|\n"

for ext in "${EXTS[@]}"; do
  count=0; loc=0; bytes=0
  # Suche in allen Frontend-Verzeichnissen
  for dir in "${FRONTEND_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    while IFS= read -r -d '' file; do
      ((count++))
      l=$(wc -l < "$file" | xargs); ((loc+=l))
      # Kompatibel für Linux & macOS
      if [[ "$OSTYPE" == "darwin"* ]]; then
        s=$(stat -f%z "$file")
      else
        s=$(stat -c%s "$file")
      fi
      ((bytes+=s))
    done < <(find "$dir" -type f -name "*.$ext" -print0 2>/dev/null)
  done
  
  if ((count>0)); then
    printf_output "| %-5s | %7d | %7d | %10d |\n" "$ext" "$count" "$loc" "$bytes"
  fi
done
output ""

# 2. Top 20 größte Dateien
output "### Top 20 größte Dateien (nach Bytes)"
printf_output "| %-50s | %10s | %7s |\n" "Datei" "Bytes" "LOC"
printf_output "|:---------------------------------------------------|-----------:|-------:|\n"

# Suchmuster für find zusammenbauen
find_args=()
for ext in "${EXTS[@]}"; do
    [[ ${#find_args[@]} -gt 0 ]] && find_args+=("-o")
    find_args+=("-name" "*.$ext")
done

find "${FRONTEND_DIRS[@]}" -type f \( "${find_args[@]}" \) 2>/dev/null | while read -r file; do
    if [[ "$OSTYPE" == "darwin"* ]]; then
        s=$(stat -f%z "$file")
    else
        s=$(stat -c%s "$file")
    fi
    l=$(wc -l < "$file" | xargs)
    echo "$s $l $file"
done | sort -rn | head -n 20 | while read -r s l f; do
    relfile="${f#$ROOT_DIR/}"
    printf_output "| %-50s | %10d | %7d |\n" "$relfile" "$s" "$l"
done

output ""
echo "Analyse abgeschlossen."
((USE_FILE)) && echo "Siehe $OUTFILE"