#!/bin/bash

# Konfiguration
TIMEOUT_SECS=90
LOG_FILE="full_test_output.log"
WORKERS=1

clear
echo "🛡️  Starte vollständigen System-Check..."
echo "----------------------------------------------------------------------"
rm -f "$LOG_FILE"

# Einfache Funktion für die Schritte
run_step() {
    local label=$1
    local command=$2
    
    echo -n "⏳ Schritt: $label... "
    start_time=$(date +%s)
    
    # Befehl ausführen und Output ins Log umleiten
    if eval "$command" >> "$LOG_FILE" 2>&1; then
        end_time=$(date +%s)
        echo "✅ OK ($((end_time - start_time))s)"
        return 0
    else
        echo "❌ FEHLGESCHLAGEN"
        return 1
    fi
}

# 1. Code-Check
run_step "Linting/Check" "npm run check" || { echo "🛑 Abbruch bei Check"; exit 1; }

# 2. Unit-Tests
run_step "Unit-Tests" "npm run test" || { echo "🛑 Abbruch bei Unit-Tests"; exit 1; }

# 3. E2E Tests
echo "----------------------------------------------------------------------"
echo "🚀 Starte E2E-Tests (Parallel: $WORKERS Worker)..."

# E2E im Hintergrund starten
npm run test:e2e -- --fully-parallel --workers=$WORKERS >> "$LOG_FILE" 2>&1 &
test_pid=$!

# Countdown
for ((i=$TIMEOUT_SECS; i>0; i--)); do
    if ! kill -0 $test_pid 2>/dev/null; then break; fi
    echo -ne "\r\033[K⏳ E2E läuft... Noch ca. ${i}s verbleibend"
    sleep 1
done

# Ergebnis auswerten
if kill -0 $test_pid 2>/dev/null; then
    kill $test_pid
    echo -e "\n⚠️  Timeout erreicht!"
    exit 1
else
    wait $test_pid
    if [ $? -eq 0 ]; then
        echo -e "\n🎉 ALLES GRÜN! System bereit."
    else
        echo -e "\n❌ E2E-Tests fehlgeschlagen. Siehe $LOG_FILE"
        tail -n 20 "$LOG_FILE"
        exit 1
    fi
fi