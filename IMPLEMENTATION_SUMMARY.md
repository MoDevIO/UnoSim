# Implementierungszusammenfassung: Debug-Header und Drop-Telemetrie 

## Was wurde implementiert

### 1. **Debug-Ausgaben für Drop-Telemetrie** ✅
- **Datei**: `server/services/registry-manager.ts`
- **Funktion**: Schreibt Telemetrie-Daten in `temp/telemetry-debug.jsonl`
- **Inhalt**: Jede Zeile enthält Timestamp und Serial-Telemetrie (outputPerSec, bytesPerSec, intendedPerSec, droppedPerSec, bytesTotal)
- **Trigger**: Wird jede Heartbeat-Periode (1 Sekunde) ausgelöst, wenn Simulation läuft

### 2. **Globaler Debug-Mode Store** ✅
- **Datei**: `client/src/hooks/use-debug-mode-store.ts` (NEU)
- **Funktionalität**: 
  - Globaler State für debug mode (True/False)
  - Persistent über localStorage
  - React-Hook `useDebugMode()` zum Konsumieren des State
  - Export von `debugModeStore` zum direkten Zugriff
- **Verwendung**: Alle Komponenten können jetzt den gleichen debugMode-State sehen

### 3. **Tastenkürzel richtig wired** ✅
- **Datei**: `client/src/pages/arduino-simulator.tsx`
- **Änderungen**:
  - Import von `useDebugMode` hinzugefügt
  - Tastenkürzel-Handler (⌘+D auf Mac, Ctrl+D auf Windows) nutzt jetzt `setDebugMode()` aus dem Store
  - Toast-Nachricht zeigt Debug-Modus Status
  - Alle Komponenten sehen sofort die Änderung (via useSyncExternalStore)

### 4. **Serial Monitor Debug Header** ✅
- **Datei**: `client/src/components/features/serial-monitor-debug-header.tsx` (NEU)
- **Anzeigen**:
  - `Serial /s`: Chunks pro Sekunde (Batch-Rate)
  - `Bytes /s`: Tatsächlich gesendete Bytes/Sekunde
  - `Dropped /s`: Verworfene Bytes/Sekunde (ROT wenn > 0)
  - `Total`: Kumulative KB seit Simulation-Start
- **Sichtbarkeit**: Nur wenn (debugMode === true) && (simulation !== stopped) && (telemetry vorhanden)
- **Platzierung**: Header über dem SerialMonitor (3 Orte aktualisiert)

### 5. **Build & Deployment** ✅
- Alle TypeScript-Dateien gebaut successfully
- Keine Fehler, nur Chunk-Size-Warnung (not critical)
- Ready für Browser-Test

## Wie es funktioniert

1. **Benutzer drückt ⌘+D** (Mac) oder **Ctrl+D** (Windows/Linux)
2. **Tastenkürzel-Handler** wird ausgelöst → ruft `setDebugMode(!currentValue)` auf
3. **debugModeStore** wird updated, localStorage wird synchronisiert
4. **Alle Komponenten**, die `useDebugMode()` verwenden, re-rendern automatisch
5. **SerialMonitorDebugHeader** wird sichtbar (wenn simulation läuft)
6. **Telemetrie-Metriken** werden angezeigt:
   - Wenn `serialDroppedBytesPerSecond` > 0, wird "Dropped /s" in **ROT** angezeigt

## Telemetrie-Datenfluss

```
C++ Batcher
  ↓
serialOutputBatcher.getTelemetryAndReset()
  ↓
registry-manager.generateTelemetry()
  ↓
telemetryStore.pushTelemetry(metrics)
  ↓
WebSocket → Client
  ↓
useTelemetryStore() Hook
  ↓
SerialMonitorDebugHeader (konsumiert telemetry.serialDroppedBytesPerSecond)
```

## Zu überprüfende Punkte nach Deployment

1. **Tastenkürzel funktioniert**: Drücke ⌘+D, toast sollte "Debug Mode Enabled/Disabled" zeigen
2. **Debug-Header erscheint**: Nach ⌘+D sollte ein grauer Header über dem Serial Monitor sichtbar sein
3. **Drops werden angezeigt**: 
   - Mit normalem Sketch: "Dropped /s: 0.0" (grau)
   - Mit Flooding-Sketch: "Dropped /s: X.X" (ROT wenn > 0)
4. **Debug-Datei wird geschrieben**: Nach Simulation-Start sollte `temp/telemetry-debug.jsonl` existieren mit Kilobyte-Einträgen

## Test-Sketch für Drops (115200 Baud, 10s)

```c++
void setup() {
  Serial.begin(115200);
  Serial.println("=== Flooding Test Start ===");
}

void loop() {
  static unsigned long counter = 0;
  static unsigned long start = millis();
  
  if (millis() - start > 10000) {   // 10 Sekunden
    Serial.println("=== END ===");
    delay(1000);
    exit(0);
  }
  
  // 200-character strings trigger drops at 115200 baud
  char buf[210];
  snprintf(buf, sizeof(buf), "%06lu:", counter);
  memset(buf + 7, 'X', 193);
  buf[200] = '\0';
  Serial.println(buf);
  counter++;
}
```

## Dateiänderungen zusammengefasst

| Datei | Änderung | Link |
|-------|----------|------|
| `server/services/registry-manager.ts` | Debug-Ausgabe hinzugefügt | [+20 Zeilen] |
| `client/src/hooks/use-debug-mode-store.ts` | NEU - Debug-Mode Store | [60 Zeilen] |
| `client/src/components/features/serial-monitor-debug-header.tsx` | NEU - Header-Komponente | [44 Zeilen] |
| `client/src/pages/arduino-simulator.tsx` | Import, Tastenkürzel, 3× SerialMonitorDebugHeader | [+40 Zeilen] |

---

**Status**: Alle Änderungen implementiert und gebaut. Bereit für Browser-Test.
