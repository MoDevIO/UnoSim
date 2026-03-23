# Opus Audit (16. März 2026)

**Analyst:** GitHub Copilot (Claude Opus 4.6)
**Kontext:** Nach umfangreicher Sanierung (Issues ~1.400 → 891) soll ein priorisierter Refactoring-Plan für die verbleibenden Cognitive Complexity- und Typunsicherheits-Issues erstellt werden.

---

## 1. Strukturelle Diagnose: Zentren der Komplexität

### 🔥 A: Die 428-LOC `useEffect`-Bombe in `arduino-board.tsx`
- **Problem:** Ein einziger `useEffect` (L264–L691) führt einen 10ms-Polling-Loop aus, der imperativ DOM-Elemente verändert.
- **Folge:** Extrem hohe Cognitive Complexity, hoher Wartungsaufwand, schwer testbar.

### 🔥 B: Callback-Kaskaden in `execution-manager.ts`
- Hauptprobleme: `runSketch()` (114 LOC) und `setupLocalHandlers()` (98 LOC) enthalten mehrere verschachtelte Callback-Ketten (`PinStateBatcher`, `SerialOutputBatcher`, `onStdout/onStderr/onClose`).
- Resultat: viele Sonar-Complexity-Flags und schwer nachverfolgbare Prozesszustände.

### 🔥 C: Mikro-Patterns, die Sonar-Issues multiplizieren
- `arr[arr.length-1]` statt `.at(-1)`
- `window` statt `globalThis`
- `substr()` statt `substring()`
- redundante Union-Typen statt Typalias
- nicht `readonly` markierte Member
- Nested template literals

Diese Muster erzeugen viele (~40) leicht fixbare Issues.

---

## 2. Low-Hanging Fruit (Prio A)

### ✅ A1: ESLint-Autofixes (0 Risiko)
Aktiviere/verschärfe Regeln in `eslint.config.js` und führe `npx eslint --fix .` aus:
- `unicorn/prefer-at`: `arr[arr.length-1]` → `arr.at(-1)`
- `unicorn/prefer-global-this`: `window` → `globalThis`
- `unicorn/prefer-string-slice`: `substr` → `substring` / `slice`
- `unicorn/prefer-node-protocol`: `fs` → `node:fs` (beliebte Imports)
- `sonarjs/no-nested-ternary`: zerlege verschachtelte Ternares in Klartext
- `@typescript-eslint/prefer-readonly`: `readonly`-Member

### ✅ A2: Shared Helper für `pinMode` (4 Issues)
Extrahiere `pinModeToString(mode: number)` und ersetze alle nested ternaries in:
- `output-panel.tsx` (2x)
- `registry-manager.ts`
- `simulation.ws.ts`

### ✅ A3: `console.*` → `Logger` (6–9 Issues)
- `use-compile-and-run.ts` (`console.info`) → `Logger.info`
- `simulation.ws.ts` (`console.info`) → `Logger.info`
- `arduino-board.tsx` debug `console.log` → entfernen / `Logger.debug`

### ✅ A4: `String.raw` für C++-Template (1 Issue)
- `arduino-string.ts`: `String.raw` statt normalem Template, damit Backslashes korrekt bleiben.

**Ergebnis:** ~50 Issues sofort raus, Baseline sauber.

---

## 3. Architektonische Operationen (Prio B)

### 💥 B1: `arduino-board.tsx` zerschlagen (Key-Op)
**Ziel:** Reduzierung von LOC + Cognitive Complexity, solide API für UI/DOM-Logik.

#### B1.1 → `usePinPollingEngine()` (428 LOC → Hook)
- Extrahiere den 10ms-Polling-Loop vollständig.
- Zerlege ihn in 4 Sub-Runner: `updateDigitalPins()`, `updateAnalogPins()`, `updateLEDs()`, `updateLabels()`.
- Resultat: `ArduinoBoard` verliert ~40% seines Codes; `performAllUpdates` wird testbar.

#### B1.2 → `useAnalogSliders()` (93 LOC)
- Entferne Slider-Position- und Value-Sync-Logik aus `ArduinoBoard`.
- Hook liefert `sliderPositions` und `sliderValues`.

#### B1.3 → `useBoardScale()` (60 LOC)
- ResizeObserver + `getModifiedSvg`/`getOverlaySvg` werden ein eigener Hook.

#### B1.4 → `AnalogPinDialog` in eigene Datei
- Auskapselung von Positionierungs-Logik (3× `getComputedStyle`) und State.

**Impact:** `arduino-board.tsx` wird ~460 LOC und ~15–20 CC, plus klar definierte Hooks.

---

## 4. Typ-Härtung (Prio C)

### C1: Schnelle Typfixes (5 Stellen)
- `arduino-compiler.ts` → `IOPinRecord[]`
- `use-debug-console.ts` / `use-pin-state.ts` → `CustomEvent<{value: boolean}>`
- `shared/logger.ts` → `reason: unknown`
- `compiler.routes.ts` → `headers?: Array<{name: string; content: string}>`

### C2: `any` → Node-Types (3 Stellen)
- `process-executor.ts`: `ChildProcess` statt `any` + global augmentation für `spawnInstances`
- `run-sketch-types.ts`: `TelemetryMetrics` statt any, aligned mit `execution-manager.ts`

### C3: `ParsedLine` Discriminated Union (1 Stelle, hoher Hebel)
- `stream-handler.ts` `handleParsedLine(parsed: any, ...)` → `ParsedLine`-Union (Registry, PinState, SerialOutput, etc.)
- Ergebnis: Compiler erzwingt Exhaustiveness, `any` verschwindet + Code lesbar.

### C4: `as`-Casts in `arduino-board.tsx` (8 Stellen)
- Alle `as EventListener` usw. entfernen via `onCustomEvent<T>(target, name, handler)` Utility.

---

## 5. Risiko-Einschätzung (wo brennt es am meisten?)

### 🔥 Höchstes Regressions-Risiko
1. **B1 (`usePinPollingEngine`)** – Polling-Loop manipuliert DOM direkt, kann raceconditions erzeugen. *Test-Absicherung erforderlich!* (E2E + Visual / Snapshot)
2. **Stream/Parser-Refactoring** (`stream-handler.ts`) – Core-Pipeline für Pin-/Serial-State. Fehler hier schlägt in vielen Szenarien durch.

### ⚠️ Mittleres Risiko
- `execution-manager.ts` Dekomposition (siehe oben) – wenn Handler-Reihenfolge nicht 1:1 bleibt, kann Simulation state-locken.
- `registry-manager.ts` `updatePinMode()` (CC=29) – hier wird Konfliktlogik gepflegt.

### ✅ Niedrigstes Risiko
- ESLint-Autofixes + `console.*` → `Logger` + `pinModeToString` Helper + `readonly`-Fixes: keine Logikveränderung.

---

## 6. Nächste Schritte (empfohlene Abfolge)

1. **Sofort:** Regelset erweitern + `npx eslint --fix .` → Baseline sichern.
2. **Parallel:** `pinModeToString()`-Helper + `console.*` → `Logger` + `String.raw` fixen.
3. **Big Move:** `arduino-board.tsx` in 4 Module (`usePinPollingEngine`, `useAnalogSliders`, `useBoardScale`, `AnalogPinDialog`) zerschneiden (+ Tests).
4. **Typen:** `any`-Stellen aus C1/C2 angehen, dann `ParsedLine`-Union einführen.
5. **Als letztes:** `execution-manager.ts` und `registry-manager.ts` strukturieren (Modul-Extraktion, kleinere private helpers).

---

## 7. Quick-Win-Priorität (Auswahl)

1. **Prio A:** ESLint-Regeln + `eslint --fix` (Schnellster Impact, niedrigstes Risiko)
2. **Prio B:** `arduino-board.tsx` Polling-Hook (größter Komplexitätshebel)
3. **Prio C:** `any` → typed Event/ParsedLine (Weniger Fehler & bessere Code-Qualität)

---

### Hinweis
Die Analyse beruht auf der aktuellen Codebasis (Stand 16. März 2026). Nach Abschluss der Prio-A-Patches sollten wir erneut die Sonar/Metrics-Liste laufen lassen, um die tatsächliche Issue-Reduktion zu verifizieren und ggf. den nächsten “multiplikativen” Hotspot zu bestimmen.
