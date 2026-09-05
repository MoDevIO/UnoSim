# Phase 2.1: Refactoring-Plan für `use-compile-and-run.ts`

Status: completed

**Ziel:** Zerlegung des 900-Zeilen-Monolithen in testbare, spezialisierte Hooks mit klarer Trennung der Verantwortlichkeiten.

**Erfolgskriterien:**
- Sub-Hooks < 300 Zeilen
- > 80% Testabdeckung pro Sub-Hook
- Charakterisierungstests bleiben als Integrationssafety-Net erhalten
- Keine funktionalen Änderungen (Behavior bleibt identisch)

## Abschlussstatus

Phase 2.1 ist mit Commit `7c8dd6c6` formal abgeschlossen. Die vier geplanten
Schritte wurden umgesetzt, die Charakterisierungstests blieben unverändert und
die Orchestrator-Verdrahtung wurde durch gemockte Sub-Hook-Tests abgesichert.

| Kriterium | Ergebnis |
|-----------|----------|
| Compile-, Simulation- und UI-Sub-Hooks extrahiert | ✅ Erfüllt |
| Statement-Coverage je Sub-Hook bzw. Orchestrator >80% | ✅ Erfüllt (`use-compile-controller` 94,0%, `use-simulation-controller` 100,0%, `use-ui-feedback-adapter` 98,8%, Orchestrator 85,5%) |
| Charakterisierungstests erhalten | ✅ Erfüllt, 5/5 Szenarien grün |
| Verhalten unverändert | ✅ Erfüllt durch Unit-, E2E- und Charakterisierungstests |
| Zielgröße der Module <300 Zeilen | ⚠️ Teilweise: UI-Adapter 310 Zeilen, Orchestrator 361 Zeilen |

Die Größenabweichung ist als offener Wartbarkeitspunkt dokumentiert. Sie ist
kein Bestandteil von Phase 2.2 und wird dort nicht implizit weiterrefaktoriert.

---

## 1. Zielarchitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    use-compile-and-run.ts                       │
│                     (Orchestrator Hook, ~150 Zeilen)            │
│  - Koordiniert Compile → Start-Flow                             │
│  - Besitzt Compile-Mutationen (TanStack Query)                  │
│  - Besitzt Simulation-Mutationen (TanStack Query)               │
│  - Delegiert an:                                                │
│    • use-compile-controller (Zustand + Compile-Logik)           │
│    • use-simulation-controller (Zustand + Simulation-Logik)     │
│    • use-ui-feedback-adapter (Toasts, Debug-Messages, Glitch)   │
└─────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────┐   ┌─────────────────────┐   ┌──────────────────┐
│ use-compile-     │   │ use-simulation-     │   │ use-ui-feedback- │
│ controller.ts    │   │ controller.ts       │   │ adapter.ts       │
│ (~250 Zeilen)    │   │ (~280 Zeilen)       │   │ (~120 Zeilen)    │
│                  │   │                     │   │                  │
│ - compilationSt. │   │ - simulationStatus  │   │ - Toast-Calls    │
│ - arduinoCliStat │   │ - hasCompiledOnce   │   │ - Debug-Msgs     │
│ - compilerErrors │   │ - simulationTimeout │   │ - Error-Glitch   │
│ - handleCompile  │   │ - handleStart/Stop  │   │ - Pin-Conflict   │
│ - Success/Error  │   │ - Pause/Resume      │   │ - UI-Callbacks   │
│ - Parser-Msgs    │   │ - WebSocket-Send    │   │                  │
└──────────────────┘   └─────────────────────┘   └──────────────────┘
```

---

## 2. Bestandsaufnahme

### 2.1 Bereits extrahierte Komponenten ✅

| Komponente | Datei | Status | Änderungen nötig |
|------------|-------|--------|------------------|
| Compile-Zustand | `use-compile-controller-state.ts` (15 Zeilen) | ✅ Existiert | ❌ Keine |
| Simulation-Zustand | `use-simulation-controller-state.ts` (12 Zeilen) | ✅ Existiert | ❌ Keine |
| Lifecycle-Automatik | `use-simulation-lifecycle.ts` (95 Zeilen) | ✅ Existiert | ❌ Keine |
| Compile-Befehl | `compile-command-builder.ts` (6 Zeilen) | ✅ Existiert | ❌ Keine |

### 2.2 Verbleibende Komplexität in `use-compile-and-run.ts`

| Verantwortung | Zeilen | Beschreibung |
|---------------|--------|--------------|
| `compileMutation` + Handler | ~100 | POST /api/compile, Success/Error-Handler |
| `startMutation`, `stopMutation`, etc. | ~80 | WebSocket-Mutationen mit Fallback-Logik |
| `handleCompileAndStart` | ~60 | Orchestrierung Compile → Start |
| UI-Feedback (Toasts, Debug) | ~120 | Verteilt über alle Handler |
| Pin-Conflict-Warnung | ~30 | Speziallogik in `handleStart` |
| State-Updates | ~150 | Über alle Funktionen verstreut |
| **Gesamt** | **~540** | **Muss extrahiert werden** |

---

## 3. Inkrementeller Extraktionsplan

### **Schritt 1: UI Feedback Adapter extrahieren** (abgeschlossen)

**Verantwortung:** Kapselt alle UI-Seiteneffekte (Toasts, Debug-Messages, Error-Glitch, Pin-Conflict-Warnungen)

**Zu extrahierende Funktionen:**
- `showCompileSuccessToast()` (Zeilen ~220-225)
- `showCompileErrorToast()` (Zeilen ~260-275)
- `addDebugMessage()` (bereits als Prop, wird gekapselt)
- `triggerErrorGlitch()` (bereits als Prop, wird gekapselt)
- `showPinConflictWarning()` (Zeilen ~360-370)
- `extractErrorMessage()` (Zeilen ~245-258)

**Neue Datei:** `client/src/hooks/use-ui-feedback-adapter.ts`

**Inputs:**
```typescript
interface UseUiFeedbackAdapterParams {
  toast: (args: { title: string; description?: string; variant?: "destructive" }) => void;
  addDebugMessage: (params: DebugMessageParams) => void;
  triggerErrorGlitch: () => void;
  setCliOutput: SetState<string>;
}
```

**Outputs:**
```typescript
interface UseUiFeedbackAdapterResult {
  showCompileSuccessToast: (result: CompileResult) => void;
  showCompileErrorToast: (error: unknown) => void;
  showPinConflictWarning: (pins: number[]) => void;
  handleDebugMessage: (source: "frontend" | "server", type: string, data: string) => void;
  extractErrorMessage: (error: unknown) => string;
}
```

**Bestehende Tests:** 
- Charakterisierungstest #1 (compile-and-start success) validiert Toast-Call
- Charakterisierungstest #3 (compile-and-start failure) validiert Error-Toast
- Charakterisierungstest #5 (stop immediate send) validiert Cleanup

**Zusätzliche Unit-Tests erforderlich:**
- `showCompileSuccessToast()` mit verschiedenen CompileResult-Varianten
- `showCompileErrorToast()` mit Error-Objekten, Strings, unbekannten Typen
- `extractErrorMessage()` Edge Cases (undefined, null, komplexe Objekte)
- `showPinConflictWarning()` mit leeren, einzelnen, mehreren Pins

**Risiken:** ⭐ **NIEDRIG**
- ✅ Rein seiteneffektbehaftet (keine Zustandslogik)
- ✅ Keine Abhängigkeiten zu anderen Extraktionsschritten
- ✅ Einfache Inputs/Outputs (nur Callbacks)
- ✅ Charakterisierungstests fangen Regressionen ab

**Geschätzter Aufwand:** 2-3 Stunden (inkl. Tests)

---

### **Schritt 2: Compile Controller extrahieren** (abgeschlossen)

**Verantwortung:** Kapselt gesamte Compile-Logik (Mutation, Success/Error-Handler, Parser-Messages, Io-Registry)

**Zu extrahierende Funktionen:**
- `compileMutation` (Zeilen 178-208)
- `handleCompileSuccess()` (Zeilen 215-237)
- `handleCompileError()` (Zeilen 242-280)
- `handleClearCompilationOutput()` (Zeilen ~385-395)
- `clearOutputs()` (Zeilen ~397-405)

**Neue Datei:** `client/src/hooks/use-compile-controller.ts`

**Inputs:**
```typescript
interface UseCompileControllerParams {
  // State
  compilationStatus: CompilationStatus;
  setCompilationStatus: SetState<CompilationStatus>;
  arduinoCliStatus: "idle" | "compiling" | "success" | "error";
  setArduinoCliStatus: SetState<"idle" | "compiling" | "success" | "error">;
  hasCompilationErrors: boolean;
  setHasCompilationErrors: SetState<boolean>;
  compilerErrors: string | CompilerError[] | null;
  setCompilerErrors: SetState<string | CompilerError[] | null>;
  lastCompilationResult: CompileResult | null;
  setLastCompilationResult: SetState<CompileResult | null>;
  cliOutput: string;
  setCliOutput: SetState<string>;
  
  // Callbacks
  setParserMessages: (messages: ParserMessage[]) => void;
  setIoRegistry: (registry: IOPinRecord[]) => void;
  setIsModified: (modified: boolean) => void;
  
  // UI Feedback (aus Schritt 1)
  uiFeedback: UseUiFeedbackAdapterResult;
  
  // Editor
  editorRef: MutableRefObject<EditorView | null>;
  tabs: Tab[];
  activeTabId: string | null;
}
```

**Outputs:**
```typescript
interface UseCompileControllerResult {
  compileMutation: UseMutationResult<...>;
  handleCompile: () => Promise<void>;
  handleClearCompilationOutput: () => void;
  clearOutputs: () => void;
}
```

**Bestehende Tests:**
- Charakterisierungstest #1 (compile success path)
- Charakterisierungstest #3 (compile error path)

**Zusätzliche Unit-Tests erforderlich:**
- `handleCompileSuccess()` mit Parser-Messages, Io-Registry, Caching
- `handleCompileError()` mit verschiedenen Error-Typen
- `clearOutputs()` mit leeren/volle States
- Integration mit UI Feedback Adapter (Mock)

**Risiken:** ⭐ **MITTEL**
- ⚠️ Enthält TanStack Query Mutation (Test-Mocking erforderlich)
- ⚠️ Parser-Message- und Io-Registry-Updates müssen korrekt propagiert werden
- ✅ Durch Schritt 1 isoliertes UI-Feedback einfach zu mocken
- ✅ Charakterisierungstests validieren End-to-End-Verhalten

**Geschätzter Aufwand:** 4-5 Stunden (inkl. Tests)

---

### **Schritt 3: Simulation Controller extrahieren** (abgeschlossen)

**Verantwortung:** Kapselt gesamte Simulations-Logik (Start, Stop, Pause, Resume, WebSocket-Send)

**Zu extrahierende Funktionen:**
- `startMutation` (Zeilen 320-375)
- `stopMutation` (Zeilen 283-300)
- `pauseMutation` (Zeilen 302-310)
- `resumeMutation` (Zeilen 312-318)
- `handleStart()` (Zeilen ~340-360)
- `handleStop()` (Zeilen ~290-300)
- `handlePause()` (Zeilen ~305-308)
- `handleResume()` (Zeilen ~315-317)
- `handleReset()` (Zeilen ~410-425)

**Neue Datei:** `client/src/hooks/use-simulation-controller.ts`

**Inputs:**
```typescript
interface UseSimulationControllerParams {
  // State
  simulationStatus: SimulationStatus;
  setSimulationStatus: SetState<SimulationStatus>;
  hasCompiledOnce: boolean;
  setHasCompiledOnce: SetState<boolean>;
  simulationTimeout: number;
  setSimulationTimeout: SetState<number>;
  dockerGccPhase: "disconnected" | "connecting" | "ready";
  setDockerGccPhase: SetState<"disconnected" | "connecting" | "ready">;
  
  // WebSocket
  sendMessage: (message: IncomingArduinoMessage) => void;
  sendMessageImmediate: (message: IncomingArduinoMessage) => boolean;
  serialEventQueueRef: MutableRefObject<...>;
  
  // Pin-Conflict
  pendingPinConflicts: number[];
  setPendingPinConflicts: SetState<number[]>;
  
  // UI Feedback (aus Schritt 1)
  uiFeedback: UseUiFeedbackAdapterResult;
  
  // Lifecycle
  isModified: boolean;
  handleCompileAndStart: () => void;
  startSimulationRef: MutableRefObject<(() => void) | null>;
  
  // Externe Callbacks
  ensureBackendConnected: (reason: string) => boolean;
  resetPinUI: (opts?: { keepDetected?: boolean }) => void;
  clearOutputs: () => void;
  setCliOutput: SetState<string>;
}
```

**Outputs:**
```typescript
interface UseSimulationControllerResult {
  startMutation: UseMutationResult<...>;
  stopMutation: UseMutationResult<...>;
  pauseMutation: UseMutationResult<...>;
  resumeMutation: UseMutationResult<...>;
  handleStart: () => void;
  handleStop: () => void;
  handlePause: () => void;
  handleResume: () => void;
  handleReset: () => void;
}
```

**Bestehende Tests:**
- Charakterisierungstest #2 (start fallback to buffered send)
- Charakterisierungstest #4 (backend disconnected early exit)
- Charakterisierungstest #5 (stop immediate send + cleanup)

**Zusätzliche Unit-Tests erforderlich:**
- `handleStart()` mit/ohne Pin-Conflicts
- `handleStop()` mit/ohne WebSocket-Verbindung
- `handleReset()` mit Auto-Start-Verzögerung
- WebSocket-Send-Fallback-Logik (immediate vs. buffered)

**Risiken:** ⭐ **MITTEL-HOCH**
- ⚠️ WebSocket-Logik mit Immediate/Buffered-Fallback komplex
- ⚠️ Pin-Conflict-Warnung erfordert Koordination mit UI Feedback
- ⚠️ `startSimulationRef`-Mechanismus für Compile→Start-Koordination
- ✅ Charakterisierungstests decken kritische Pfade ab

**Geschätzter Aufwand:** 5-6 Stunden (inkl. Tests)

---

### **Schritt 4: Orchestrator Hook refaktorieren** (abgeschlossen)

**Verantwortung:** Koordiniert die extrahierten Hooks, behält Compile→Start-Orchestrierung

**Verbleibende Funktionen in `use-compile-and-run.ts`:**
- `handleCompileAndStart()` (Zeilen 520-580) - **Kern-Orchestrierung**
- Props-Merging für Sub-Hooks
- State-Composition (spread aus Sub-Hooks)

**Neue Struktur:**
```typescript
export function useCompileAndRun(params: CompileAndRunParams) {
  // 1. UI Feedback Adapter
  const uiFeedback = useUiFeedbackAdapter({ ... });
  
  // 2. Compile Controller
  const compile = useCompileController({
    ...params,
    uiFeedback,
  });
  
  // 3. Simulation Controller
  const simulation = useSimulationController({
    ...params,
    uiFeedback,
    clearOutputs: compile.clearOutputs, // Cross-Hook-Dependency
  });
  
  // 4. Orchestrierung (verbleibende Kern-Logik)
  const handleCompileAndStart = async () => {
    // ... bestehende Logik (Zeilen 520-580) ...
  };
  
  // 5. State Composition
  return {
    ...compile,
    ...simulation,
    handleCompileAndStart,
  };
}
```

**Bestehende Tests:**
- Alle 5 Charakterisierungstests (Integrationsebene)

**Zusätzliche Unit-Tests erforderlich:**
- `handleCompileAndStart()` mit Mocks der Sub-Hooks
- Error-Propagation zwischen Compile → Start
- Timing-Tests (Microtask-Queue für State-Updates)

**Risiken:** ⭐ **HOCH**
- ⚠️ Letzter Schritt mit größtem Änderungsumfang
- ⚠️ Orchestrierungs-Logik muss exakt bestehendes Verhalten replizieren
- ⚠️ Cross-Hook-Dependencies (clearOutputs) erfordern sorgfältiges Wiring
- ✅ Alle vorherigen Schritte abgeschlossen → geringere kognitive Last
- ✅ Charakterisierungstests als Safety-Net

**Geschätzter Aufwand:** 3-4 Stunden (inkl. Tests)

---

## 4. Abhängigkeitsanalyse

### 4.1 State-Ownership

| State | Aktueller Besitzer | Ziel-Besitzer |
|-------|-------------------|---------------|
| `compilationStatus` | use-compile-and-run | use-compile-controller |
| `arduinoCliStatus` | use-compile-and-run | use-compile-controller |
| `compilerErrors` | use-compile-and-run | use-compile-controller |
| `lastCompilationResult` | use-compile-and-run | use-compile-controller |
| `cliOutput` | use-compile-and-run | use-compile-controller (read), use-simulation-controller (write via Pin-Conflict) |
| `simulationStatus` | use-compile-and-run | use-simulation-controller |
| `hasCompiledOnce` | use-compile-and-run | use-simulation-controller |
| `simulationTimeout` | use-compile-and-run | use-simulation-controller |
| `dockerGccPhase` | use-compile-and-run | use-simulation-controller |
| `pendingPinConflicts` | use-compile-and-run | use-simulation-controller |

### 4.2 Mutation-Ownership

| Mutation | Aktueller Besitzer | Ziel-Besitzer |
|----------|-------------------|---------------|
| `compileMutation` | use-compile-and-run | use-compile-controller |
| `startMutation` | use-compile-and-run | use-simulation-controller |
| `stopMutation` | use-compile-and-run | use-simulation-controller |
| `pauseMutation` | use-compile-and-run | use-simulation-controller |
| `resumeMutation` | use-compile-and-run | use-simulation-controller |

### 4.3 Callback-Dependencies

```
use-compile-and-run (Orchestrator)
  │
  ├─→ use-ui-feedback-adapter (keine Dependencies)
  │
  ├─→ use-compile-controller
  │     └─→ depends on: uiFeedback
  │
  └─→ use-simulation-controller
        └─→ depends on: uiFeedback, clearOutputs (from compile-controller)
```

**Besonderheit:** `clearOutputs` wird von `use-compile-controller` bereitgestellt, aber von `use-simulation-controller` benötigt (für `handleReset`). Lösung: Im Orchestrator wird `clearOutputs` aus dem Compile-Controller extrahiert und an den Simulation-Controller weitergegeben.

---

## 5. Test-Strategie

### 5.1 Charakterisierungstests (bereits vorhanden ✅)

**Datei:** `tests/client/hooks/use-compile-and-run.characterization.test.tsx`

**Funktion:** Integrationssafety-Net für gesamte Refactoring-Phase

**Abgedeckte Invarianten:**
1. Compile-and-start success (headers, code, registry, states)
2. Start fallback to buffered send
3. Compile-and-start failure (idle state, errors, no start)
4. Backend disconnected early exit
5. Stop immediate send + cleanup

**Wichtig:** Diese Tests bleiben **unverändert** und validieren das Gesamtverhalten nach jedem Extraktionsschritt.

### 5.2 Zusätzliche Unit-Tests pro Schritt

#### Schritt 1 (UI Feedback Adapter):
- `tests/client/hooks/use-ui-feedback-adapter.test.ts`
  - Toast-Varianten (success, error, warning)
  - Error-Extraktion (Edge Cases)
  - Debug-Message-Formatting
  - Pin-Conflict-Warning (leer, einzeln, multiple)

#### Schritt 2 (Compile Controller):
- `tests/client/hooks/use-compile-controller.test.tsx`
  - Success-Handler (mit/ohne Parser-Messages, Io-Registry)
  - Error-Handler (verschiedene Error-Typen)
  - Clear-Outputs (leer, voll, teilweise)
  - Integration mit UI Feedback Adapter (Mock)

#### Schritt 3 (Simulation Controller):
- `tests/client/hooks/use-simulation-controller.test.tsx`
  - Start (mit/ohne Pin-Conflicts, WebSocket offen/geschlossen)
  - Stop (immediate vs. buffered)
  - Pause/Resume (State-Übergänge)
  - Reset (mit Auto-Start-Verzögerung)
  - WebSocket-Send-Fallback-Logik

#### Schritt 4 (Orchestrator):
- `tests/client/hooks/use-compile-and-run.orchestrator.test.tsx`
  - `handleCompileAndStart` Orchestrierung (Mocks der Sub-Hooks)
  - Error-Propagation Compile → Start
  - State-Update-Timing (Microtask-Queue)

### 5.3 Test-Abdeckungsziele

| Hook | Ziel-Abdeckung | Kritische Pfade |
|------|----------------|-----------------|
| use-ui-feedback-adapter | >90% | Error-Extraktion, Toast-Varianten |
| use-compile-controller | >85% | Success/Error-Handler, Parser-Messages |
| use-simulation-controller | >85% | WebSocket-Send, Pin-Conflicts, Reset |
| use-compile-and-run (Orchestrator) | >80% | handleCompileAndStart, Error-Propagation |

---

## 6. Risikomanagement

### 6.1 Technische Risiken

| Risiko | Wahrscheinlichkeit | Auswirkung | Gegenmaßnahme |
|--------|-------------------|------------|---------------|
| TanStack Query Mocking komplex | Mittel | Hoch | Testing Library Query-Utils verwenden, bestehende Patterns kopieren |
| WebSocket-Fallback-Logik fehleranfällig | Mittel | Hoch | Charakterisierungstest #2 deckt ab, zusätzliche Unit-Tests |
| State-Propagation verzögert | Niedrig | Mittel | Microtask-Queue explizit testen, React-Testing-Library `waitFor` |
| Pin-Conflict-Warnung geht verloren | Niedrig | Mittel | Charakterisierungstest #5 validiert, UI Feedback Adapter testbar |
| Cross-Hook-Dependency (clearOutputs) bricht | Niedrig | Hoch | Im Orchestrator explizit wired, Integrationstest |

### 6.2 Organisatorische Risiken

| Risiko | Gegenmaßnahme |
|--------|---------------|
| Refactoring zu groß für einen Commit | ✅ Inkrementelle Schritte (je Schritt = 1-2 Commits) |
| Tests nicht aussagekräftig genug | ✅ Charakterisierungstests als Integrationssafety-Net |
| SonarQube-Regeln brechen Refactoring | ✅ Automatische Analyse während Code-Generation deaktiviert |
| Performance-Regression | ✅ Bestehende Performance-Tests laufen lassen (E2E-Smoke) |

---

## 7. Umsetzungsergebnis

Die geplante Reihenfolge wurde eingehalten: UI-Feedback-Adapter, Compile-
Controller, Simulation-Controller und abschließend der Orchestrator. Die
öffentliche Kompatibilitätsoberfläche von `useCompileAndRun` blieb erhalten.

Die abschließenden Gates waren erfolgreich:

- `npm run check`
- `npm run test:unit` (1.569 Tests)
- `npm run test:coverage` (Gesamtzeilen-Coverage 79,15%; Phase-2.1-Hooks siehe oben)
- `npm run build`
- `npm run test:e2e` (17 Tests)
- SonarQube Quality Gate `OK`, 0 offene Issues, 0 neue Violations

---

## 8. Git-Strategie (aus Action-Plan)

**Branch:** `feature/refactor/phase-1-low-hanging`

**Commit-Granularität:**
```
Step 1: UI Feedback Adapter
  - refactor: extract UI feedback adapter (Phase 2.1, Step 1)
  - test: add unit tests for use-ui-feedback-adapter

Step 2: Compile Controller
  - refactor: extract compile controller (Phase 2.1, Step 2)
  - test: add unit tests for use-compile-controller

Step 3: Simulation Controller
  - refactor: extract simulation controller (Phase 2.1, Step 3)
  - test: add unit tests for use-simulation-controller

Step 4: Orchestrator
  - refactor: simplify orchestrator hook (Phase 2.1, Step 4)
  - test: add orchestrator unit tests

Final:
  - docs: update Phase 2.1 summary with results
```

**Merge-Strategie:**
- Jeder Schritt einzeln reviewbar
- Charakterisierungstests müssen nach jedem Schritt grün sein
- SonarQube-Analyse nach jedem Schritt (automatische Analyse temporär deaktivieren)

---

## 9. Zusammenfassung

**Phase 2.1 Refactoring-Plan im Überblick:**

| Schritt | Extraktion | Zeilen (Ist) | Risiko | Aufwand | Status |
|---------|------------|--------------|--------|---------|-----------|
| 1 | UI Feedback Adapter | 310 | ⭐ Niedrig | 2-3h | ✅ Abgeschlossen |
| 2 | Compile Controller | 253 | ⭐⭐ Mittel | 4-5h | ✅ Abgeschlossen |
| 3 | Simulation Controller | 209 | ⭐⭐⭐ Mittel-Hoch | 5-6h | ✅ Abgeschlossen |
| 4 | Orchestrator | 361 | ⭐⭐⭐⭐ Hoch | 3-4h | ✅ Abgeschlossen |
| **Gesamt** | | **1.133** | | **14-18h** | |

**Abschluss:** Die Umsetzung ist abgeschlossen. Phase 2.2 kann als
eigenständiger nächster Arbeitsschritt geplant werden; die dokumentierte
Größenabweichung bleibt dabei ein bewusst offener Punkt.

---

**Erstellt:** 2026-09-04  
**Basierend auf:** `use-compile-and-run.ts` (900 Zeilen, unverändert)  
**Status:** Umsetzung abgeschlossen am 2026-09-04
