# Phase 2.6: ExecutionManager Decomposition - Analyse

## Status
**Nicht abgeschlossen** - Zurückgesetzt auf letzten grünen Zustand

## Grund für Zurücksetzung
Die Phasen-Refaktorierung war zu ambitioniert und hat zu vielen TypeScript-Fehlern geführt:
- 43 Fehler in unvollständigen Phasen-Modulen
- Falsche Importpfade (z.B. `../registry-manager` statt korrektem Pfad)
- Typ-Konflikte (import type vs. import)
- Unvollständige Abhängigkeitsinjektion

## Empfohlener Ansatz: Inkrementelle Extraktion

Phase 2.6 sollte in **5 unabhängige, jeweils grün bleibende Schritte** zerlegt werden:

### Schritt 1: Cleanup extrahieren (niedrigstes Risiko)
**Ziel:** `cleanupExecution()` als reine Funktion extrahieren
**Betroffene Methoden:**
- `cleanupDockerContainer()`
- `flushBatchers()`
- `flushMessageQueue()`
- `destroyBatchers()` (neu erstellen)

**Vorteile:**
- Keine State-Änderungen während der Ausführung
- Am Ende des Lebenszyklus, daher einfach zu isolieren
- Keine komplexen Callbacks

**Risiko:** Niedrig

---

### Schritt 2: Timeout-Handling extrahieren
**Ziel:** `handleExecutionTimeout()` und `scheduleExecutionTimeout()` extrahieren
**Betroffene Methoden:**
- `handleExecutionTimeout()` (bereits vorhanden)
- `abortExecution()` (neu erstellen)

**Vorteile:**
- Isolierte Logik (nur Process-Kill + Notification)
- Keine komplexen Datenstrukturen
- Einfach zu testen

**Risiko:** Niedrig-Mittel

---

### Schritt 3: Stream-Verarbeitung extrahieren
**Ziel:** Output-Stream-Verarbeitung in separate Module
**Betroffene Methoden:**
- `delegateParsedLineToStreamHandler()`
- `handleStderrFallbackData()`
- `createWrappedCallbacks()`

**Vorteile:**
- Größter Code-Anteil (~200 Zeilen)
- Bereits teilweise in StreamHandler ausgelagert
- Klare Schnittstelle (ParsedStderrOutput → Callbacks)

**Risiko:** Mittel (Callback-Komplexität)

---

### Schritt 4: Start/Process-Launch extrahieren
**Ziel:** Prozess-Start und Kompilierung extrahieren
**Betroffene Methoden:**
- `setupSimulationProcess()`
- `runDocker()`
- `runLocal()`
- `setupLocalHandlers()`
- `setupDockerStream()`

**Vorteile:**
- Klare Trennung: Docker vs. Local
- Bereits teilweise strukturiert

**Risiko:** Hoch (viele Callbacks, State-Übergänge)

---

### Schritt 5: Vorbereitung extrahieren (höchstes Risiko)
**Ziel:** Preparation-Phase extrahieren
**Betroffene Methoden:**
- `initializeRunState()`
- `prepareEnvironment()`
- PinStateBatcher/SerialOutputBatcher-Erstellung

**Vorteile:**
- Erster Schritt im Lebenszyklus
- Könnte als erstes getestet werden

**Risiko:** Hoch (viele State-Initialisierungen, Baudrate-Parsing)

---

## Wichtige Erkenntnisse aus gescheitertem Versuch

### 1. Import-Pfade korrekt handhaben
- Relative Pfade von `execution-phases/` zu `../` müssen exakt stimmen
- `import type` vs. `import` unterscheiden (Konstruktor vs. Typ)

### 2. Abhängigkeitsinjektion vorbereiten
- Nicht zu viele Dependencies auf einmal injizieren
- Lieber mehrere kleine Funktionen als eine große
- Context-Objekte verwenden statt 10+ einzelner Parameter

### 3. State-Management konservativ behandeln
- ExecutionState nicht zwischen Modulen teilen
- Lieber Return-Values als State-Mutationen
- Timeout-/Cleanup-Semantik exakt bewahren

### 4. TypeScript-Checks nach jedem Schritt
- **Niemals** mehrere Schritte ohne Typecheck akkumulieren
- Jeder Extraktionsschritt muss für sich grün sein
- Tests sofort anpassen, nicht später

---

## Nächste Schritte (wenn Phase 2.6 wieder aufgenommen wird)

1. **Schritt 1 (Cleanup) implementieren**
   - Nur `cleanupDockerContainer()` und `flushBatchers()` extrahieren
   - TypeScript-Check
   - Tests laufen lassen
   - Commit

2. **Schritt 2 (Timeout) implementieren**
   - Nur `handleExecutionTimeout()` extrahieren
   - TypeScript-Check
   - Tests laufen lassen
   - Commit

3. **usw.** - Jeder Schritt einzeln, grün, getestet

---

## Alternative: Phase 2.6 überspringen

Wenn Zeit knapp ist:
- Phase 2.6 als "nicht kritisch" markieren
- Direkt zu Phase 2.7 (weitere Low-Hanging-Fruits)
- ExecutionManager kann später refaktoriert werden

**Begründung:** ExecutionManager ist bereits aus SandboxRunner extrahiert und funktioniert stabil. Weitere Zerlegung ist "nice-to-have", nicht "must-have".

---

## Lessons Learned

✅ **Was gut lief:**
- Klare Aufteilung in 5 Phasen (Prepare, Start, Stream, Timeout, Cleanup)
- Type-Definitionen separat (execution-manager-types.ts)
- Konservative Benennung

❌ **Was nicht gut lief:**
- Zu viele Module auf einmal erstellt
- Importpfade nicht sorgfältig genug geprüft
- Abhängigkeiten zu komplex (10+ Dependencies pro Phase)
- TypeScript-Checks zu spät durchgeführt

📝 **Für nächste Refaktorierung:**
- **Einen** Extraktionsschritt → **sofort** Typecheck → **sofort** Tests → **sofort** Commit
- Keine "Skelett-Module" erstellen, die nicht kompilieren
- Lieber kleinere Funktionen mit klaren Schnittstellen
