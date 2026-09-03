# Refactoring Plan: UNOSIM SandboxRunner

**Status:** Initialer Entwurf (Basierend auf Opus-Analyse)
**Ziel:** Reduktion der Komplexität (~1.550 LOC auf ~400 LOC), Einführung einer State Machine, Entkopplung der Verantwortlichkeiten.

---

## 1. IST-Analyse (Probleme)
* **God Object:** 8 verschiedene Verantwortlichkeiten in einer Datei.
* **Inkonsistenter State:** Redundante Flags (`isRunning`, `isPaused`) führen zu Race-Conditions.
* **Parsing-Monster:** `setupProcessHandlers()` ist mit ~250 Zeilen zu komplex (Regex, Serial, Registry, Pins gemischt).
* **Schlechte Testbarkeit:** Logik ist fest mit dem Prozess-Handling verdrahtet.

---

## 2. Phasen-Modell (Umsetzung von oben nach unten)

### Phase 1: Zentralisierung der State Machine
**Fokus:** Stabilität der Zustandsübergänge.
- Definition eines `SimulationState` Enums: `STOPPED`, `STARTING`, `RUNNING`, `PAUSED`, `ERROR`.
- Einführung einer `transitionTo(newState)` Methode zur Vermeidung von Flag-Inkonsistenzen.
- Implementierung von Guards für Methoden wie `pause()`, `resume()` und `stop()`.

### Phase 2: Extraktion des Output-Parsers
**Fokus:** Komplexitätsreduktion in `setupProcessHandlers()`.
- Auslagerung der Regex- und String-Parsing-Logik in eine separate Klasse `ArduinoOutputParser`.
- Trennung von:
    - Serial-Events (stdout)
    - Registry-Markern (UI-Updates)
    - Pin-Status-Änderungen
    - Compile-Phasen-Erkennung

### Phase 3: Extraktion des Registry-Collectors
**Fokus:** Isolierung der I/O-Registry-Logik.
- Eigene Klasse `RegistryManager` zur Verwaltung des internen Speichers der Pin-Zustände.
- Implementierung von Debouncing für Registry-Updates zur Entlastung der WebSocket-Verbindung.

### Phase 4: Extraktion des Timeout-Managers
**Fokus:** Saubere Zeit-Semantik bei Pause/Resume.
- Auslagerung der Uhr-Logik (`pauseTimeoutClock`, `resumeTimeoutClock`).
- Zentralisierung der `setTimeout`/`clearTimeout` Aufrufe zur Vermeidung von Memory Leaks bei abruptem Stopp.

### Phase 5: Integration & Final Cleanup
**Fokus:** Verschlankung der `sandbox-runner.ts`.
- `SandboxRunner` agiert nur noch als "Orchestrator", der die spezialisierten Module (Parser, State, Registry) zusammenführt.
- Entfernung der verbleibenden "Deadwood"-Felder (`baud`, `blocking`, `atomic`).

---

## 3. Erfolgskriterien
- [ ] `npm run build` ist zu jedem Zeitpunkt erfolgreich (inkrementelles Refactoring).
- [ ] `sandbox-runner.ts` hat am Ende weniger als 500 Zeilen Code.
- [ ] Keine Methode ist länger als 40 Zeilen.
- [ ] Alle Unit-Tests für Serial-I/O und State-Übergänge bestehen.

---

## 4. Historie & Dokumentation
- **2026-01-XX:** Initialer Plan erstellt (Opus Audit).
- **Nächster Schritt:** Start mit Phase 1.


