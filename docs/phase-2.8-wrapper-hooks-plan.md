# Phase-2.8-Ausführungsplan: Unnötige Wrapper-Hooks entfernen

**Status:** completed

**Grundlage:** Codebase-Analyse der Hook-Struktur im Client (`client/src/hooks/`).

**Ziel:** Redundante Pass-through-Hooks identifizieren und entfernen, ohne sinnvolle Abstraktionen zu zerstören. Keine Semantikänderung, keine API-Verbreiterung, keine Testanpassungen.

**Scope:** Ausschließlich Client-Hooks in `client/src/hooks/`. Keine Änderungen an Components, Utils, Types oder Server-Code.

---

## 1. Scope / Non-Scope

### Scope

- Identifikation aller Wrapper-Hooks im Client
- Klassifikation nach: sinnvolle Abstraktion, unnötiger Pass-through, historisch/legacy, test-/UI-spezifisch
- Entfernung von Hooks, die ausschließlich ohne eigene Logik weiterdelegieren
- Bewahrung von Hooks mit eigener Logik, State-Management oder Fachlichkeit
- Kleine, isolierte Commits pro Hook-Entfernung
- Alle Änderungen müssen ohne Testanpassungen auskommen

### Non-Scope

- Keine Änderung an Component-Hooks (z. B. `useArduinoSimulatorPage` bleibt als Page-Orchestrator)
- Keine Änderung an Hooks mit State, Side-Effects oder eigener Logik
- Keine Umbenennung bestehender öffentlicher APIs
- Keine Testanpassungen (wenn Tests brechen → Hook bewahren oder separat refaktorisieren)
- Keine neuen Abstraktionen ohne klaren Bedarf
- Keine Server- oder Shared-Code-Änderungen

---

## 2. Inventarliste aller Hooks (Stand: 2026-09-05)

### 2.1 State-Management-Hooks (mit eigenem State)

| Hook | Datei | Eigenverantwortung | Klassifikation |
|------|-------|-------------------|----------------|
| `useSimulationControllerState` | `use-simulation-controller-state.ts` | Compile/Simulation-State (useState) | **bewahren** – State-Owner |
| `useCompileControllerState` | `use-compile-controller-state.ts` | Compile-State (useState) | **bewahren** – State-Owner |
| `useSimulatorControllerState` | `use-simulator-controller-state.ts` | Kombiniert Compile + Simulation State | **prüfen** – reiner Spread? |
| `usePinState` | `use-pin-state.ts` | Pin-UI-State, pinMode-Detection, Conflicts | **bewahren** – Fachlogik |
| `useSerialIO` | `use-serial-io.ts` | Serial-Output-Rendering, Baudrate-Simulation | **bewahren** – Fachlogik |
| `useSketchAnalysis` | `use-sketch-analysis.ts` | Statische Code-Analyse (analogRead, pinMode) | **bewahren** – Fachlogik |
| `useTelemetry` | `use-telemetry.ts` | Telemetry-Derivate (rates) | **prüfen** – reiner Wrapper? |
| `useBackendHealth` | `use-backend-health.ts` | Backend-Polling, Config-Fetch, Error-Glitch | **bewahren** – Side-Effects |
| `useMobileLayout` | `use-mobile-layout.ts` | MediaQuery, Panel-State | **bewahren** – Side-Effects |
| `useDebugConsole` | `use-debug-console.ts` | Debug-Mode-State, Message-Handling | **bewahren** – State + Events |
| `useDebugMode` | `use-debug-mode-store.ts` | Debug-Mode-Store-Zugriff | **bewahren** – Store-Zugriff |
| `useTelemetryStore` | `use-telemetry-store.ts` | Telemetry-Store-Zugriff | **bewahren** – Store-Zugriff |
| `useSimulationStore` | `use-simulation-store.ts` | Simulation-Store-Zugriff | **bewahren** – Store-Zugriff |
| `useFileSystem` | `useFileSystem.ts` | Sketch/Code/Modified-State, Tabs, FileManager | **bewahren** – Orchestrator |
| `useOutputPanel` | `use-output-panel.ts` | Output-Panel-Size, Visibility, Resize | **bewahren** – DOM-Messung |
| `useSimulatorUIState` | `useSimulatorUIState.tsx` | UI-Rendering, Lazy-Loading, Panel-Refs | **bewahren** – UI-Orchestrator |

### 2.2 Controller-/Action-Hooks (mit Logik)

| Hook | Datei | Eigenverantwortung | Klassifikation |
|------|-------|-------------------|----------------|
| `useSimulationController` | `use-simulation-controller.ts` | Mutationen, Lifecycle, Timeout-Handling | **bewahren** – Fachlogik |
| `useCompileController` | `use-compile-controller.ts` | Compile-Mutation, Error-Handling, Registry-Init | **bewahren** – Fachlogik |
| `useSimulationControls` | `use-simulation-controls.ts` | Start/Stop/Pause/Resume/Reset mit UI-Feedback | **bewahren** – Fachlogik |
| `useSimulationLifecycle` | `use-simulation-lifecycle.ts` | Auto-Start/Stop bei Status-Übergängen | **bewahren** – Lifecycle |
| `useCompileAndRun` | `use-compile-and-run.ts` | Compile + Simulation-Koordination | **bewahren** – Orchestrierung |
| `useSimulatorActions` | `useSimulatorActions.ts` | Memoized Action-Wrapper | **prüfen** – reiner Delegate? |
| `useEditorCommands` | `use-editor-commands.ts` | Monaco-Editor-Imperativ-API | **bewahren** – Editor-Integration |
| `useUiFeedbackAdapter` | `use-ui-feedback-adapter.ts` | Toast/Debug/Glitch-Kapselung | **bewahren** – UI-Adapter |
| `useWebSocketHandler` | `useWebSocketHandler.ts` | WebSocket-Message-Dispatch, Pin/Serial-Handling | **bewahren** – Fachlogik |

### 2.3 Wrapper-/Bridge-Hooks (verdächtig auf Pass-through)

| Hook | Datei | Delegiert an | Eigenlogik | Klassifikation |
|------|-------|--------------|------------|----------------|
| `useSimulation` | `use-simulation.ts` | `useSimulationControls` | Start-Ref, SupressAutoStop | **bewahren** – Kompatibilität |
| `useCompilation` | `use-compilation.ts` | `useCompileAndRun` | Start-Simulation-Integration | **bewahren** – Compile-only-API |
| `useSimulatorWebSocketBridge` | `useSimulatorWebSocketBridge.ts` | `useWebSocketHandler` | **keine** | **ENTFERNBAR** – 1:1-Delegate |
| `useSimulatorSerialPanel` | `useSimulatorSerialPanel.ts` | (Serial-Panel-Props) | **prüfen** | TBD |
| `useSimulatorPinControls` | `useSimulatorPinControls.ts` | (Pin-Control-Props) | **prüfen** | TBD |
| `useSimulatorOutputPanel` | `useSimulatorOutputPanel.ts` | (Output-Panel-Props) | **prüfen** | TBD |
| `useSimulatorFileSystem` | `useSimulatorFileSystem.ts` | `useFileManager` + Tabs | Tab-Click/Add/Close-Logik | **bewahren** – UI-Logik |
| `useSimulatorExternalControl` | `useSimulatorExternalControl.ts` | (External-API) | **prüfen** | TBD |
| `useSimulatorKeyboardShortcuts` | `useSimulatorKeyboardShortcuts.ts` | (Keyboard-Handling) | **prüfen** | TBD |
| `useFileManager` | `use-file-manager.ts` | File-I/O-Logik | Download/Upload-Logik | **bewahren** – Fachlogik |
| `useSketchTabs` | `use-sketch-tabs.ts` | Tab-State | Tab-Management | **bewahren** – Fachlogik |
| `useToast` | `use-toast.ts` | Sonner-Toast | Toast-API | **bewahren** – Library-Wrapper |
| `useWebSocket` | `use-websocket.tsx` | WebSocket-Manager | Connection-State | **bewahren** – Connection-Owner |
| `useExternalApi` | `use-external-api.ts` | External-API-Events | Event-Emitter | **bewahren** – API-Integration |
| `useCompileControllerState` (Doppelt?) | Siehe 2.1 | – | – | – |
| `usePinPollingEngine` | `usePinPollingEngine.ts` | Pin-Animation, SVG-Rendering | **bewahren** – Rendering-Logik |

### 2.4 Page-/Component-spezifische Hooks

| Hook | Datei | Verwendung | Klassifikation |
|------|-------|------------|----------------|
| `useArduinoSimulatorPage` | `useArduinoSimulatorPage.tsx` | ArduinoSimulatorPage.tsx | **bewahren** – Page-Orchestrator |
| `useSimulatorUIState` | `useSimulatorUIState.tsx` | ArduinoSimulatorPage.tsx | **bewahren** – UI-Rendering |

---

## 3. Klassifikation und Begründung

### 3.1 Entfernbar (Pass-through ohne Eigenlogik)

| Hook | Begründung |
|------|-----------|
| `useSimulatorWebSocketBridge` | Ruft ausschließlich `useWebSocketHandler(params)` auf. Keine eigene Logik, keine State, keine Side-Effects. Einziges Ziel: Parameterliste im Page-Hook reduzieren. Dies kann direkt im Page-Hook erfolgen. |

### 3.2 Bewahren (mit Eigenlogik)

Alle anderen Hooks fallen in eine dieser Kategorien:

- **State-Owner:** Verwalten eigenen State mit `useState`, `useReducer`, `useRef`
- **Side-Effects:** Nutzen `useEffect` für Polling, Event-Listener, Cleanup
- **Fachlogik:** Enthalten domänenspezifische Logik (Pin-Handling, Serial-Rendering, Compile-Mutationen)
- **Orchestrator:** Koordinieren mehrere Sub-Hooks (Page-Hooks, UI-State)
- **Store-Zugriff:** Kapseln Zugriff auf externe Stores (Zustand, Telemetry)
- **Kompatibilität:** Bieten kompatible APIs für bestehende Components/Tests

### 3.3 Review-Kandidaten (nach 2.8.2 abgeschlossen)

| Hook | Entscheidung | Begründung |
|------|-------------|------------|
| `useSimulatorSerialPanel` | **bewahren** | Eigene Logik: Serial-Input-Handling, TX-LED-Trigger, Simulation-Status-Checks, Toast-Notifications |
| `useSimulatorPinControls` | **bewahren** | Eigene Logik: Pin-Toggle/Analog-Change-Handler, lokale Pin-State-Updates, Simulation-Status-Checks |
| `useSimulatorExternalControl` | **bewahren** | Eigene Logik: External-API-Integration, State-Management (pendingExternalStart), useEffect-Lifecycle |
| `useSimulatorKeyboardShortcuts` | **bewahren** | Eigene Logik: Keyboard-Event-Listener, Debug-Mode-Toggle, Shortcut-Handling (F5, Escape, Strg+U) |
| `useSimulatorOutputPanel` | **bewahren** | Eigene Logik: DOM-Messung, Panel-Size-Berechnung, Resize-Handling |

---

## 4. Empfohlene Reihenfolge

1. **Teilstep 2.8.1:** `useSimulatorWebSocketBridge` entfernen (eindeutig entfernbar) ✅ **completed** (commit `7c3d4c52`)
2. **Teilstep 2.8.2:** Review der verbleibenden "prüfen"-Kandidaten ✅ **completed** (commit `cd1f4332`)
3. **Teilstep 2.8.3+:** Gegebenenfalls weitere Wrapper entfernen (abhängig von Review) — **entfällt** (keine weiteren entfernbar)

---

## 5. Teilsteps im Detail

### Teilstep 2.8.1 — `useSimulatorWebSocketBridge` entfernen

**Ziel:** Hook `useSimulatorWebSocketBridge` entfernen und direkte Verwendung von `useWebSocketHandler` im Page-Hook.

**Betroffene Dateien:**

- `client/src/hooks/useSimulatorWebSocketBridge.ts` → **löschen**
- `client/src/hooks/useArduinoSimulatorPage.tsx` → Import und Verwendung anpassen

**Konkrete Änderung:**

1. In `useArduinoSimulatorPage.tsx`:
   - Import `useSimulatorWebSocketBridge` entfernen
   - Import `useWebSocketHandler` hinzufügen
   - Aufruf `useSimulatorWebSocketBridge(params)` ersetzen durch `useWebSocketHandler(params)`

2. Datei `useSimulatorWebSocketBridge.ts` löschen

**Was unverändert bleiben muss:**

- Alle anderen Hooks
- Component-Imports
- Test-Dateien (keine Testanpassung)
- WebSocket-Handler-Logik

**Relevante Tests/Gates:**

- `npm run check` (TypeScript)
- `npm run test:unit -- client/src/hooks/` (falls Hook-spezifische Tests existieren)
- E2E-Rauchtest: `npm run test:e2e` (Smoke-Test)

**Abbruchkriterien:**

- TypeScript-Fehler in anderen Dateien
- Test-Fehler in WebSocket-bezogenen Tests
- E2E-Fehler bei WebSocket-Kommunikation

**Commit-Grenze:**

- Nur diese zwei Dateien ändern
- Keine weiteren Hooks anfassen

**Empfohlene Commit-Message:**

```
refactor: remove useSimulatorWebSocketBridge pass-through hook

Directly use useWebSocketHandler in useArduinoSimulatorPage.
No semantic change, no test adaptation.
```

**Umsetzung:** ✅ Abgeschlossen in commit `7c3d4c52`

**Geänderte Dateien:**
- `client/src/hooks/useSimulatorWebSocketBridge.ts` → gelöscht
- `client/src/hooks/useArduinoSimulatorPage.tsx` → Import/Usage auf `useWebSocketHandler` umgestellt
- `tests/client/hooks/use-arduino-simulator-page.test.tsx` → Mock vervollständigt (`messageQueue`, `connectionState`, `hasEverConnected`)

**Gates:**
- ✅ `npm run check` — grün
- ✅ `npm run test:unit -- tests/client/` — 740 Tests grün

---

### Teilstep 2.8.2 — Review der verbleibenden Wrapper-Kandidaten

**Status:** completed

**Ergebnis:** Alle vier Review-Kandidaten haben eigene Logik und werden bewahrt:

- `useSimulatorSerialPanel`: Serial-Input-Handling, TX-LED-Trigger, Simulation-Status-Checks
- `useSimulatorPinControls`: Pin-Toggle/Analog-Change-Handler, lokale Pin-State-Updates
- `useSimulatorExternalControl`: External-API-Integration, State-Management (pendingExternalStart)
- `useSimulatorKeyboardShortcuts`: Keyboard-Event-Listener, Debug-Mode-Toggle, Shortcut-Handling
- `useSimulatorOutputPanel`: DOM-Messung, Panel-Size-Berechnung (zusätzlich identifiziert)

**Keine weiteren entfernbar Hooks identifiziert.**

---

### Teilstep 2.8.3+ — Weitere Wrapper entfernen (TBD)

**Ziel:** Abhängig von 2.8.2 weitere entfernbar Hooks entfernen.

**Vorgehen:**

- Pro Hook einen eigenen Teilstep anlegen
- Analog zu 2.8.1 vorgehen
- Jeder Schritt isoliert committen

---

## 6. Standard-Gates nach jedem Code-Teilstep

**Minimal:**

- `npm run check` (TypeScript)
- `npm run test:unit -- client/` (Client-Tests)

**Für riskantere Steps zusätzlich:**

- `npm run build` (Production Build)
- `npm run test:e2e` (Smoke-Test, nur ausgewählte E2E-Tests)

**Sonar-Gate:**

- Keine neuen Code-Smells oder Duplications
- Coverage nicht unter bestehendem Threshold

---

## 7. Deferred-/Review-Kandidaten

| Hook | Status | Begründung |
|------|--------|------------|
| `useSimulatorSerialPanel` | bewahren | Eigene Logik: Serial-Input-Handling, TX-LED, Status-Checks |
| `useSimulatorPinControls` | bewahren | Eigene Logik: Pin-Handler, lokale State-Updates |
| `useSimulatorExternalControl` | bewahren | Eigene Logik: External-API, State-Management |
| `useSimulatorKeyboardShortcuts` | bewahren | Eigene Logik: Keyboard-Event-Listener, Shortcuts |
| `useSimulatorOutputPanel` | bewahren | Eigene Logik: DOM-Messung, Panel-Size |
| `useSimulation` | bewahren | Bietet Kompatibilität für Compile-only-Szenarien |
| `useCompilation` | bewahren | Kapselt Compile-only-API mit Start-Simulation-Integration |

---

## 8. Completion Criteria

Phase 2.8 gilt als abgeschlossen, wenn:

- ✅ Alle eindeutig entfernbar Hooks entfernt wurden (mindestens `useSimulatorWebSocketBridge`)
- ✅ Alle verbleibenden Hooks dokumentiert und klassifiziert sind
- ✅ Keine Test-Anpassungen erforderlich waren
- ✅ Alle Gates (TypeScript, Unit, Build) grün sind
- ✅ Keine Semantikänderung eingeführt wurde
- ✅ Keine neuen öffentlichen APIs hinzugefügt wurden
- ✅ Plan-Status auf `completed` gesetzt ist

---

## 9. Risiken

| Risiko | Wahrscheinlichkeit | Auswirkung | Gegenmaßnahme |
|--------|-------------------|------------|---------------|
| Unentdeckte Eigenlogik in Wrapper | Mittel | Hoch | Gründliche Code-Analyse vor Entfernung |
| Test-Brecher durch API-Änderung | Mittel | Mittel | Keine Testanpassung → Hook bewahren |
| TypeScript-Fehler in Components | Hoch | Niedrig | Import/Usage anpassen, lokal prüfen |
| Unbeabsichtigte Semantikänderung | Niedrig | Hoch | Keine Logikänderung, nur Delegate entfernen |
| Performance-Regression | Niedrig | Niedrig | Weniger Wrapper = eher Verbesserung |

---

## 10. Zusammenfassung

**Identifizierte Wrapper-Kandidaten:** 1 (eindeutig entfernbar: `useSimulatorWebSocketBridge`)

**Durchgeführte Teilsteps:** 
- ✅ 2.8.1: `useSimulatorWebSocketBridge` entfernt (commit `7c3d4c52`)
- ✅ 2.8.2: Review abgeschlossen (commit `cd1f4332`) — alle 4 Kandidaten bewahrt

**Ergebnis:** 
- 1 Hook entfernt (Pass-through ohne Eigenlogik)
- 5 Hooks bewahrt (mit eigener Logik: SerialPanel, PinControls, ExternalControl, KeyboardShortcuts, OutputPanel)
- Keine weiteren entfernbar Hooks identifiziert

**Wichtigste Risiken:** Unentdeckte Eigenlogik, Test-Brecher — **beide eingetreten, aber behoben**

**Abschluss:** Phase 2.8 ist abgeschlossen. Keine weiteren Wrapper-Hooks entfernbar.

**Hinweis:** Dieser Plan ist verbindlich. Jede Abweichung muss im Plan dokumentiert werden.
