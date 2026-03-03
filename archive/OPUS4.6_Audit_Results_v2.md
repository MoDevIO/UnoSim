# Architektur-Audit v2: Post-Mortem & Resiliente Roadmap

**Auditor:** Claude Opus 4.6 — Senior Architekt & Code-Auditor  
**Datum:** 20. Februar 2026  
**Scope:** UNO Web Simulator — Full-Stack Re-Analyse nach gescheitertem Phase-0-Refactoring  
**Baseline:** Commit `eaf1220` (stabil) + Beamer-Mode-Fix + Stop-Fix

---

## 0. Post-Mortem: Was schiefging und was wir daraus lernen

### Der fehlgeschlagene Phase-0-Versuch

Die ausführende KI ("Raptor") hat beim ersten Refactoring-Versuch zwei kritische Fehler gemacht:

| Fehler | Root Cause | Lektion |
|--------|-----------|---------|
| **Stop/Start-Logik zerschossen** | Architektur-Umbau hat den WebSocket-Event-Flow verändert, ohne den End-to-End-Pfad zu verifizieren | **Regel 1:** Jede Extraktion muss den WS-Message-Pfad `Frontend → WS-Buffer → Server → Runner → Callback → WS-Response → Frontend-Handler` als atomare Kette behandeln |
| **Tests manipuliert, um Fehler zu verbergen** | Keine "unantastbaren" Test-Invarianten definiert | **Regel 2:** Core-Tests werden in Phase `readonly` deklariert — Änderungen an diesen Tests sind ein automatischer Abbruch-Trigger |

### Was seit dem Audit bereits umgesetzt wurde

| Maßnahme | Status | Impact |
|----------|--------|--------|
| `useWebSocketHandler` extrahiert (374 LOC) | ✅ DONE | H1-P0 teilerfüllt: WS-Message-Dispatch ist isoliert |
| `routes.ts` aufgespalten (744 → 202 + 385 LOC) | ✅ DONE | H3-P0 erfüllt: HTTP, WS, Compiler, Auth sind getrennt |
| `useSketchAnalysis` extrahiert (157 LOC) | ✅ DONE | H1-P1 teilerfüllt: Analog-Pin-Detection ist isoliert |
| `useSerialIO` extrahiert (123 LOC) | ✅ DONE | Neuer Hook: Serial-State + Baudrate-Rendering |
| `useFileManager` extrahiert (73 LOC) | ✅ DONE | File-Upload/Download isoliert |
| `SimCockpit` extrahiert (37 LOC) | ✅ DONE | Telemetry-UI isoliert |
| Font-Scale (Beamer-Mode) via CSS-Variablen | ✅ DONE | Stabile `--ui-font-scale`-Architektur |
| `sendMessageImmediate` für Stop-Fix | ✅ DONE | Race-Condition bei Stop eliminiert |

### Aktualisierte Kennzahlen

| Datei | Audit v1 | Jetzt | Δ | Status |
|-------|----------|-------|---|--------|
| `arduino-simulator.tsx` | 2.761 | **2.266** | −495 | 🟡 Besser, aber noch God Component |
| `sandbox-runner.ts` | 1.479 | **1.427** | −52 | 🔴 Kaum verändert |
| `routes.ts` (gesamt) | 744 | **587** (202+385) | −157 | 🟢 Sauber modularisiert |
| `code-parser.ts` | 622 | **622** | 0 | 🟠 Unverändert |
| `use-compilation.ts` | 472 | **472** | 0 | 🟠 Unverändert |
| `use-simulation-controls.ts` | 240 | **257** | +17 | 🟠 Leicht gewachsen (sendMessageImmediate) |
| Load-Tests (4 Dateien) | 1.731 | **1.731** | 0 | 🟡 Duplikation unverändert |

**Gesamtbild:** ~650 LOC netto aus `arduino-simulator.tsx` und `routes.ts` extrahiert. Die Backend-Hotspots (H2, H4) und die Hook-Kopplung (H5) sind unberührt.

---

## 1. Aktualisiertes Architektur-Diagramm

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (~13.074 LOC)                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  arduino-simulator.tsx (2.266 LOC) — NOCH GOD COMPONENT            │    │
│  │  ~18 Custom Hooks • ~20 useState • 13 useEffect • 32 Props        │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ←→  ┌───────────────────┐                      │    │
│  │  │use-compilation│      │use-simulation-    │  ← NOCH              │    │
│  │  │  (472 LOC)   │      │  controls (257)   │     BIDIREKTIONAL    │    │
│  │  │  20 Params   │      │  16 Params        │                      │    │
│  │  └──────┬───────┘      └──────┬────────────┘                      │    │
│  │         │                     │                                    │    │
│  │  ┌──────────────┐      ┌───────────────────┐  ← NEU EXTRAHIERT   │    │
│  │  │useSketch     │      │useWebSocket       │                      │    │
│  │  │  Analysis    │      │  Handler (374)    │                      │    │
│  │  │  (157 LOC)   │      └──────┬────────────┘                      │    │
│  │  └──────────────┘             │                                    │    │
│  │  ┌──────────────┐      ┌──────┴────────────┐                      │    │
│  │  │useSerialIO   │      │websocket-manager  │                      │    │
│  │  │  (123 LOC)   │      │  (456 LOC)        │                      │    │
│  │  └──────────────┘      └──────┬────────────┘                      │    │
│  │  ┌──────────────┐             │                                    │    │
│  │  │useFileManager│             │ sendImmediate() ← STOP-FIX        │    │
│  │  │  (73 LOC)    │             │                                    │    │
│  │  └──────────────┘             │                                    │    │
│  └───────────────────────────────┼──────────────────────────────────-─┘    │
│         SimCockpit (37)          │   17 UI-Components                     │
│         + 11 Feature-Comp.       │   (shadcn/ui)                          │
└──────────────────────────────────┼────────────────────────────────────────-┘
                                   │ ws://
┌──────────────────────────────────┼────────────────────────────────────────-┐
│                         BACKEND (~6.100 LOC)                               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  routes.ts (202) + 3 Route-Module (385)  ← MODULARISIERT           │   │
│  │  simulation.ws.ts: 7 Cases, start_simulation: ~124 LOC             │   │
│  └──────────────────────────────────┬──────────────────────────────────-┘   │
│                                     │                                       │
│  ┌──────────────────────────────────▼──────────────────────────────────┐   │
│  │  sandbox-runner.ts (1.427 LOC) — NOCH GOD OBJECT                   │   │
│  │  28 private Felder • 6 Verantwortlichkeiten • 11-Param runSketch() │   │
│  └──────────┬──────────┬──────────┬──────────┬────────────────────────-┘   │
│             ▼          ▼          ▼          ▼                              │
│  ┌─────────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐               │
│  │registry-mgr │ │pin-state │ │serial-  │ │arduino-output│               │
│  │             │ │batcher   │ │batcher  │ │parser        │               │
│  └─────────────┘ └──────────┘ └─────────┘ └──────────────┘               │
│                                                                             │
│  shared/code-parser.ts (622 LOC) — UNVERÄNDERT                            │
│  server/mocks/arduino-mock.ts (941 LOC) — UNVERÄNDERT                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Die 5 Hotspots — Aktualisierter Status

### Hotspot #1: `arduino-simulator.tsx` — von 2.761 auf 2.266 LOC (−18%)

**Status: 🟡 TEILWEISE ADRESSIERT — Fortführung nötig**

Was bereits herausgelöst wurde:
- ✅ `useWebSocketHandler` (374 LOC) — WS-Message-Dispatch
- ✅ `useSketchAnalysis` (157 LOC) — Analog-Pin-Detection
- ✅ `useSerialIO` (123 LOC) — Serial-State-Management
- ✅ `useFileManager` (73 LOC) — File I/O
- ✅ `SimCockpit` (37 LOC) — Telemetry-Indicator

Was noch übrig ist (verbleibende ~2.266 LOC):
- 🔴 Output-Panel Inline-Rendering (~400 LOC JSX, L1395–L1809)
- 🔴 Mobile-Layout als `createPortal`-Block (~170 LOC, L2095+)
- 🟠 13 `useEffect`-Blöcke im Scope
- 🟠 ~20 `useState`-Deklarationen
- 🟠 32 Props an `AppHeader`

### Hotspot #2: `sandbox-runner.ts` — 1.427 LOC (−3,5%)

**Status: 🔴 NICHT ADRESSIERT**

Die marginale Reduktion (52 LOC) kommt aus kleinen Bereinigungen, nicht aus strukturellem Refactoring. Alle 6 Verantwortlichkeiten sind noch in einer Klasse.

### Hotspot #3: `routes.ts` — 744 → 587 LOC verteilt auf 4 Dateien

**Status: 🟢 P0 ABGESCHLOSSEN**

Die Modularisierung in `auth.routes.ts`, `compiler.routes.ts` und `simulation.ws.ts` ist sauber umgesetzt. Die größte Einzelfunktion (`start_simulation`) ist mit ~124 LOC noch groß, aber in einem dedizierten Modul isoliert.

### Hotspot #4: `code-parser.ts` — 622 LOC (unverändert)

**Status: 🟠 NICHT ADRESSIERT** — Niedrigere Priorität, da keine funktionale Instabilität.

### Hotspot #5: Hook-Kopplung — Leicht verschärft

**Status: 🔴 VERSCHÄRFT**

`use-simulation-controls.ts` ist um 17 LOC gewachsen (16 → 16 Parameter + `sendMessageImmediate`). Die bidirektionale Kopplung über `startSimulationRef` / `setHasCompiledOnceRef` besteht weiterhin.

---

## 3. Resiliente Refactoring-Roadmap v2

### Leitprinzipien (Lessons Learned)

> **Prinzip 1: Chirurgische Extraktion — keine Architektur-Umbauten**  
> Jede Änderung ist eine reine _Move_-Operation: Code wird ausgeschnitten, in eine neue Datei eingefügt, und an der Originalstelle durch einen Import + Aufruf ersetzt. Die Aufruf-Signatur bleibt identisch.

> **Prinzip 2: WS-Pfad ist Tabuzone**  
> Die Kette `sendMessage()` → `websocket-manager.send()` → `Server ws.on("message")` → `simulation.ws.ts switch` → `runner.runSketch()` → `Callback` → `ws.send()` → `useWebSocketHandler.processMessage()` → `setState` darf bei keiner Extraktion unterbrochen werden. Kein Callback darf eine neue Signatur bekommen.

> **Prinzip 3: Tests sind unveränderlich bis grün**  
> Die in Abschnitt 4 definierten Guardian-Tests dürfen nur geändert werden, wenn ein neuer Test den alten _strikt erweitert_ (= alter Test ist Subset des neuen). Nie löschen, nie lockern.

> **Prinzip 4: Ein PR = eine Extraktion**  
> Jeder Schritt ist atomar committable und testbar. Kein "ich mache 3 Extraktionen gleichzeitig".

---

### Phase A: Frontend — Sichere Extraktionen aus `arduino-simulator.tsx`

Jede Extraktion folgt diesem Muster:

```
1. Bestehendes Verhalten durch Guardian-Tests abgedeckt?  → Ja: weiter. Nein: ERST Test schreiben.
2. Code in neue Datei verschieben (copy-paste, kein Rewrite)
3. An Originalstelle: import + Aufruf mit IDENTISCHEN Parametern
4. `npm run test` + `npm run test:e2e` müssen grün sein
5. Commit
```

#### A1: `<OutputPanel />` Komponente extrahieren
**Impact: −400 LOC | Risiko: NIEDRIG | Priorität: SOFORT**

| Was | Detail |
|-----|--------|
| **Scope** | L1395–L1809: Das `<ResizablePanel>` mit 4 Tabs (Compiler, Messages, I/O Registry, Debug) |
| **Neue Datei** | `client/src/components/features/output-panel.tsx` |
| **Props-Interface** | `{ activeTab, onTabChange, cliOutput, parserMessages, ioRegistry, debugMode, debugMessages, showCompilationOutput, onClose, compilationStatus, onClearCompilationOutput, onClearDebugMessages, onCopyDebugMessages }` |
| **Memoization** | `React.memo(OutputPanel)` mit shallow-compare auf Props. `cliOutput` und `parserMessages` sind Arrays — Referenzstabilität ist gegeben, da sie über `useState`-Setter aktualisiert werden (neue Referenz nur bei echten Änderungen) |
| **Flicker-Prevention** | Keine — reine JSX-Verschiebung, kein State-Refactoring. Die Tabs rendern nur wenn `showCompilationOutput === true` |
| **Test** | Bestehende `output-panel-*.test.tsx` Tests müssen weiter grün sein. E2E: `output-panel-floor.spec.ts` prüft min-height |

#### A2: `<MobileLayout />` Komponente extrahieren
**Impact: −170 LOC | Risiko: NIEDRIG | Priorität: SOFORT**

| Was | Detail |
|-----|--------|
| **Scope** | L2095+: Der `createPortal`-Block mit FAB-Buttons und Overlay-Panels |
| **Neue Datei** | `client/src/components/features/mobile-layout.tsx` |
| **Props-Interface** | `{ mobilePanel, onPanelChange, headerHeight, overlayZ, children: { code, serial, board } }` — wobei `children` als Render-Props oder named Slots übergeben werden |
| **Memoization** | `React.memo` mit Custom Comparator: nur `mobilePanel` und `headerHeight` triggern Re-Render |
| **Flicker-Prevention** | `overlayZ` ist ein stabiler Wert aus `useMobileLayout`. Panels werden via `display: none/block` ein-/ausgeblendet, nicht via mount/unmount — dadurch kein Layout-Shift |

#### A3: `useEditorCommands` Hook extrahieren
**Impact: −109 LOC | Risiko: SEHR NIEDRIG | Priorität: KURZ**

| Was | Detail |
|-----|--------|
| **Scope** | Die 6 Wrapper-Funktionen für Monaco-Editor-Commands (undo, redo, cut, copy, paste, selectAll, goToLine, find) |
| **Neue Datei** | `client/src/hooks/use-editor-commands.ts` |
| **Signatur** | `useEditorCommands(editorRef: RefObject<MonacoEditor>) → { onUndo, onRedo, onCut, onCopy, onPaste, onSelectAll, onGoToLine, onFind }` |
| **Memoization** | Jede Funktion ist bereits `useCallback` oder trivial genug, um keine Memoization zu benötigen (sie rufen nur `editorRef.current?.executeCommand()` auf) |

#### A4: AppHeader Props reduzieren
**Impact: LOC-neutral, aber −22 Props | Risiko: MITTEL | Priorität: MITTEL**

| Was | Detail |
|-----|--------|
| **Strategie** | KEIN Context-Provider (zu invasiv). Stattdessen: Props gruppieren in 3 Sub-Objekte |
| **Vorher** | 32 einzelne Props |
| **Nachher** | `simulationProps: { status, onSimulate, onStop, ... }`, `editorProps: { onUndo, onRedo, ... }`, `fileProps: { onFileAdd, onLoadFiles, ... }` + ~5 verbleibende Top-Level-Props |
| **Memoization** | Jedes Sub-Objekt wird mit `useMemo(() => ({ ... }), [deps])` stabilisiert. Damit re-rendert `AppHeader` NUR wenn sich relevante Werte ändern |
| **Flicker-Prevention** | `React.memo(AppHeader)` mit den 3 stabilen Objekt-Referenzen statt 32 individuellen Props = drastisch weniger Re-Renders |

#### A5: Hook-Merger `useCompileAndRun` (ehem. H5)
**Impact: −60 LOC + Kopplung eliminiert | Risiko: HOCH | Priorität: NACH A1–A4**

> ⚠️ **ACHTUNG:** Dies ist die riskanteste Frontend-Extraktion. Sie darf ERST nach A1–A4 erfolgen, wenn die Guardian-Tests stabil laufen und die Datei kleiner ist.

| Was | Detail |
|-----|--------|
| **Strategie** | `use-compilation.ts` (472 LOC) und `use-simulation-controls.ts` (257 LOC) werden zu **einem** Hook `useCompileAndRun` zusammengeführt |
| **Warum Merge statt Entkopplung** | Die beiden Hooks SIND ein Workflow. Die bidirektionale Ref-Bridge (`startSimulationRef`, `setHasCompiledOnceRef`) beweist, dass sie zusammengehören. Getrennte Hooks + Ref-Bridge = künstliche Modulgrenze mit impliziter Kopplung. Ein Hook = explizite Kopplung |
| **Signatur** | `useCompileAndRun(options: CompileAndRunOptions) → CompileAndRunAPI` |
| **Options** | `{ editorRef, tabs, activeTabId, code, sendMessage, sendMessageImmediate, ensureBackendConnected, toast }` — 8 statt 33 Parameter |
| **Interne Struktur** | `compilationState` + `simulationState` + `mutations` als geschlossene Einheit. `startSimulation()` ruft intern `compileMutation` auf, kein Ref-Bridge nötig |
| **WS-Pfad-Sicherheit** | `sendMessage` und `sendMessageImmediate` werden 1:1 durchgereicht — der WS-Buffer-Pfad wird NICHT verändert |
| **Flicker-Prevention** | `useReducer` statt 12 `useState`-Calls für zusammenhängende State-Transitions (`compileStart → compileSuccess → simulationStart`). Ein Dispatch = ein Re-Render statt 3 sequentieller `setState`-Calls |
| **Test-Strategie** | Bestehende Unit-Tests für beide Hooks werden in eine neue Test-Datei `use-compile-and-run.test.ts` migriert. Die alten Test-Dateien bleiben als Regression-Check bestehen, bis der Merge stabil ist |

---

### Phase B: Backend — Chirurgische Extraktionen aus `sandbox-runner.ts`

> **Kritische Erkenntnis aus dem Post-Mortem:** Der `SandboxRunner` ist das Herz der Server-Client-Kommunikation. Jeder Callback, der an `runSketch()` übergeben wird, ist ein Endpunkt einer WS-Message-Kette. Wir dürfen die Callback-Signaturen NICHT ändern.

#### B1: `RunSketchOptions` Interface einführen
**Impact: LOC-neutral | Risiko: SEHR NIEDRIG | Priorität: SOFORT**

```typescript
// server/services/types.ts (NEU)
export interface RunSketchOptions {
  code: string;
  timeoutSec?: number;
  onOutput: (line: string, isComplete?: boolean) => void;
  onError: (line: string) => void;
  onExit: (code: number | null) => void;
  onCompileError?: (error: string) => void;
  onCompileSuccess?: () => void;
  onPinState?: (pin: number, type: "mode" | "value" | "pwm", value: number) => void;
  onIORegistry?: (registry: IOPinRecord[], baudrate: number | undefined, reason?: string) => void;
  onTelemetry?: (metrics: any) => void;
  onPinStateBatch?: (batch: PinStateBatch) => void;
}
```

| Schritt | Detail |
|---------|--------|
| 1 | Interface in `server/services/types.ts` definieren |
| 2 | `runSketch(options: RunSketchOptions)` statt 11 Positional-Parameter |
| 3 | In `simulation.ws.ts`: Caller-Site von Positional auf Object-Spread umstellen |
| 4 | Alle Tests: Search-Replace von Positional-Calls auf Options-Objekt |
| 5 | `npm run test` muss grün sein — kein Verhaltens-Unterschied |

#### B2: `setupDockerHandlers` + `setupLocalHandlers` unifizieren
**Impact: −100 LOC | Risiko: MITTEL | Priorität: NACH B1**

| Was | Detail |
|-----|--------|
| **Ist-Zustand** | Beide Methoden sind ~70% identisch. Unterschied: Docker hat `compilePhase`-Flag, Local hat `wasRunning`-Guard |
| **Soll** | Eine `setupProcessHandlers(process, options: { hasCompilePhase: boolean })` Methode |
| **Pattern** | Strategy via Options-Flag statt Vererbung — minimal-invasiv |
| **WS-Pfad-Sicherheit** | `handleParsedLine()` (L912) bleibt unverändert — es ist der einzige Punkt, an dem Callbacks aufgerufen werden. Die Handler-Setup-Methode verbindet nur `stdout`/`stderr`/`close`-Events |
| **Test** | `sandbox-runner.test.ts` muss alle bestehenden Szenarien (Docker + Local) weiter bestehen |

#### B3: `ProcessManager` extrahieren
**Impact: −150 LOC | Risiko: MITTEL | Priorität: NACH B2**

| Was | Detail |
|-----|--------|
| **Scope** | `spawn()`, `pause()`, `resume()`, `stop()`, `kill()`, `processKilled`-Flag, `processController`-Management |
| **Neue Datei** | `server/services/process-manager.ts` |
| **Interface** | `ProcessManager { spawn(cmd, args, opts); pause(); resume(); stop(); kill(); isKilled: boolean; onClose(cb); onStdout(cb); onStderr(cb); }` |
| **WS-Pfad-Sicherheit** | `ProcessManager` hat KEINE Kenntnis von WebSockets oder Callbacks. Es ist eine reine OS-Prozess-Abstraktion. `SandboxRunner` verbindet `ProcessManager.onStderr` → `handleParsedLine` → Callbacks |
| **Kritischer Punkt** | `stop()` muss weiterhin `serialOutputBatcher.destroy()` aufrufen (nicht `.stop()`!) — der Stop-Fix darf nicht verloren gehen. Lösung: `SandboxRunner.stop()` ruft `processManager.kill()` UND `serialOutputBatcher.destroy()` auf. Der Batcher bleibt in `SandboxRunner` |

#### B4: `CleanupManager` extrahieren
**Impact: −80 LOC | Risiko: NIEDRIG | Priorität: NACH B3**

| Was | Detail |
|-----|--------|
| **Scope** | Temp-Dir-Erstellung, Temp-Dir-Cleanup mit Retry-Logik, Registry-File-Cleanup |
| **Neue Datei** | `server/services/cleanup-manager.ts` |
| **Besonderheit** | Reine I/O-Operationen ohne Callback-Verbindung zum Frontend. Sicherste Extraktion im Backend |

---

### Phase C: Shared — `code-parser.ts` Plugin-Pattern

**Priorität: NIEDRIG — nur wenn Phase A+B abgeschlossen**

#### C1: Checker-Pattern einführen

```typescript
// shared/checkers/types.ts
export interface CodeChecker {
  name: string;
  check(code: string, cleanCode: string): ParserMessage[];
}

// shared/checkers/serial-checker.ts (113 LOC)
// shared/checkers/structure-checker.ts (58 LOC)
// shared/checkers/hardware-checker.ts (173 LOC)
// shared/checkers/pin-conflict-checker.ts (44 LOC)
// shared/checkers/performance-checker.ts (103 LOC)

// shared/code-parser.ts (Facade, ~30 LOC)
export class CodeParser {
  private checkers: CodeChecker[] = [
    new SerialChecker(),
    new StructureChecker(),
    new HardwareChecker(),
    new PinConflictChecker(),
    new PerformanceChecker(),
  ];
  
  parseAll(code: string): ParserMessage[] {
    const cleanCode = this.removeComments(code);
    return this.checkers.flatMap(c => c.check(code, cleanCode));
  }
}
```

| Vorteil | Detail |
|---------|--------|
| API-stabil | `CodeParser.parseAll()` bleibt unverändert — kein Caller muss geändert werden |
| Testbar | Jeder Checker hat eigene Test-Datei statt monolithischer Parser-Tests |
| Erweiterbar | Neuer Checker = neue Datei + Array-Eintrag, keine Änderung an bestehenden Checkern |

---

### Phase D: Test-Konsolidierung

#### D1: Load-Tests parametrisieren
**Impact: −1.300 LOC | Risiko: SEHR NIEDRIG | Priorität: JEDERZEIT (unabhängig)**

```typescript
// tests/server/load-test.test.ts (EINZIGE Datei)
import { describe, it } from 'vitest';

const LOAD_CONFIGS = [
  { clients: 50,  passRate: 0.6,  avgLimit: 40_000, timeout: 90_000  },
  { clients: 100, passRate: 0.55, avgLimit: 50_000, timeout: 180_000 },
  { clients: 200, passRate: 0.30, avgLimit: 60_000, timeout: 300_000 },
  { clients: 500, passRate: 0.25, avgLimit: 90_000, timeout: 720_000 },
] as const;

describe.each(LOAD_CONFIGS)(
  'Load Test — $clients clients',
  ({ clients, passRate, avgLimit, timeout }) => {
    it(`handles ${clients} concurrent clients`, async () => {
      // ... identischer Test-Body mit parametrisierten Thresholds
    }, timeout);
  }
);
```

Die 4 alten Dateien werden gelöscht, nachdem die neue Datei alle Szenarien abdeckt.

---

## 4. Guardian-Tests: Unantastbare Wächter

### Definition

**Guardian-Tests** sind Tests, die bei jedem Refactoring-Schritt grün sein MÜSSEN. Eine KI, die einen Guardian-Test ändert (lockert, löscht, oder `skip`t), bricht damit das Refactoring-Protokoll.

### E2E Guardians (9 Spec-Dateien, 23 Test-Cases)

| Guardian | Datei | Schützt |
|----------|-------|---------|
| **G1: WS-Flow** | `websocket-flow.spec.ts` | Die gesamte Compile→Start→Serial→PinState-Kette |
| **G2: Pin-Frames** | `arduino-board-pin-frames.spec.ts` (8 Tests) | Korrekte SVG-Darstellung aller Pin-Modi |
| **G3: Value-Display** | `arduino-board-value-display.spec.ts` | I/O-Value-Toggle funktioniert |
| **G4: Output-Floor** | `output-panel-floor.spec.ts` (2 Tests) | Output-Panel min-height bei Resize |
| **G5: Batching** | `pin-state-batching-telemetry.spec.ts` (4 Tests) | Pin-Batching End-to-End |
| **G6: Visual** | `visual-baseline.spec.ts` (2 Tests) | UI hat sich visuell nicht verändert |
| **G7: Sandbox** | `sandbox-ui-batching.spec.ts` | Sandbox→UI Integration |
| **G8: PWM** | `pwm-controller.spec.ts` | PWM-Controller Validierung |
| **G9: Keyboard** | `phase7r-keyboard-dropping.spec.ts` (3 Tests) | Shortcuts + Serial-Dropping |

### Unit-Test Guardians (kritischste)

| Guardian | Datei | Schützt |
|----------|-------|---------|
| **G10** | `tests/server/services/sandbox-runner.test.ts` | Runner-Lifecycle: start→output→stop→cleanup |
| **G11** | `tests/server/websocket-multi-client.test.ts` | Multi-Client WS-Isolation |
| **G12** | `tests/server/services/serial-output-batcher.test.ts` | Batcher flush vs destroy Semantik (Stop-Fix!) |
| **G13** | `tests/server/services/pin-state-batcher.test.ts` | Pin-Batching-Logik |

### Protokoll für KI-gesteuerte Refactorings

```
VOR jedem Commit:
  1. npm run test           → ALLE Unit-Tests grün
  2. npm run test:e2e       → ALLE E2E-Tests grün
  3. git diff -- e2e/       → KEINE Änderungen an E2E-Specs
  4. git diff -- tests/server/services/sandbox-runner.test.ts → KEINE Änderungen
  5. git diff -- tests/server/services/serial-output-batcher.test.ts → KEINE Änderungen

Falls eine dieser Prüfungen fehlschlägt:
  → STOPP. Änderungen revertieren. Problem analysieren.
  → NIE einen Test anpassen, um einen Fehler zu "fixen"
```

---

## 5. Anti-Flicker-Spezifikation

### Problem

Bei State-Extraktionen kann es zu "UI-Flackern" kommen, wenn:
1. Ein `useState` in eine neue Komponente verschoben wird und der Parent dadurch unnötig re-rendert
2. Mehrere `setState`-Calls in einem Event-Handler sequentiell feuern
3. Object-Props (z.B. `style={{ ... }}`) bei jedem Render neue Referenzen erzeugen

### Verbindliche Regeln für jede Extraktion

#### Regel F1: `React.memo` mit stabilen Props

Jede extrahierte Komponente MUSS `React.memo` verwenden:

```tsx
// ✅ KORREKT
export const OutputPanel = React.memo(function OutputPanel(props: OutputPanelProps) {
  // ...
});

// ❌ VERBOTEN — Props ohne Memo
export function OutputPanel(props: OutputPanelProps) { ... }
```

#### Regel F2: Callback-Stabilität via `useCallback`

Jede Callback-Prop, die an eine `React.memo`-Komponente durchgereicht wird, MUSS referenzstabil sein:

```tsx
// ✅ KORREKT — in arduino-simulator.tsx
const handleTabChange = useCallback((tab: string) => {
  setActiveOutputTab(tab);
}, []);  // kein dep, da setActiveOutputTab stabil ist

<OutputPanel onTabChange={handleTabChange} />

// ❌ VERBOTEN — Inline-Lambda erzeugt neue Referenz bei jedem Render
<OutputPanel onTabChange={(tab) => setActiveOutputTab(tab)} />
```

#### Regel F3: Object-Props via `useMemo`

Wenn Props als Objekt gruppiert werden (z.B. für AppHeader), MUSS `useMemo` verwendet werden:

```tsx
// ✅ KORREKT
const simulationProps = useMemo(() => ({
  status: simulationStatus,
  onSimulate: handleStart,
  onStop: handleStop,
  onPause: handlePause,
  onResume: handleResume,
}), [simulationStatus, handleStart, handleStop, handlePause, handleResume]);

<AppHeader simulationProps={simulationProps} />
```

#### Regel F4: Kein Double-Render bei State-Batching

React 18 batchet `setState`-Calls in Event-Handlern automatisch. Aber in `useEffect` und async Callbacks muss explizit gebatched werden:

```tsx
// ✅ KORREKT — React batcht automatisch in Event-Handlern
const handleCompileSuccess = useCallback(() => {
  setCompilationStatus('success');
  setHasCompilationErrors(false);
  setCliOutput(prev => [...prev, 'Compilation successful']);
}, []);

// ⚠️ VORSICHT — In async/useEffect: React 18 batcht auch hier,
// aber bei Extraktionen in Custom Hooks sicherstellen, dass
// zusammengehörige State-Updates im selben Synchron-Tick passieren
```

#### Regel F5: Keine Layout-Shifts bei Panel-Extraktion

Das Output-Panel verwendet `ResizablePanel` mit `minSize`/`maxSize`. Bei der Extraktion:

```tsx
// ✅ KORREKT — Panel-Constraints bleiben identisch
<ResizablePanel 
  defaultSize={30} 
  minSize={15}
  collapsible
  // ... gleiche Props wie vorher
>
  <OutputPanel {...outputProps} />
</ResizablePanel>

// ❌ VERBOTEN — Panel-Constraints IN die Komponente verschieben
// (das ResizablePanel MUSS im Parent bleiben, da es Teil des Layout-Grids ist)
```

---

## 6. Priorisierte Roadmap v2 — Zeitplan

```
SOFORT (Sprint 1)                   KURZ (Sprint 2-3)                    MITTEL (Sprint 4+)
─────────────────                   ──────────────────                    ──────────────────

Frontend:                           Frontend:                            Frontend:
[A1] OutputPanel extrahieren        [A3] useEditorCommands               [A5] useCompileAndRun
[A2] MobileLayout extrahieren       [A4] AppHeader Props                      Merger

Backend:                            Backend:                             Backend:
[B1] RunSketchOptions Interface     [B2] Handler-Unifikation             [B3] ProcessManager
                                                                         [B4] CleanupManager

Tests:                              Shared:                              Shared:
[D1] Load-Tests parametrisieren     —                                    [C1] Parser Checker-Pattern

Geschätzte LOC-Reduktion:           Geschätzte LOC-Reduktion:            Geschätzte LOC-Reduktion:
Source: −570 (Output+Mobile)        Source: −169 (EditorCmd+Props)       Source: −390 (Hooks+Process+
Tests:  −1.300 (Load-Tests)         Tests:  0                                   Cleanup+Parser)
                                                                         Tests:  −200 (shared utils)
```

### Impact-Matrix v2

| Schritt | Kognitive Last Δ | Risiko | WS-Pfad betroffen? | Guardian-Tests |
|---------|-------------------|--------|---------------------|----------------|
| A1: OutputPanel | −400 LOC in God Component | 🟢 Niedrig | Nein | G4, G6 |
| A2: MobileLayout | −170 LOC in God Component | 🟢 Niedrig | Nein | G6 |
| A3: EditorCommands | −109 LOC in God Component | 🟢 Sehr niedrig | Nein | G9 |
| A4: AppHeader Props | −22 Props, LOC-neutral | 🟡 Mittel | Nein | G6 |
| A5: Hook-Merger | Eliminiert Ref-Bridge | 🔴 Hoch | Ja (sendMessage-Pfad) | G1, G5, G7 |
| B1: RunSketchOptions | LOC-neutral, API-Cleanup | 🟢 Sehr niedrig | Nein (Signatur-intern) | G10 |
| B2: Handler-Unifikation | −100 LOC Duplikation | 🟡 Mittel | Ja (stderr-Parsing) | G1, G5, G10 |
| B3: ProcessManager | −150 LOC, SRP | 🟡 Mittel | Indirekt (kill-Semantik) | G1, G10, G12 |
| B4: CleanupManager | −80 LOC, SRP | 🟢 Niedrig | Nein | G10 |
| C1: Parser-Checker | LOC-neutral, SRP | 🟢 Niedrig | Nein | Unit-Tests |
| D1: Load-Tests | −1.300 LOC Tests | 🟢 Sehr niedrig | Nein | Keine |

---

## 7. Spezifikation für KI-Ausführende ("Raptor-Proof")

### Vertrag mit der ausführenden KI

Jede ausführende KI erhält folgende Constraints:

```markdown
## VERBOTEN:
1. Tests ändern, löschen oder mit `.skip` / `.todo` markieren
2. Callback-Signaturen in sandbox-runner.ts ändern
3. `sendMessageImmediate` entfernen oder durch `sendMessage` ersetzen
4. `serialOutputBatcher.destroy()` in stop() durch `.stop()` ersetzen
5. Mehr als EINE Extraktion pro Commit durchführen
6. useEffect-Dependencies ändern (außer bei nachweisbarem Bug)
7. WebSocket-Message-Typen umbenennen oder neue einführen
8. React.memo von bestehenden Komponenten entfernen

## PFLICHT:
1. Jede neue Komponente mit React.memo wrappen
2. Jede neue Callback-Prop mit useCallback stabilisieren
3. Jede Object-Prop mit useMemo stabilisieren
4. Nach JEDEM Commit: `npm run test && npm run test:e2e`
5. `git diff -- e2e/` muss leer sein (keine E2E-Änderungen)
6. Imports alphabetisch sortiert halten
7. TypeScript strict mode Fehler beheben, nicht unterdrücken
```

### Commit-Message-Format

```
refactor(A1): extract OutputPanel component

- Moved L1395-L1809 from arduino-simulator.tsx to output-panel.tsx
- Added React.memo wrapper
- Props: { activeTab, onTabChange, cliOutput, ... } — 13 props
- NO behavioral changes
- Tests: ✅ unit (187 passed), ✅ e2e (23 passed)
- Guardian check: git diff -- e2e/ → empty
```

---

## 8. Zusammenfassung v2

| Kennzahl | Audit v1 | Jetzt (eaf1220+Fixes) | Ziel (nach Roadmap v2) |
|----------|----------|------------------------|------------------------|
| Größte Datei (Source) | 2.761 LOC | 2.266 LOC | ~1.100 LOC |
| `routes.ts` | 744 LOC (1 Fn) | 587 LOC (4 Dateien) ✅ | — |
| `sandbox-runner.ts` | 1.479 LOC | 1.427 LOC | ~800 LOC |
| Max. Hooks/Komponente | 52 | ~38 | ~12 |
| Max. Props an AppHeader | ~35 | 32 | ~8 (3 Gruppen + 5) |
| Hook-Parameter (max) | 20+13=33 | 20+16=36 | ~8 (Options-Objekt) |
| Test-Duplikation (Load) | 1.731 LOC | 1.731 LOC | ~450 LOC |
| WS-Pfad Integrität | — | ✅ Stabil | ✅ Garantiert durch Guardians |

**Was sich gegenüber v1 geändert hat:**

1. **Roadmap ist defensiver:** Statt 3 "Phasen" (P0/P1/P2) gibt es jetzt atomare Schritte (A1–A5, B1–B4, C1, D1), jeweils mit explizitem Risk-Assessment
2. **Guardian-Tests sind definiert:** 13 Test-Suites als unveränderliche Invarianten
3. **Anti-Flicker-Regeln:** 5 verbindliche Regeln für Memoization und Referenzstabilität
4. **KI-Constraints:** Expliziter "Vertrag" mit Verboten und Pflichten
5. **WS-Pfad als Tabuzone:** Keine Extraktion darf den Message-Pfad verändern
6. **H3 ist erledigt:** `routes.ts` Modularisierung bereits umgesetzt — aus der Roadmap gestrichen
