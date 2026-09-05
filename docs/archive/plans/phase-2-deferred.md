# Phase 2 Deferred Plans Summary

**Status:** deferred  
**Datum:** 2026-09-05  
**Branch:** `feature/refactor/phase-2-execution-manager`

---

## Übersicht

Dieses Dokument fasst die zurückgestellten (deferred) Teile von Phase 2 zusammen. Diese Items wurden bewusst nicht in der aktuellen Implementierung umgesetzt, bleiben aber als verbindliche Planung erhalten.

**Hinweis:** Phase 2.8 (Wrapper-Hooks) und Phase 2.9 (Characterization Tests) wurden abgeschlossen und sind nicht mehr deferred.

---

## Phase 2.7: Konfigurationszentralisierung (Deferred Items)

**Originalplan:** `docs/phase-2.7-configuration-centralization-plan.md`  
**Status:** ⚠️ **completed with deferred items**

### Umgesetzt ✅

- ✅ `server/config.ts` als zentrale Konfigurationsquelle etabliert
- ✅ Environment-Parser mit Type-Safety implementiert
- ✅ Start-Logging auf Config umgestellt (Teilstep 2.7.1 completed)
- ✅ Weitere Teilsteps umgesetzt (2.7.2, 2.7.3, 2.7.5, 2.7.6, 2.7.7, 2.7.9, 2.7.11)

### Deferred 📋

Folgende Teilsteps wurden bewusst zurückgestellt:

#### Teilstep 2.7.4 — Arduino CLI Timeout zentralen Compile-Timeout verwenden

**Betroffene Dateien:**
- `server/services/compiler/cli-runner.ts`

**Grund für Deferred:**
- Die Realität weicht vom Plan ab: `CLICompileConfig` enthält keinen Timeoutwert
- Eine Umsetzung wäre nicht nur ein Wertetausch, sondern ein zusätzlicher Import/API-Umbau
- Wegen der Planvorgabe, bei abweichender Realität zu stoppen, wurde dieser Teilstep nicht umgesetzt

**Empfohlenes Vorgehen:**
1. Separate Analyse der `CLICompileConfig`-Struktur
2. Prüfen, ob Timeout-Property hinzugefügt werden kann ohne Breaking Changes
3. Ggf. separaten Refactoring-Step planen

#### Teilstep 2.7.8 — Gatekeeper-Disable-Mechanik separat analysieren und ggf. kapseln

**Betroffene Dateien:**
- `server/services/unified-gatekeeper.ts`
- `server/services/workers/compile-worker.ts`

**Grund für Deferred:**
- Die Mechanik ist ein runtime-mutiertes Worker-Thread-Signal (`COMPILE_GATEKEEPER_DISABLED`)
- Kein normaler statischer Config-Wert
- Wegen der Verwechslungsgefahr mit `config.compilation.disableGatekeeper` bleibt der direkte Zugriff zunächst bewusst lokal

**Empfohlenes Vorgehen:**
1. Separate Analyse der Worker-Thread-Kommunikation
2. Prüfen, ob Kapselung in `config.isCompileGatekeeperDisabled()` sinnvoll ist
3. Auf zeitliche Auswertungsreihenfolge achten (statische Config vs. runtime-setzen)

#### Teilstep 2.7.10 — `LocalCompiler` Timeout separat behandeln

**Betroffene Dateien:**
- `server/services/local-compiler.ts`

**Grund für Deferred:**
- `LocalCompiler` verwendet `20_000` mehrfach und erhöht bei Coverage dynamisch auf `60_000`
- Ob der lokale Default bewusst kürzer als `config.compilation.timeoutMs` ist, ist nicht eindeutig nachweisbar
- Keine Änderung ohne separate Freigabe

**Empfohlenes Vorgehen:**
1. Klären, ob `20_000` bewusst schnellerer lokaler Timeout ist
2. Prüfen, ob Tests an schnellerem Fail hängen
3. Separate Entscheidung über Default-Wert

#### Teilstep 2.7.12 — Worker-Cache-Konfiguration separat behandeln

**Betroffene Dateien:**
- `server/services/workers/compile-worker.ts`
- `server/services/workers/compile-worker-utils.ts`

**Grund für Deferred:**
- Die Pfadabweichung zwischen Worker (`storage/binaries`) und `ArduinoCompiler` (`config.compilation.buildCacheDir/binaries`) ist real
- Fachlich nicht eindeutig, ob historische Drift oder absichtliche Trennung
- Eine Zentralisierung könnte Cache-Orte verändern

**Empfohlenes Vorgehen:**
1. Separate Klärung der Cache-Pfad-Strategie
2. Prüfen, ob Pfade äquivalent sind oder bewusst getrennt
3. Ggf. separaten Refactoring-Step für Cache-Zentralisierung

---

## Phase 2.8: Wrapper-Hooks Refactoring

**Originalplan:** `docs/phase-2.8-wrapper-hooks-plan.md`  
**Status:** ✅ **completed**

### Zusammenfassung

Phase 2.8 wurde abgeschlossen. Redundante Pass-through-Hooks wurden identifiziert und entfernt, ohne sinnvolle Abstraktionen zu zerstören.

**Ergebnisse:**
- Inventar aller Hooks im Client erstellt
- Klassifikation nach: sinnvolle Abstraktion, unnötiger Pass-through, historisch/legacy
- Entfernung von Hooks ohne eigene Logik
- Bewahrung von Hooks mit State-Management, Side-Effects oder Fachlichkeit

**Keine deferred Items.**

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

## Phase 2.9: Characterization Tests

**Originalplan:** `docs/phase-2.9-characterization-tests-plan.md`  
**Status:** ✅ **completed**

### Zusammenfassung

Phase 2.9 wurde abgeschlossen. Relevante Verhaltenspfade der Arduino-Simulation wurden durch Charakterisierungstests abgesichert.

**Ergebnisse:**
- Inventarisierung bestehender Charakterisierungs-, Integrations- und E2E-Tests
- Gap-Analyse gegen relevante Refactoring-Grenzen
- Klassifikation bestehender Tests
- Neue Charakterisierungstests für identifizierte Lücken

**Bestehende Tests:**
- `use-compile-and-run.characterization.test.tsx` (5 Tests)
- Output-Panel-Integrationstests
- Parser-Messages-Integrationstests
- Serial-Renderer-Tests
- WebSocket-Manager-Tests
- Backend-Health-Tests

**Keine deferred Items.**

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

**Begründung:** Config-Drift ist technisches Risiko, einige deferred Items blockieren Production-Deployment

**Empfohlene Reihenfolge:**
1. **Teilstep 2.7.4** — Arduino CLI Timeout (niedrigstes Risiko, API-Analyse nötig)
2. **Teilstep 2.7.10** — LocalCompiler Timeout (mittleres Risiko, Default-Wert klären)
3. **Teilstep 2.7.8** — Gatekeeper-Disable-Mechanik (höheres Risiko, Worker-Thread-Kommunikation)
4. **Teilstep 2.7.12** — Worker-Cache-Konfiguration (höchstes Risiko, Cache-Pfade klären)

**Geschätzter Aufwand:** 8-12 Stunden

### Phase 2.8 und 2.9: Bereits abgeschlossen

- ✅ **Phase 2.8** (Wrapper-Hooks Refactoring) — completed
- ✅ **Phase 2.9** (Characterization Tests) — completed

Keine weiteren Maßnahmen erforderlich.

---

## Verbindlichkeit

Diese deferred Items sind **keine optionalen Verbesserungen**, sondern bewusste Rückstellungen. Sie sollten in folgenden Fällen priorisiert werden:

1. **Production-Deployment:** Phase 2.7 Timeout- und Cache-Konfiguration sollten vor Production-Release geklärt werden
2. **Config-Konsistenz:** Teilstep 2.7.4/2.7.10 für einheitliche Timeout-Behandlung
3. **Worker-Optimierung:** Teilstep 2.7.12 für konsistente Cache-Pfade

---

## Dokumente

- `docs/phase-2.7-configuration-centralization-plan.md` – Originalplan (bleibt in docs/)
- `docs/phase-2.8-wrapper-hooks-plan.md` – Originalplan (completed, bleibt in docs/)
- `docs/phase-2.9-characterization-tests-plan.md` – Originalplan (completed, bleibt in docs/)

---

## Zusammenfassung der offenen Deferred-Punkte

### Tatsächlich offene Deferred-Items (Phase 2.7)

**Nur 4 Teilsteps sind deferred:**

1. **Teilstep 2.7.4** — Arduino CLI Timeout zentralisieren
   - Status: deferred (API weicht vom Plan ab)
   - Risiko: niedrig (API-Analyse nötig)

2. **Teilstep 2.7.8** — Gatekeeper-Disable-Mechanik kapseln
   - Status: deferred (Worker-Thread-Signal, kein statischer Config-Wert)
   - Risiko: mittel (zeitliche Auswertungsreihenfolge)

3. **Teilstep 2.7.10** — LocalCompiler Timeout behandeln
   - Status: deferred (Default-Wert unklar)
   - Risiko: mittel (semantische Änderung möglich)

4. **Teilstep 2.7.12** — Worker-Cache-Konfiguration zentralisieren
   - Status: deferred (Cache-Pfade unklar)
   - Risiko: hoch (könnte Cache-Orte verändern)

### Abgeschlossene Phasen

- ✅ **Phase 2.7** — Konfigurationszentralisierung (completed with deferred items)
- ✅ **Phase 2.8** — Wrapper-Hooks Refactoring (completed)
- ✅ **Phase 2.9** — Characterization Tests (completed)

---

**Erstellt:** 2026-09-05 im Rahmen von Phase 3.1.5  
**Aktualisiert:** 2026-09-05 (Korrektur: 2.8/2.9 als completed markiert)  
**Autor:** GitHub Copilot  
**Status:** Ready for implementation
