# Phase 2.1: Characterization Tests für use-compile-and-run.ts

Status: archived

## Zusammenfassung

Dieser Arbeitsschritt hat **Characterization Tests** für die zentrale Compile-and-Run-Orchestrierung implementiert, **bevor** das geplante Refactoring von `use-compile-and-run.ts` beginnt. Die Tests dokumentieren das **aktuelle Verhalten** ohne Produktionslogik zu verändern.

---

## ✅ Umgesetzte Maßnahmen

### 1. Neue Testdatei erstellt

**Datei:** `tests/client/hooks/use-compile-and-run.characterization.test.tsx`

**Testfälle (5 Tests, alle grün):**

| Test | Getestetes Verhalten | Erwartung |
|------|---------------------|-----------|
| **compile-and-start success** | Erfolgreicher Compile → Start mit Code, Headers, Debug-Clear, Registry-Init, `isModified=false` | `sendMessageImmediate` mit Code, `compilationStatus="success"`, `simulationStatus="running"`, `hasCompiledOnce=true` |
| **start fallback to buffered send** | `sendMessageImmediate` gibt `false` zurück → Fallback auf `sendMessage` | Beide Calls, Debug-Message "Immediate send failed" |
| **compile-and-start failure** | Compile-Fehler → Simulation idle, Compiler-Errors gesetzt, kein Start | `compilationStatus="error"`, `simulationStatus="idle"`, `compilerErrors` Array, `triggerErrorGlitch()`, kein `start_simulation` |
| **backend disconnected early exit** | `ensureBackendConnected=false` → Kein Compile, Simulation idle | `ensureBackendConnected("Simulation starten")` geprüft, kein API-Call, `simulationStatus="idle"` |
| **stop immediate send + cleanup** | Stop sendet sofort, leert Serial-Queue, behält Pin-UI | `sendMessageImmediate({type:"stop_simulation"})`, Queue=[], `resetPinUI({keepDetected:true})` |

---

## 🎯 Abgedeckte Verhaltensinvarianten (Auszug aus use-compile-and-run.ts)

### Compile-and-Start Success Path
- ✅ Debug-Ausgabe wird geleert (`setDebugMessages([])`)
- ✅ Code wird aus Editor extrahiert (Priorität: Editor > Tabs > State)
- ✅ Headers werden aus Tabs[1..n] gebaut
- ✅ `POST /api/compile` mit Code + Headers
- ✅ Bei Erfolg: `lastCompiledCodeRef.current = code`
- ✅ IO-Registry wird mit leeren Pins initialisiert (0–13, A0–A5)
- ✅ `start_simulation` wird mit Code, Timeout (60s) gesendet
- ✅ `sendMessageImmediate` wird bevorzugt, Fallback auf `sendMessage`
- ✅ `compilationStatus="success"`, `simulationStatus="running"`
- ✅ `hasCompiledOnce=true`, `setIsModified(false)`
- ✅ CLI-Status wird nach 2s auf idle gesetzt (`scheduleCliIdle`)

### Compile-and-Start Error Path
- ✅ Bei Compile-Fehlern: `compilationStatus="error"`, `simulationStatus="idle"`
- ✅ `compilerErrors` Array wird gesetzt
- ✅ `cliOutput` zeigt Fehlermeldung
- ✅ `triggerErrorGlitch()` wird aufgerufen
- ✅ Parser-Messages werden weitergegeben
- ✅ `setParserPanelDismissed(false)` bei Parser-Messages
- ✅ Toast mit "Compilation Completed with Errors" (destructive)
- ✅ Kein `start_simulation` Call

### Backend Disconnected
- ✅ `ensureBackendConnected("Simulation starten")` wird vor Compile geprüft
- ✅ Bei false: Early Exit ohne API-Call
- ✅ `simulationStatus` wird auf "idle" zurückgesetzt (verhindert stuck "queued")

### Stop Simulation
- ✅ `sendMessageImmediate({type:"stop_simulation"})` wird bevorzugt
- ✅ Serial-Event-Queue wird geleert (`serialEventQueueRef.current = []`)
- ✅ `resetPinUI({keepDetected:true})` behält erkannte Pin-Modes
- ✅ `simulationStatus="idle"`
- ✅ Debug-Message wird protokolliert

### Start Fallback Behavior
- ✅ Wenn `sendMessageImmediate` false zurückgibt → Fallback auf `sendMessage`
- ✅ Debug-Message dokumentiert Fallback
- ✅ Simulation startet trotzdem

---

## 📊 Test-Ergebnisse

### Unit Tests
```
✓ tests/client/hooks/use-compile-and-run.characterization.test.tsx (5 tests) 131ms
  ✓ compile-and-start success clears debug output, compiles headers, starts immediately with the compiled code and marks code unmodified
  ✓ start falls back to buffered WebSocket send when the immediate send reports failure
  ✓ compile-and-start failure keeps the simulation idle, exposes compiler errors and does not send start_simulation
  ✓ compile-and-start exits early when the backend check fails and resets a queued simulation without compiling
  ✓ stop prefers immediate WebSocket send, clears queued serial events and preserves detected pin state
```

### Gesamte Test-Suite
```
Test Files  132 passed (132)
Tests       1524 passed (1524)  ← +5 neue Characterization Tests
Duration    10.18s
```

### Typecheck
```
npm run check  ✓ Keine Fehler
```

### SonarQube
```
Analyse durchgeführt: Keine Issues in der Testdatei
Automatische Analyse: Wieder aktiviert ✓
```

---

## 🔍 Nicht abgedeckte Pfade (bewusst für später)

Folgende Pfade wurden **nicht** in diesem Schritt getestet, da sie entweder:
- Bereits durch existierende Tests abgedeckt sind (`tests/client/hooks/use-compilation.test.tsx`, `tests/client/hooks/use-simulation-controls.test.tsx`)
- Oder im geplanten Refactoring ohnehin neu strukturiert werden

| Pfad | Status | Begründung |
|------|--------|------------|
| `handleCompile()` (nur Compile ohne Start) | ✅ Bereits abgedeckt in `use-compilation.test.tsx` | 25 existierende Tests |
| `pauseMutation`, `resumeMutation` | ✅ Bereits abgedeckt in `use-simulation-controls.test.tsx` | 24 existierende Tests |
| `handleReset()` | ✅ Bereits abgedeckt in `use-simulation-controls.test.tsx` | Reset-Tests vorhanden |
| Pin-Conflict-Warning in `startMutation.onSuccess` | ⚠️ Teilweise abgedeckt | Existierender Test prüft `setCliOutput` mit Conflict-Message |
| `isBackendUnreachableError` Toast-Pfad | ✅ Bereits abgedeckt in `use-compilation.test.tsx` | Backend-unreachable Test vorhanden |
| `__SET_LAST_COMPILED_CODE__` (E2E-Test-Hook) | ⚠️ Nicht getestet | Nur in DEV, für E2E-Tests gedacht |

---

## 📈 Testbasis für Action-Plan-Punkt 2.1

### Bewertung: **Ausreichend für Refactoring-Start** ✅

Die neuen Characterization Tests decken die **kritischen Pfade** ab:

1. **Compile → Start Success** (Hauptpfad)
2. **Compile → Error → No Start** (Fehlerpfad)
3. **Backend Disconnected** (Edge Case)
4. **Stop Simulation** (Lifecycle)
5. **WebSocket Send Fallback** (Resilienz)

### Empfohlene nächste Schritte (Phase 2.1 Refactoring)

1. **Sub-Hooks extrahieren:**
   - `useCompileController()` – Compile-Mutation, State, Error-Handling
   - `useSimulationController()` – Start/Stop/Pause/Resume-Mutationen
   - `useCompileAndRunOrchestration()` – Koordination zwischen Compile und Simulation

2. **Pro Sub-Hook eigene Testdatei:**
   - `tests/client/hooks/use-compile-controller.test.tsx`
   - `tests/client/hooks/use-simulation-controller.test.tsx`
   - Characterization Tests bleiben als Integrationstest erhalten

3. **Coverage-Ziel:** >80% pro Sub-Hook (siehe Action-Plan 10.2)

---

## 📝 Git-Strategie (wie in Action-Plan 11.1)

### Empfohlene Commit-Historie für Phase 2.1

```bash
# 1. Characterization Tests (dieser Schritt)
git add tests/client/hooks/use-compile-and-run.characterization.test.tsx
git commit -m "[Phase 2.9] Add characterization tests for use-compile-and-run.ts"

# 2. Refactoring: Sub-Hooks extrahieren (nächster Schritt)
git commit -m "[Phase 2.1] Extract useCompileController from use-compile-and-run"
git commit -m "[Phase 2.1] Extract useSimulationController from use-compile-and-run"
git commit -m "[Phase 2.1] Refactor use-compile-and-run to orchestrate sub-hooks"

# 3. Tests für Sub-Hooks
git commit -m "[Phase 2.1] Add unit tests for useCompileController"
git commit -m "[Phase 2.1] Add unit tests for useSimulationController"

# 4. Dokumentation
git commit -m "[Phase 2.1] Update ARCHITECTURE.md with new hook structure"
```

---

## ✅ Checkliste Phase 2.9 (Characterization Tests)

| Anforderung | Status |
|-------------|--------|
| Tests dokumentieren **aktuelles** Verhalten | ✅ |
| Keine Produktionslogik verändert | ✅ |
| Compile → Start → Stop Pfad abgesichert | ✅ |
| Fehlerpfade (Compile-Error, Backend-Down) | ✅ |
| WebSocket-Send-Verhalten (immediate vs. buffered) | ✅ |
| Backend-Connected-Check vor Compile | ✅ |
| Pin-UI-Reset mit `keepDetected` | ✅ |
| Serial-Queue-Cleanup bei Stop | ✅ |
| Typecheck grün (`npm run check`) | ✅ |
| Unit-Tests grün (`npm run test:unit`) | ✅ |
| SonarQube keine neuen Issues | ✅ |
| Automatische Analyse wieder aktiv | ✅ |

---

## 🎯 Fazit

Die Characterization Tests bieten eine **sichere Grundlage** für das geplante Refactoring von `use-compile-and-run.ts` (Action-Plan 2.1). Sie dokumentieren das aktuelle Verhalten und werden bei zukünftigen Änderungen als Sicherheitsnetz dienen.

**Nächster Schritt:** Sub-Hooks extrahieren und pro Sub-Hook isolierte Unit-Tests mit >80% Coverage erstellen.

---

**Erstellt:** 2026-09-04  
**Getestete Datei:** `client/src/hooks/use-compile-and-run.ts` (900 Zeilen)  
**Neue Tests:** 5 Characterization Tests  
**Gesamt-Testbasis:** 1524 Tests (+5)  
**Alle Prüfungen:** ✅ Grün
