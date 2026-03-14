#!/bin/bash
clear

# Konfiguration
SERVER_DIR=$([ -d "server/src" ] && echo "server/src" || echo "server")
CLIENT_DIR=$([ -d "client/src" ] && echo "client/src" || echo "client")
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}=== UnoSim Ultimate Project Analysis ===${NC}"

# 1. Import-Verhäkelung (Coupling)
echo -e "\n${GREEN}[1/4] Import-Verhäkelung: Top 5 'Häuptling'-Dateien (höchstes Coupling)${NC}"
echo "Diese Dateien importieren am meisten andere Module (Risiko für Kreisel):"
grep -r "^import" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir=node_modules | cut -d: -f1 | sort | uniq -c | sort -rn | head -n 5
echo -e "${YELLOW}Tipp: Wenn diese Dateien > 20 Imports haben, sollten sie gesplittet werden.${NC}"

# 2. Zirkuläre Verdachtsmomente
echo -e "\n${GREEN}[2/4] Zirkuläre Verdachtsmomente (Cross-Imports)${NC}"
# Wir suchen nach Modulen, die sich gegenseitig in ihren Namen referenzieren (simpler Check)
echo "Suche nach gegenseitigen Referenzen zwischen Services..."
SERVICES=$(find "$SERVER_DIR/services" -name "*.ts" 2>/dev/null)
for s in $SERVICES; do
    NAME=$(basename "$s" .ts)
    # Prüfe ob andere Services diesen Service importieren UND dieser Service die anderen importiert
    REFS=$(grep -l "from '.*$NAME'" $SERVICES | grep -v "$NAME.ts")
    for r in $REFS; do
        RNAME=$(basename "$r" .ts)
        if grep -q "from '.*$RNAME'" "$s"; then
            echo -e "${RED}ACHTUNG: Möglicher Kreisel zwischen $NAME <--> $RNAME${NC}"
        fi
    done
done

# 3. Die "Any"-Hotspots
echo -e "\n${GREEN}[3/4] Code-Qualität: Any-Verteilung${NC}"
ANY_TOTAL=$(grep -rn "any" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir={node_modules,dist} | grep -v ".d.ts" | wc -l)
echo -e "Gesamt 'any' Funde: $ANY_TOTAL"
grep -r "any" "$SERVER_DIR" "$CLIENT_DIR" --exclude-dir={node_modules,dist} | cut -d: -f1 | sort | uniq -c | sort -rn | head -n 5

# 4. Mock-Synchronität (Dynamische Suche)
echo -e "\n${GREEN}[4/4] Mock-Status (Refactoring Check)${NC}"
# Sucht das Verzeichnis überall im Projekt, ignoriert aber node_modules
MOCK_DIR=$(find . -type d -name "arduino-mock" -not -path "*/node_modules/*" | head -n 1)

if [ -n "$MOCK_DIR" ]; then
    COUNT=$(ls -1 "$MOCK_DIR" | wc -l)
    echo -e "✅ Gefunden in: $MOCK_DIR"
    echo "Anzahl extrahierter Mock-Module: $COUNT"
    # Zeigt an, welche Dateien drin liegen
    ls -p "$MOCK_DIR" | grep -v /
else
    echo -e "${RED}❌ Verzeichnis 'arduino-mock' wurde im gesamten Projekt nicht gefunden!${NC}"
fi

echo -e "\n${YELLOW}=== Analyse abgeschlossen ===${NC}"