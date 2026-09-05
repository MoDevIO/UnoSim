# Phase-2.9-Ausführungsplan: Charakterisierungstests vervollständigen

**Status:** planned

**Grundlage:** Bestehende Charakterisierungs-, Integrations- und E2E-Tests im Repository.

**Ziel:** Relevante Verhaltenspfade der Arduino-Simulation durch Charakterisierungstests absichern. Keine Tests für Coverage, keine redundanten Tests, bestehende Tests bevorzugen.

**Scope:** Ausschließlich Testdateien in `tests/` und `e2e/`. Keine Änderungen an Produktivcode.

---

## 1. Scope / Non-Scope

### Scope

- Inventarisierung bestehender Charakterisierungs-, Integrations- und E2E-Tests
- Gap-Analyse gegen relevante Refactoring-Grenzen
- Klassifikation bestehender Tests (ausreichend, redundant, fehlt)
- Planung neuer Charakterisierungstests nur für echte Lücken
- Festlegung von Testebene, Fixtures,Mocks, Gates pro Teilstep

### Non-Scope

- Keine Produktivcode-Änderungen
- Keine bestehenden Assertions abschwächen
- Keine redundanten Tests erzeugen
- Keine Tests nur für Coverage-Zahlen
- Keine Umbenennung bestehender Tests

---

## 2. Inventar bestehender Tests (Stand: 2026-09-05)

### 2.1 Charakterisierungstests

| Testdatei | Abgedecktes Verhalten | Status |
|-----------|----------------------|--------|
| `tests/client/hooks/use-compile-and-run.characterization.test.tsx` | Compile-and-start success, start fallback, compile failure, backend disconnected, stop cleanup | ✅ **ausreichend** (5 Tests) |

### 2.2 Integrationstests (Client)

| Testdatei | Abgedecktes Verhalten | Status |
|-----------|----------------------|--------|
| `tests/client/output-panel-integration.test.tsx` | Output-Panel-Verhalten, Auto-Scroll, Clear | ✅ ausreichend |
| `tests/client/parser-messages-integration.test.tsx` | Parser-Messages, PinMode-Warnings | ✅ ausreichend |
| `tests/client/serial-renderer-stop-pause-resume.test.ts` | Serial-Rendering, Pause/Resume, Clear | ✅ ausreichend |
| `tests/client/websocket-manager.test.ts` | WebSocket-Reconnect, Connection-State | ✅ ausreichend |
| `tests/client/hooks/use-backend-health.test.tsx` | Backend-Polling, Unreachable-Detection, Recovery | ✅ ausreichend |
| `tests/client/hooks/use-compile-and-run.orchestrator.test.tsx` | Orchestrierung Compile → Start | ✅ ausreichend |
| `tests/client/hooks/use-simulation-controller.test.tsx` | Start/Stop/Pause/Resume, WebSocket-Send | ✅ ausreichend |
| `tests/client/hooks/useWebSocketHandler.test.ts` | WebSocket-Message-Dispatch, Pin/Serial-Handling | ✅ ausreichend |

### 2.3 Integrationstests (Server/Shared)

| Testdatei | Abgedecktes Verhalten | Status |
|-----------|----------------------|--------|
| `tests/server/pause-resume-timing.test.ts` | Pause/Resume-Timing, Millis-Freeze | ✅ ausreichend (heavy) |
| `tests/server/pause-resume-digitalread.test.ts` | DigitalRead nach Resume | ✅ ausreichend (heavy) |
| `tests/server/services/serial-stop-pause-resume.test.ts` | Serial-Output-Stop/Pause/Resume | ✅ ausreichend |
| `tests/server/services/sandbox-lifecycle.integration.test.ts` | Sandbox-Lifecycle, Compile/Run | ✅ ausreichend |
| `tests/server/telemetry-heartbeat-integration.test.ts` | Telemetry-Heartbeat | ✅ ausreichend |
| `tests/integration/simulation-state-sequence.test.ts` | State-Machine, WebSocket-Level | ✅ ausreichend |
| `tests/integration/serial-flow.test.ts` | Serial-Backpressure, Flow-Control | ✅ ausreichend |
| `tests/integration/compiler-canaries.test.ts` | Compiler-Canaries, Timeout | ✅ ausreichend |

### 2.4 E2E-Tests (Playwright)

| Testdatei | Abgedecktes Verhalten | Status |
|-----------|----------------------|--------|
| `e2e/smoke-and-flow.spec.ts` | Page-Load, Blink-Example (Golden Path), Dialogs | ✅ ausreichend |
| `e2e/visual-full-context.spec.ts` | Visuelle Regression, Full-Context | ✅ ausreichend |
| `e2e/arduino-board-header.spec.ts` | Arduino-Board-Header, Pin-Labels | ✅ ausreichend |
| `e2e/scalability-many-clients.spec.ts` | Skalierbarkeit (viele Clients) | ✅ ausreichend |

---

## 3. Coverage-Matrix der relevanten Verhaltenspfade

### 3.1 Compile → Start

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Compile success → Start simulation | `use-compile-and-run.characterization.test.tsx #1` | Charakterisierung | ✅ abgedeckt |
| Compile failure → No start | `use-compile-and-run.characterization.test.tsx #3` | Charakterisierung | ✅ abgedeckt |
| Backend unreachable → Early exit | `use-compile-and-run.characterization.test.tsx #4` | Charakterisierung | ✅ abgedeckt |
| Headers mitkompilieren | `use-compile-and-run.characterization.test.tsx #1` | Charakterisierung | ✅ abgedeckt |
| Code-Änderung nach Compile → Start mit altem Code | **FEHLT** | — | ❌ **Lücke** |

### 3.2 Compile-Fehler

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Compiler errors exposed | `use-compile-and-run.characterization.test.tsx #3` | Charakterisierung | ✅ abgedeckt |
| Parser warnings | `parser-messages-integration.test.tsx` | Integration | ✅ abgedeckt |
| Error-Glitch-Trigger | `use-compile-and-run.characterization.test.tsx #3` | Charakterisierung | ✅ abgedeckt |
| Multiple errors formatting | **FEHLT** | — | ⚠️ **kann ergänzt werden** |

### 3.3 Backend nicht erreichbar

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| ensureBackendConnected check | `use-compile-and-run.characterization.test.tsx #4` | Charakterisierung | ✅ abgedeckt |
| Backend-Polling | `use-backend-health.test.tsx` | Integration | ✅ abgedeckt |
| Recovery-Toast | `use-backend-health.test.tsx` | Integration | ✅ abgedeckt |
| WebSocket disconnected + Backend down | **FEHLT** | — | ⚠️ **kann ergänzt werden** |

### 3.4 Stop/Cleanup

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Stop immediate send | `use-compile-and-run.characterization.test.tsx #5` | Charakterisierung | ✅ abgedeckt |
| Serial event queue clear | `use-compile-and-run.characterization.test.tsx #5` | Charakterisierung | ✅ abgedeckt |
| Pin state preserved | `use-compile-and-run.characterization.test.tsx #5` | Charakterisierung | ✅ abgedeckt |
| Docker container cleanup | `sandbox-lifecycle.integration.test.ts` | Integration | ✅ abgedeckt |

### 3.5 Pause/Resume

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Pause stops output | `serial-stop-pause-resume.test.ts` | Integration | ✅ abgedeckt |
| Resume continues output | `serial-stop-pause-resume.test.ts` | Integration | ✅ abgedeckt |
| Millis freeze during pause | `pause-resume-timing.test.ts` | Integration (heavy) | ✅ abgedeckt |
| DigitalRead after resume | `pause-resume-digitalread.test.ts` | Integration (heavy) | ✅ abgedeckt |
| Pause/Resume state transitions | `use-simulation-controller.test.tsx` | Integration | ✅ abgedeckt |

### 3.6 Serial Input/Output

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Serial output rendering | `serial-monitor-baudrate-rendering.test.tsx` | Integration | ✅ abgedeckt |
| Serial input handling | `useSimulatorSerialPanel.test.ts` | Integration | ✅ abgedeckt |
| Backpressure handling | `serial-flow.test.ts` | Integration | ✅ abgedeckt |
| Baudrate simulation | `serial-monitor-baudrate-rendering.test.tsx` | Integration | ✅ abgedeckt |

### 3.7 WebSocket-Reconnect

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Connection state changes | `websocket-manager.test.ts` | Integration | ✅ abgedeckt |
| Reconnect on disconnect | `websocket-manager.test.ts` | Integration | ✅ abgedeckt |
| Message queue during reconnect | **FEHLT** | — | ⚠️ **kann ergänzt werden** |

### 3.8 Docker/Local-Pfade

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Docker compilation | `docker-security-contract.test.ts` | Integration | ✅ abgedeckt |
| Local fallback | **FEHLT** | — | ❓ **unklar ob benötigt** |

### 3.9 Timeout-/Cleanup-/Stream-/Prepare-/Start-Phasen (aus 2.6)

| Verhalten | Vorhandener Test | Testebene | Status |
|-----------|------------------|-----------|--------|
| Prepare phase (compilation) | `prepare-phase.test.ts` | Unit | ✅ abgedeckt |
| Gatekeeper timeout | `prepare-phase.test.ts` | Unit | ✅ abgedeckt |
| Cleanup execution | `sandbox-lifecycle.integration.test.ts` | Integration | ✅ abgedeckt |
| Stream handling | **FEHLT** | — | ⚠️ **kann ergänzt werden** |
| Start phase timeout | **FEHLT** | — | ⚠️ **kann ergänzt werden** |

---

## 4. Gap-Analyse

### 4.1 Kritische Lücken (❌)

| Lücke | Begründung | Priorität |
|-------|------------|-----------|
| **Code-Änderung nach Compile → Start mit altem Code** | Sicherstellen, dass nach Compile geänderter Code nicht gestartet wird | **HOCH** |

### 4.2 Ergänzbare Tests (⚠️)

| Lücke | Begründung | Priorität |
|-------|------------|-----------|
| Multiple errors formatting | Bessere Fehlerdarstellung bei mehreren Compiler-Fehlern | NIEDRIG |
| WebSocket disconnected + Backend down | Kombination beider Fehlerzustände | NIEDRIG |
| Message queue during reconnect | Verhalten bei Reconnect mit ausstehenden Nachrichten | NIEDRIG |
| Stream handling | Stream-Cleanup nach Simulation-Ende | NIEDRIG |
| Start phase timeout | Timeout-Handling beim Start-Vorgang | NIEDRIG |

### 4.3 Unklare Fälle (❓)

| Fall | Begründung | Entscheidung |
|------|------------|--------------|
| Local fallback Pfade | Unklar ob Local-Mode noch unterstützt wird | **prüfen** |

---

## 5. Geplante Teilsteps

### Teilstep 2.9.1 — Charakterisierungstest: Code-Änderung nach Compile

**Status:** planned

**Ziel:** Sicherstellen, dass nach erfolgreicher Compilation geänderter Code nicht gestartet wird.

**Betroffene Testdatei:**
- `tests/client/hooks/use-compile-and-run.characterization.test.tsx` (neuer Test #6)

**Zu sicherndes Verhalten:**
1. User kompiliert Code A → Compilation success
2. User ändert Code zu B (setIsModified(true))
3. User startet Simulation → Start mit Code A (nicht B!)
4. Code-Änderung wird ignoriert, letzter compilierter Code verwendet

**Testebene:** Charakterisierungstest (Integrationssafety-Net)

**Notwendige Fixtures/Mocks:**
- `apiRequest` Mock für Compile-Endpoint
- `useWebSocket` Mock für Start-Nachricht
- `setIsModified` Mock zur Verifikation
- Editor-Ref Mock mit `getValue()` für Code A und B

**Abbruchkriterien:**
- Test bricht bestehende Charakterisierungstests
- Test ist nicht aussagekräftig genug

**Gates:**
- `npm run test:unit -- tests/client/hooks/use-compile-and-run.characterization.test.tsx`
- `npm run check` (TypeScript)

**Commit-Grenze:**
- Nur Testdatei ändern
- Keine Produktivcode-Änderungen

**Empfohlene Commit-Message:**
```
test(phase-2.9.1): add characterization test for code change after compile

Ensures that code modified after successful compilation is not started.
Last compiled code is used, not current editor content.
```

---

### Teilstep 2.9.2 — Prüfung: Local-Mode-Pfade

**Status:** planned

**Ziel:** Klären ob Local-Mode (ohne Docker) noch unterstützt wird und Tests benötigt.

**Vorgehen:**
1. Codebase durchsuchen nach Local-Mode-Implementierung
2. `sandbox-runner.ts` prüfen auf Local-Mode-Pfade
3. Entscheidung: Tests ergänzen oder Local-Mode entfernen

**Mögliche Ergebnisse:**
- **Local-Mode existiert:** Tests für Local-Mode-Pfade planen (2.9.3+)
- **Local-Mode entfernt:** Teilstep abschließen, keine weiteren Tests

**Commit-Grenze:**
- Keine Code-Änderungen in diesem Schritt
- Nur Dokumentation/Plan-Update

---

### Teilstep 2.9.3+ — Ergänzende Tests (TBD)

**Status:** planned (abhängig von 2.9.2)

**Ziel:** Ergänzende Tests für niedrig-prioritäre Lücken hinzufügen.

**Kandidaten:**
1. Multiple errors formatting
2. WebSocket disconnected + Backend down
3. Message queue during reconnect
4. Stream handling
5. Start phase timeout

**Vorgehen:**
- Pro Lücke einen eigenen Teilstep
- Nur wenn klarer Mehrwert erkennbar
- Keine Tests "auf Vorrat"

---

## 6. Standard-Gates nach jedem Teilstep

**Minimal:**
- `npm run check` (TypeScript)
- `npm run test:unit -- tests/client/` (Client-Tests)
- `npm run test:unit -- tests/server/` (Server-Tests, falls betroffen)

**Für Charakterisierungstests zusätzlich:**
- Bestehende Charakterisierungstests müssen grün bleiben
- Keine redundanten Tests hinzufügen

**E2E-Validierung (optional):**
- `npm run test:e2e` (Smoke-Test, nur ausgewählte Tests)

---

## 7. Deferred-/Nicht-nötig-Kandidaten

### 7.1 Nicht nötig (bereits abgedeckt)

| Testidee | Begründung |
|----------|------------|
| Compile success → Start | ✅ Bereits in characterization.test.tsx #1 |
| Compile failure → No start | ✅ Bereits in characterization.test.tsx #3 |
| Backend unreachable check | ✅ Bereits in characterization.test.tsx #4 |
| Stop cleanup | ✅ Bereits in characterization.test.tsx #5 |
| Pause/Resume basic | ✅ Bereits in serial-stop-pause-resume.test.ts |
| Serial output | ✅ Bereits in serial-monitor-baudrate-rendering.test.tsx |
| WebSocket reconnect | ✅ Bereits in websocket-manager.test.ts |

### 7.2 Deferred (niedrige Priorität)

| Testidee | Begründung |
|----------|------------|
| Multiple errors formatting | Niedrige Priorität, kosmetisches Feature |
| WebSocket + Backend down combo | Edge-Case, sehr selten |
| Message queue during reconnect | Edge-Case, niedrige Priorität |
| Stream handling | Niedrige Priorität, intern |
| Start phase timeout | Niedrige Priorität, bereits teilweise abgedeckt |

### 7.3 Zu prüfen

| Testidee | Begründung |
|----------|------------|
| Local-Mode-Pfade | Unklar ob Local-Mode noch existiert |

---

## 8. Completion Criteria

Phase 2.9 gilt als abgeschlossen, wenn:

- ✅ Alle kritischen Lücken (❌) geschlossen sind
- ✅ Ergänzbare Tests (⚠️) bewertet wurden (mindestens Entscheidung getroffen)
- ✅ Unklare Fälle (❓) geklärt sind
- ✅ Keine redundanten Tests erzeugt wurden
- ✅ Keine bestehenden Assertions abgeschwächt wurden
- ✅ Alle Gates (TypeScript, Unit) grün sind
- ✅ Plan-Status auf `completed` gesetzt ist
- ✅ Keine Produktivcode-Änderungen durchgeführt wurden

---

## 9. Risiken

| Risiko | Wahrscheinlichkeit | Auswirkung | Gegenmaßnahme |
|--------|-------------------|------------|---------------|
| Test ist zu spezifisch | Mittel | Niedrig | Charakterisierungstest-Pattern befolgen |
| Test bricht nach Refactoring | Mittel | Mittel | Test als Dokumentation verwenden, anpassen |
| Lokaler Mode existiert nicht mehr | Niedrig | Niedrig | In 2.9.2 klären, ggf. Teilstep streichen |
| Edge-Case-Tests zu aufwändig | Niedrig | Niedrig | Priorität niedrig, kann deferred werden |

---

## 10. Zusammenfassung

**Bestehende Charakterisierungstests:** 1 Datei, 5 Tests (alle ausreichend)

**Inventarisierte Integrationstests:** 15+ Dateien (alle ausreichend)

**Inventarisierte E2E-Tests:** 4 Dateien (alle ausreichend)

**Kritische Lücken identifiziert:** 1 (Code-Änderung nach Compile)

**Ergänzbare Tests identifiziert:** 5 (niedrige Priorität)

**Geplante Teilsteps:** 2 (2.9.1: Kritische Lücke, 2.9.2: Local-Mode-Prüfung)

**Nächster Schritt:** Teilstep 2.9.1 umsetzen (Charakterisierungstest hinzufügen)

**Hinweis:** Dieser Plan ist verbindlich. Jede Abweichung muss im Plan dokumentiert werden.
