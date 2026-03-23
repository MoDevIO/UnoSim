#!/bin/bash
clear

# --- KONFIGURATION ---
SERVER_DIR=$([ -d "server/src" ] && echo "server/src" || echo "server")
CLIENT_DIR=$([ -d "client/src" ] && echo "client/src" || echo "client")
CURRENT_DATE=$(date +"%d.%m.%Y %H:%M")
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}====================================================${NC}"
echo -e "${YELLOW}       UnoSim Ultimate Project Analyzer v1.6        ${NC}"
echo -e "${YELLOW}       Analyse vom: $CURRENT_DATE               ${NC}"
echo -e "${YELLOW}====================================================${NC}"

# 1. Import-Verhäkelung (Coupling)
echo -e "\n${GREEN}[1/6] Import-Analyse: Top 'Häuptling'-Dateien${NC}"
grep -r "^import" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir=node_modules | cut -d: -f1 | sort | uniq -c | sort -rn | head -n 5
echo -e "${YELLOW}Hinweis: Dateien mit > 20 Imports sind schwer zu testen.${NC}"

# 2. Zirkuläre Verdachtsmomente
echo -e "\n${GREEN}[2/6] Zirkuläre Verdachtsmomente (Cross-Imports)${NC}"
SERVICES=$(find "$SERVER_DIR" -name "*.ts" 2>/dev/null | grep "services")
for s in $SERVICES; do
    NAME=$(basename "$s" .ts)
    REFS=$(grep -l "from '.*$NAME'" $SERVICES 2>/dev/null | grep -v "$NAME.ts")
    for r in $REFS; do
        RNAME=$(basename "$r" .ts)
        if grep -q "from '.*$RNAME'" "$s"; then
            echo -e "${RED}Potential Cycle: $NAME <--> $RNAME${NC}"
        fi
    done
done

# 3. Code-Qualität: Any-Verteilung
echo -e "\n${GREEN}[3/6] Code-Qualität: 'any' Hotspots${NC}"
ANY_TOTAL=$(grep -rn "any" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir={node_modules,dist} | grep -v ".d.ts" | wc -l)
echo -e "Gesamt 'any' Funde: $ANY_TOTAL"
grep -r "any" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir={node_modules,dist} | cut -d: -f1 | sort | uniq -c | sort -rn | head -n 5

# 4. Datei-Statistik: Die größten Dateien (LOC)
echo -e "\n${GREEN}[4/6] Datei-Statistik: Top 5 größte Dateien (Lines of Code)${NC}"
# Findet .ts/.tsx Dateien, zählt Zeilen, sortiert numerisch absteigend
find "$SERVER_DIR" "$CLIENT_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" -not -path "*/dist/*" -exec wc -l {} + | sort -rn | grep -v "total$" | head -n 5

# 5. Mock-Integrität: Ordner-Check
echo -e "\n${GREEN}[5/6] Mock-Struktur: Modul-Ordner${NC}"
MOCK_DIR=$(find . -type d -name "arduino-mock" -not -path "*/node_modules/*" | head -n 1)
if [ -n "$MOCK_DIR" ]; then
    echo -e "✅ Ordner gefunden: $MOCK_DIR"
    COUNT=$(ls -1 "$MOCK_DIR" | wc -l)
    echo "Module im Ordner: $COUNT"
    ls -p "$MOCK_DIR" | grep -v / | sed 's/^/  - /'
else
    echo -e "${RED}❌ FEHLER: Modul-Ordner 'arduino-mock' fehlt.${NC}"
fi

# 6. Mock-Integrität: Entry-Point Check
echo -e "\n${GREEN}[6/6] Mock-Integrität: Entry-Point Datei${NC}"
MOCK_FILE=$(find . -name "arduino-mock.ts" -not -path "*/node_modules/*" | head -n 1)
if [ -n "$MOCK_FILE" ]; then
    echo -e "✅ Entry-Point gefunden: $MOCK_FILE"
    L_COUNT=$(wc -l < "$MOCK_FILE")
    echo "Dateigröße: $L_COUNT Zeilen"
    if [ "$L_COUNT" -lt 50 ]; then
        echo -e "${GREEN}Status: Schlanker Export-Hub (Ideal).${NC}"
    else
        echo -e "${YELLOW}Status: Monolithisch (Sollte modularisiert werden).${NC}"
    fi
else
    echo -e "${RED}❌ KRITISCH: 'arduino-mock.ts' fehlt im Projekt!${NC}"
    echo "Der ArduinoCompilerService wird vermutlich keine Mock-Daten finden."
fi

echo -e "\n${YELLOW}================ Analysis Complete =================${NC}"