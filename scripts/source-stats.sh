#!/bin/bash
#!/bin/bash

# Erweiterte Quelltextstatistik nach Backend, Frontend, Tests
# Immer relativ zum Projekt-Root, egal von wo gestartet

# Projekt-Root ermitteln (Verzeichnis, in dem dieses Skript liegt)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
clear
echo "Projekt-Root: $ROOT_DIR"

# Kategorien und Unterkategorien (immer absolut)
BACKEND_DIRS=("$ROOT_DIR/server" "$ROOT_DIR/shared")
BACKEND_API=("$ROOT_DIR/server/routes.ts")
BACKEND_SERVICES=("$ROOT_DIR/server/services" "$ROOT_DIR/shared")
BACKEND_STORAGE=("$ROOT_DIR/server/storage.ts")
BACKEND_MOCKS=("$ROOT_DIR/server/mocks")

FRONTEND_DIRS=("$ROOT_DIR/client" "$ROOT_DIR/src")
FRONTEND_COMPONENTS=("$ROOT_DIR/client/src/components")
FRONTEND_PAGES=("$ROOT_DIR/client/src/pages")
FRONTEND_UTILS=("$ROOT_DIR/client/src/lib" "$ROOT_DIR/client/src/utils")
FRONTEND_STYLES=("$ROOT_DIR/client/src" "$ROOT_DIR/client/public")

TEST_DIRS=("$ROOT_DIR/tests" "$ROOT_DIR/e2e")
TEST_UNIT=("$ROOT_DIR/tests" "$ROOT_DIR/tests/client" "$ROOT_DIR/tests/server")
TEST_E2E=("$ROOT_DIR/e2e")
TEST_FIXTURES=("$ROOT_DIR/e2e/fixtures" "$ROOT_DIR/tests/fixtures")

SHARED_DIRS=("$ROOT_DIR/shared")
SCHEMA_DIRS=("$ROOT_DIR/shared/schema.ts")

DOCS_DIRS=("$ROOT_DIR/README.md" "$ROOT_DIR/TODO.md" "$ROOT_DIR/ssot" "$ROOT_DIR/archive" "$ROOT_DIR/*.md")

# Dateitypen
EXTS=("js" "ts" "tsx" "jsx" "css" "scss" "html" "md" "py" "java" "go" "c" "cpp" "h")

# Hilfsfunktion für Statistik
stat_category() {
  local label="$1"
  shift
  local dirs=("$@")
  TMP_AGG=$(mktemp)
  for dir in "${dirs[@]}"; do
    for ext in "${EXTS[@]}"; do
      find "$dir" -type f -name "*.$ext" -exec bash -c 'lines=$(wc -l < "$1"); size=$(stat -f%z "$1"); printf "%d %d\n" "$lines" "$size"' _ {} \; 2>/dev/null
    done
  done > "$TMP_AGG"
  LOC=$(awk '{s+=$1} END{print s+0}' "$TMP_AGG")
  BYTES=$(awk '{s+=$2} END{print s+0}' "$TMP_AGG")
  MB=$(awk -v b="$BYTES" 'BEGIN{printf "%.2f", b/1024/1024}')
  printf "| %-9s | %7d | %8.2f MB |\n" "$label" "$LOC" "$MB"
  rm -f "$TMP_AGG"
}


# Header
printf "\nErweiterte Quelltextstatistik (nur eigene Dateien):\n"
printf "| Kategorie/Teilbereich     |    LOC |    Größe |\n"
printf "|:-------------------------|-------:|---------:|\n"

# Hauptkategorien
stat_category "Backend (gesamt)"   "${BACKEND_DIRS[@]}"
stat_category "Frontend (gesamt)"  "${FRONTEND_DIRS[@]}"
stat_category "Tests (gesamt)"     "${TEST_DIRS[@]}"

# Backend-Unterkategorien
stat_category "Backend API"        "${BACKEND_API[@]}"
stat_category "Backend Services"   "${BACKEND_SERVICES[@]}"
stat_category "Backend Storage"    "${BACKEND_STORAGE[@]}"
stat_category "Backend Mocks"      "${BACKEND_MOCKS[@]}"

# Frontend-Unterkategorien
stat_category "Frontend Komponenten"   "${FRONTEND_COMPONENTS[@]}"
stat_category "Frontend Seiten"        "${FRONTEND_PAGES[@]}"
stat_category "Frontend Utils"         "${FRONTEND_UTILS[@]}"
stat_category "Frontend Styles"        "${FRONTEND_STYLES[@]}"

# Test-Unterkategorien
stat_category "Unit-Tests"         "${TEST_UNIT[@]}"
stat_category "E2E-Tests"          "${TEST_E2E[@]}"
stat_category "Test Fixtures/Mocks" "${TEST_FIXTURES[@]}"

# Gemeinsame Module
stat_category "Shared"             "${SHARED_DIRS[@]}"
stat_category "Schemas/Typen"      "${SCHEMA_DIRS[@]}"

# Dokumentation
stat_category "Dokumentation/Markdown" "${DOCS_DIRS[@]}"
