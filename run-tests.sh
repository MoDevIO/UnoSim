#!/bin/bash

# Konfiguration
TIMEOUT_SECS=90
LOG_FILE="run-tests_output.log"
WORKERS=1

clear
echo "🛡️  Starte vollständigen System-Check & Build..."
rm -f "$LOG_FILE"

# Einfache Funktion für die Schritte
run_step() {
    local label=$1
    local command=$2

    # Einheitliche Startzeile (kein Sanduhr-Symbol während des Laufs)
    printf "Schritt: %s... " "$label"
    start_time=$(date +%s)

    if eval "$command" >> "$LOG_FILE" 2>&1; then
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        # Erfolg: grüner Haken voranstellen und die Zeile abschließen
        printf "\r✅ Schritt: %s... OK (%ds)\n" "$label" "$duration"
        return 0
    else
        # Fehler: rotes Kreuz voranstellen und Zeile abschließen
        printf "\r❌ Schritt: %s... FEHLGESCHLAGEN\n" "$label"
        return 1
    fi
}

# 1. Statische Analyse
run_step "Linting/Check" "npm run check" || { echo "🛑 Abbruch bei Check"; exit 1; }

# 2. Unit-Tests & Coverage
run_step "Unit-Tests & Coverage" "npm run test:coverage" || { 
    echo "🛑 Abbruch: Tests oder Coverage fehlgeschlagen."
    echo "👉 Tipp: Prüfe ob 'npm install -D @vitest/coverage-v8' ausgeführt wurde."
    exit 1 
}

# 3. E2E Tests
echo "🚀 Starte E2E-Tests (Parallel: $WORKERS Worker)..."

npm run test:e2e -- --fully-parallel --workers=$WORKERS >> "$LOG_FILE" 2>&1 &
test_pid=$!

for ((i=$TIMEOUT_SECS; i>0; i--)); do
    if ! kill -0 $test_pid 2>/dev/null; then break; fi
    # Laufende Anzeige ohne Sanduhr-Symbol (einheitlich)
    echo -ne "\rE2E läuft... Noch ca. ${i}s verbleibend"
    sleep 1
done

if kill -0 $test_pid 2>/dev/null; then
    kill $test_pid
    echo -e "\n⚠️  Timeout erreicht!"
    exit 1
else
    wait $test_pid
    if [ $? -eq 0 ]; then
        # Erfolg: grüner Haken vorne
        echo -e "\n✅ E2E-Tests erfolgreich."
    else
        echo -e "\n❌ E2E-Tests fehlgeschlagen. Siehe $LOG_FILE"
        tail -n 20 "$LOG_FILE"
        exit 1
    fi
fi

# 4. Finaler Build
echo "🏗️  Tests bestanden. Starte Produktions-Build..."

run_step "Produktions-Build (Vite/Esbuild)" "npm run build" || {
    echo "🛑 Build fehlgeschlagen! Siehe $LOG_FILE"
    exit 1
}

echo "🎉 ALLES ERLEDIGT! System geprüft und erfolgreich gebaut."
echo "👉 Die Dateien befinden sich im /dist Ordner."

# 5. Quellcode-Statistik
echo "📊 Quellcode-Statistik (eigene Dateien):"
find ./src ./client ./server ./shared ./tests ./e2e \
    -type f \
    \( -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.css' -o -name '*.scss' -o -name '*.html' -o -name '*.md' -o -name '*.py' -o -name '*.java' -o -name '*.go' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' \) \
    -exec bash -c 'ext="${1##*.}"; lines=$(wc -l < "$1"); size=$(stat -f%z "$1"); echo "$ext $lines $size"' _ {} \; \
    | awk '{count[$1]++; loc[$1]+=$2; size[$1]+=$3; total_count++; total_loc+=$2; total_size+=$3} \
        END {printf "%-8s | %-5s | %-8s | %-10s\n", "Typ", "Anzahl", "LOC", "Bytes"; \
        for (t in count) printf "%-8s | %-5d | %-8d | %-10d\n", t, count[t], loc[t], size[t]; \
        printf "\nSUMME:   %d Dateien, %d LOC, %.2f MB\n", total_count, total_loc, total_size/1024/1024}' \
    | sort