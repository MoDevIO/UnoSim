# Phase 2 Deferred Plans Summary

**Status:** deferred  
**Datum:** 2026-09-05  
**Branch:** `feature/refactor/phase-2-execution-manager`

---

## Übersicht

Dieses Dokument fasst die zurückgestellten (deferred) und geplanten Teile von Phase 2 zusammen. Diese Items wurden bewusst nicht in der aktuellen Implementierung umgesetzt, bleiben aber als verbindliche Planung erhalten.

---

## Phase 2.7: Konfigurationszentralisierung (Deferred Items)

**Originalplan:** `docs/phase-2.7-configuration-centralization-plan.md`  
**Status:** ⚠️ **completed with deferred items**

### Umgesetzt ✅

- ✅ `server/config.ts` als zentrale Konfigurationsquelle etabliert
- ✅ Environment-Parser mit Type-Safety implementiert
- ✅ Start-Logging auf Config umgestellt (Teilstep 2.7.1 completed)

### Deferred 📋

#### A) Sandbox-Output-/Timeout-Limits

**Betroffene Dateien:**
- `server/services/sandbox/docker-manager.ts`
- `server/services/sandbox/execution-phases/start-phase.ts`

**Werte:**
- `OUTPUT_BYTE_LIMIT`
- `OUTPUT_FLUSH_INTERVAL_MS`
- `EXECUTION_TIMEOUT_MS`

**Grund für Deferred:**
- Fachliche Unsicherheit über sinnvolle Default-Werte
- Abhängigkeit von Performance-Tests (noch nicht durchgeführt)
- Risiko: Falsche Limits könnten Production-Verhalten negativ beeinflussen

**Empfohlenes Vorgehen:**
1. Performance-Tests mit realistischen Sketchen durchführen
2. Output-Größen und Timing messen
3. Limits basierend auf P95/P99-Werten setzen
4. Config-Werte in `server/config.ts` migrieren

#### B) Docker-Container-Sicherheitsparameter

**Betroffene Dateien:**
- `server/services/sandbox/docker-manager.ts`
- `docker-compose.yml`

**Werte:**
- `--read-only` (Read-Only Filesystem)
- `--cap-drop=ALL` (Capabilities)
- `--security-opt` (Security Options)
- `--network=none` (Network Isolation)

**Grund für Deferred:**
- Deployment-Abhängigkeit (Production-Setup noch nicht final)
- Gateway-Modus (ADR 0001) muss vollständig implementiert sein
- Risiko: Zu strikte Isolation könnte legitime Use-Cases brechen

**Empfohlenes Vorgehen:**
1. ADR 0001 (Authentication and Gateway) vollständig umsetzen
2. Security-Audit durchführen
3. Security-Parameter schrittweise verschärfen (mit Tests)
4. Config-Werte in `server/config.ts` migrieren

#### C) Worker-Pool-Konfiguration

**Betroffene Dateien:**
- `server/services/compilation-worker-pool.ts`
- `docker-compose.yml`

**Werte:**
- `COMPILATION_WORKER_COUNT`
- `WORKER_TIMEOUT_MS`
- `WORKER_QUEUE_SIZE`

**Grund für Deferred:**
- Performance-Tests ausstehend (noch nicht durchgeführt)
- Abhängigkeit von erwarteter Compile-Last (Production-Daten benötigt)
- Risiko: Falsche Worker-Zahl könnte Throughput reduzieren

**Empfohlenes Vorgehen:**
1. Load-Tests mit parallelen Compilations durchführen
2. Worker-Auslastung messen (CPU, Memory, Queue-Length)
3. Optimale Worker-Zahl basierend auf CPU-Kernen bestimmen
4. Config-Werte in `server/config.ts` migrieren

---

## Phase 2.8: Wrapper-Hooks Refactoring (Geplant)

**Originalplan:** `docs/phase-2.8-wrapper-hooks-plan.md`  
**Status:** 📋 **planned** (noch nicht begonnen)

### Problemstellung

Es existieren mehrere parallele Namensmuster für Hooks:

| Thema | Beispiele |
|-------|-----------|
| Hook-Dateinamen | `use-output-panel.ts`, `use-serial-io.ts`, aber auch `useArduinoSimulatorPage.tsx`, `useSimulatorFileSystem.ts` |
| Ähnliche Begriffe | `useSimulationControllerState` und `useSimulatorControllerState` |
| Doppelte Varianten | `useFileSystem` und `useSimulatorFileSystem`, `useOutputPanel` und `useSimulatorOutputPanel` |
| Compile/Simulation-Wrapper | `useCompileAndRun`, `useCompilation`, `useSimulationControls`, `useSimulation` |

**Risiko:** Die Auffindbarkeit leidet. Es ist nicht immer klar, ob ein Wrapper eine fachliche Variante, ein Adapter oder historischer Übergangscode ist.

### Geplante Maßnahmen

#### Schritt 1: Inventar erstellen

- [ ] Alle Hooks im Repository auflisten
- [ ] Namensmuster kategorisieren (camelCase, PascalCase, gemischt)
- [ ] Verwendungszweck dokumentieren
- [ ] Doppelte Varianten identifizieren

#### Schritt 2: Namenskonvention definieren

- [ ] camelCase für alle Hooks (TypeScript Convention)
- [ ] `use` Prefix für alle Hooks (React Convention)
- [ ] Fachliche Begriffe konsistent verwenden (z.B. "Simulator" vs. "Arduino")
- [ ] ADR für Hook-Namenskonvention erstellen

#### Schritt 3: Migrationsplan

- [ ] **Keine automatischen Renames** (zu riskant)
- [ ] Manuelle Migration Hook für Hook
- [ ] Jede Migration mit Tests absichern
- [ ] Deprecation-Warnungen für alte Namen
- [ ] Dokumentation aktualisieren

#### Schritt 4: Umsetzung (priorisiert)

1. **Niedriges Risiko:** Interne Hooks (nicht exportiert)
2. **Mittleres Risiko:** Öffentliche Hooks mit wenigen Aufrufen
3. **Hohes Risiko:** Zentrale Hooks (`useCompileAndRun`, `useArduinoSimulatorPage`)

### Erfolgskriterien

- ✅ Alle Hooks folgen camelCase-Konvention
- ✅ Keine doppelten Varianten mehr
- ✅ Dokumentation konsistent aktualisiert
- ✅ TypeScript-Compiler: 0 Errors
- ✅ Tests: 100% bestanden

### Offene Fragen

- ❓ Sollen exportierte Hooks ein `Simulator`-Prefix behalten?
- ❓ Wie mit State-Hooks umgehen (`useXxxState` vs. `useXxxControllerState`)?
- ❓ Sollen deprecated Aliase für alte Namen bereitgestellt werden?

---

## Phase 2.9: Characterization Tests (Geplant)

**Originalplan:** `docs/phase-2.9-characterization-tests-plan.md`  
**Status:** 📋 **planned** (noch nicht begonnen)

### Ziel

Characterization Tests dokumentieren das **tatsächliche Verhalten** bestehender, schwer testbarer Module. Sie dienen als Safety-Netz für zukünftige Refactorings.

### Kandidaten für Characterization Tests

#### A) CodeParser (bereits teilweise umgesetzt)

**Datei:** `shared/code-parser.ts` (68 Zeilen, stark reduziert durch Phase 2.10)

**Status:** ✅ Characterization Tests vorhanden (Phase 2.10)

#### B) IORegistryParser

**Datei:** `shared/io-registry-parser.ts` (665 Zeilen)

**Geplante Tests:**
- [ ] `parseIORegistry(code)` – Vollständige Registry-Parsing
- [ ] `findPinDefinitions(code)` – Pin-Definitionen extrahieren
- [ ] `findAnalogReads(code)` – Analog-Reads erkennen
- [ ] `findDigitalWrites(code)` – Digital-Writes erkennen
- [ ] Edge Cases: Leerer Code, Syntax-Fehler, komplexe Ausdrücke

#### C) ExecutionManager

**Datei:** `server/services/sandbox/execution-manager.ts` (674 Zeilen, reduziert durch Phase 2.6)

**Geplante Tests:**
- [ ] `performCompilation()` – Compilation mit Gatekeeper
- [ ] `executeSketch()` – Sandbox-Ausführung
- [ ] `cleanup()` – Resource-Cleanup
- [ ] Timeout-Handling
- [ ] Error-Handling (Docker-Fehler, Compiler-Fehler)

#### D) WebSocket-Handler

**Datei:** `server/routes/simulation.ws.ts` (1004 Zeilen)

**Geplante Tests:**
- [ ] `handleStartSimulation()` – Start-Flow
- [ ] `handleStopSimulation()` – Stop-Flow
- [ ] `handlePauseSimulation()` – Pause-Flow
- [ ] `handleResumeSimulation()` – Resume-Flow
- [ ] Session-Management
- [ ] Runner-Acquire/Release

### Test-Strategie

#### Pattern: Characterization Test

```typescript
describe('IORegistryParser', () => {
  describe('parseIORegistry', () => {
    it('extrahiert pinMode(INPUT) Aufrufe', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
          pinMode(2, INPUT);
        }
      `;
      const result = parseIORegistry(code);
      expect(result.pinModeCalls).toEqual([
        { pin: 13, mode: 'OUTPUT', line: 2 },
        { pin: 2, mode: 'INPUT', line: 3 },
      ]);
    });
  });
});
```

#### Pattern: Golden Master

Für komplexe Flows:

1. **Bestehendes Verhalten aufzeichnen** (Logging, Snapshots)
2. **Golden Master erstellen** (erwartete Ausgabe)
3. **Test gegen Golden Master** (darf sich nicht ändern)
4. **Bei Refactoring:** Golden Master bewusst aktualisieren

### Erfolgskriterien

- ✅ Characterization Tests für alle 4 Kandidaten
- ✅ Coverage >80% für getestete Module
- ✅ Tests dokumentieren tatsächliches Verhalten
- ✅ Tests sind stabil (keine Flakiness)

### Aufwand-Schätzung

| Modul | Geschätzte Tests | Aufwand |
|-------|------------------|---------|
| IORegistryParser | ~15 Tests | 4-6 Stunden |
| ExecutionManager | ~20 Tests | 6-8 Stunden |
| WebSocket-Handler | ~25 Tests | 8-10 Stunden |
| **Gesamt** | **~60 Tests** | **18-24 Stunden** |

---

## Priorisierung und Nächste Schritte

### Priorität 1: Phase 2.7 Deferred auflösen

**Begründung:** Config-Drift ist technisches Risiko, Security-Parameter sind Production-Blocker

**Empfohlene Reihenfolge:**
1. Worker-Pool-Konfiguration (niedrigstes Risiko, schnellste Umsetzung)
2. Sandbox-Output-/Timeout-Limits (mittleres Risiko, Performance-Tests nötig)
3. Docker-Container-Sicherheitsparameter (höchstes Risiko, ADR 0001 nötig)

**Geschätzter Aufwand:** 8-12 Stunden

### Priorität 2: Phase 2.9 Characterization Tests

**Begründung:** Safety-Netz für zukünftige Refactorings (Phase 3.x)

**Empfohlene Reihenfolge:**
1. IORegistryParser (niedrigstes Risiko, isoliert testbar)
2. ExecutionManager (mittleres Risiko, Phase 2.6 hat schon Tests)
3. WebSocket-Handler (höchstes Risiko, komplexe Abhängigkeiten)

**Geschätzter Aufwand:** 18-24 Stunden

### Priorität 3: Phase 2.8 Wrapper-Hooks

**Begründung:** Naming-Konsistenz ist wichtig, aber kein Production-Blocker

**Empfohlene Reihenfolge:**
1. Inventar erstellen (1-2 Stunden)
2. Namenskonvention definieren (ADR, 2-4 Stunden)
3. Migrationsplan (4-6 Stunden)
4. Umsetzung (inkrementell, mehrere Commits)

**Geschätzter Aufwand:** 20-30 Stunden (inkrementell)

---

## Verbindlichkeit

Diese deferred Items sind **keine optionalen Verbesserungen**, sondern bewusste Rückstellungen. Sie sollten in folgenden Fällen priorisiert werden:

1. **Production-Deployment:** Phase 2.7 Security-Parameter müssen vor Production-Release umgesetzt werden
2. **Refactoring-Vorbereitung:** Phase 2.9 Characterization Tests sollten vor Phase 3.x Refactorings geschrieben werden
3. **Team-Onboarding:** Phase 2.8 Hook-Namenskonvention sollte vor neuen Team-Mitgliedern geklärt werden

---

## Dokumente

- `docs/phase-2.7-configuration-centralization-plan.md` – Originalplan (bleibt in docs/)
- `docs/phase-2.8-wrapper-hooks-plan.md` – Originalplan (bleibt in docs/)
- `docs/phase-2.9-characterization-tests-plan.md` – Originalplan (bleibt in docs/)

---

**Erstellt:** 2026-09-05 im Rahmen von Phase 3.1.5  
**Autor:** GitHub Copilot  
**Status:** Ready for implementation
