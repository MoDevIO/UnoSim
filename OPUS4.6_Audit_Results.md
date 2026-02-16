# Architektur-Audit: Komplexität & Modularisierung

**Auditor:** Claude Opus 4.6 — Senior Architekt & Code-Auditor  
**Datum:** 16. Februar 2026  
**Scope:** UNO Web Simulator — Full-Stack Analyse  

---

## Executive Summary

Das Repository weist eine asymmetrische Verteilung auf: Eine Handvoll "God Objects" bindet den Großteil der Komplexität. **5 Dateien (von ~80 Source-Dateien) konzentrieren 50% der gesamten Codebasis** und 80% der kognitiven Last. Die im Folgenden identifizierten Hotspots erzeugen ein fragiles Geflecht aus bidirektionalen Abhängigkeiten, das Änderungen risikobehaftet und teuer macht.

### Kennzahlen-Übersicht

| Bereich | LOC (netto) | Dateien | Ø LOC/Datei |
|---------|-------------|---------|-------------|
| Backend Services | 6.144 | 17 | 361 |
| Frontend (Styles + Components) | 12.854 | 42 | 306 |
| Unit-Tests | 25.797 | 70+ | 368 |
| E2E-Tests | 914 | 7 | 131 |
| **Summe Source** | **19.998** | **59** | **339** |
| **Summe Tests** | **26.711** | **77+** | **347** |

**Test-zu-Source-Verhältnis:** 1,34:1 — ein gesundes Verhältnis, aber mit erheblichem Duplikat-Anteil (siehe Abschnitt 3).

---

## 1. Architektur-Diagramm: Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (12.854 LOC)                              │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  arduino-simulator.tsx (2.761 LOC) — GOD COMPONENT                 │    │
│  │  52 Hooks • 39 Imports • ~100 State-Werte • 35 Props an AppHeader  │    │
│  │                                                                     │    │
│  │  ┌──────────────┐  ←→  ┌───────────────────┐                      │    │
│  │  │use-compilation│      │use-simulation-    │  ← BIDIREKTIONAL     │    │
│  │  │  (472 LOC)   │      │  controls (240)   │     GEKOPPELT        │    │
│  │  │  20 Params   │      │  13 Params        │                      │    │
│  │  └──────┬───────┘      └──────┬────────────┘                      │    │
│  │         │ HTTP                │ WebSocket                         │    │
│  │         ▼                     ▼                                    │    │
│  │  ┌──────────────┐      ┌───────────────────┐                      │    │
│  │  │queryClient   │      │websocket-manager  │                      │    │
│  │  └──────────────┘      │  (456 LOC)        │                      │    │
│  │                        └──────┬────────────┘                      │    │
│  └───────────────────────────────┼──────────────────────────────────-─┘    │
│         12 Feature-Components    │   17 UI-Components                     │
│         (5.054 LOC)              │   (shadcn/ui)                          │
└──────────────────────────────────┼────────────────────────────────────────-┘
                                   │ ws://
┌──────────────────────────────────┼────────────────────────────────────────-┐
│                         BACKEND (6.144 LOC)                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  routes.ts (744 LOC) — MONOLITHISCHER ENTRY-POINT                   │   │
│  │  1 Funktion (registerRoutes): 717 Zeilen, 6 Verantwortlichkeiten    │   │
│  │  12 Imports, 8 WebSocket-Cases, 240-Zeilen start_simulation-Block   │   │
│  └──────────────────────────────────┬──────────────────────────────────-┘   │
│                                     │                                       │
│  ┌──────────────────────────────────▼──────────────────────────────────┐   │
│  │  sandbox-runner.ts (1.479 LOC) — GOD OBJECT                        │   │
│  │  27 private Felder • 6 Verantwortlichkeiten • 14 Imports           │   │
│  │  runSketch(): 11 Parameter • ~70% Handler-Duplikation              │   │
│  └──────────┬──────────┬──────────┬──────────┬────────────────────────-┘   │
│             │          │          │          │                              │
│             ▼          ▼          ▼          ▼                              │
│  ┌─────────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐               │
│  │registry-mgr │ │pin-state │ │serial-  │ │arduino-output│               │
│  │(587 LOC)    │ │batcher   │ │batcher  │ │parser        │               │
│  │4 Concerns   │ │(150 LOC) │ │(286 LOC)│ │(247 LOC)     │               │
│  └─────────────┘ └──────────┘ └─────────┘ └──────────────┘               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  shared/code-parser.ts (622 LOC) — MONOLITHISCHER PARSER            │   │
│  │  5 unabhängige Analyse-Domains in einer Klasse                      │   │
│  │  parseHardwareCompatibility: 187 Zeilen — höchste zyklomatische K.  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  server/mocks/arduino-mock.ts (941 LOC) — C++ RUNTIME TEMPLATE      │   │
│  │  Irreführender Name: KEIN Mock, sondern produktiver C++-Laufzeit-   │   │
│  │  Code als Template-Literal. Keine Linting-/Tooling-Unterstützung    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Top 5 Refactoring-Hotspots

### Hotspot #1: `client/src/pages/arduino-simulator.tsx` (2.761 LOC)
**Schweregrad: 🔴 KRITISCH — Sofortige Aufmerksamkeit**

| Metrik | Wert | Ziel |
|--------|------|------|
| Zeilen | 2.761 | < 400 |
| Hooks | 52 (36 React + 16 Custom) | < 10 |
| State-Werte im Scope | ~100+ | < 20 |
| Props an AppHeader | ~35 | < 10 |
| Duplizierte JSX-Blöcke | 5 Komponenten in Desktop + Mobile | 0 |

**Problem:** God Component — vereint State-Orchestrierung, WebSocket-Message-Dispatching, C++-Code-Analyse, Layout-Engine und Mobile-Adapter in einer einzigen Funktion von 2.677 Zeilen.

**Refactoring-Roadmap:**

| Phase | Extraktion | Lines gewonnen | Impact |
|-------|-----------|----------------|--------|
| **P0** | WebSocket-Handler → `useWebSocketHandler` | −367 | Eliminiert größten `useEffect` (L731–1098) |
| **P0** | Output-Panel IIFE → `<OutputPanel />` | −528 | Selbstständige Tab-UI mit Debug-Console |
| **P1** | Analog-Pin-Parser → `useAnalogPinDetection` | −131 | Pure Code-Analyse ohne Rendering |
| **P1** | Serial-Panel → `<SerialPanel />` | −141 | Wird 3× mit identischen Props gerendert |
| **P1** | Board-Panel → `<BoardPanel />` | −100 | Eliminiert Prop-Duplikation |
| **P2** | Mobile-Layout → `<MobileLayout />` | −194 | Eigener Rendering-Pfad |
| **P2** | Editor-Commands → `useEditorCommands` | −109 | 6 trivial-ähnliche Wrapper |
| **P2** | Tab-Management → in `useSketchTabs` falten | −165 | Logik gehört zum bestehenden Hook |
| **P3** | `use-compilation` ↔ `use-simulation-controls` Merger | −60 | Löst bidirektionale Kopplung |

**Kumulierter Effekt:** ~1.600 LOC extrahierbar (58% der Datei). Ziel-Größe: ~1.100 LOC als reiner Layout-Orchestrator.

---

### Hotspot #2: `server/services/sandbox-runner.ts` (1.479 LOC)
**Schweregrad: 🔴 KRITISCH**

| Metrik | Wert | Ziel |
|--------|------|------|
| Zeilen | 1.479 | < 400 |
| Private Felder | 27 | < 10 |
| Verantwortlichkeiten | 6 | 1–2 |
| `runSketch()` Parameter | 11 | Options-Objekt |
| Duplizierter Handler-Code | ~130 LOC | 0 |

**Problem:** God Object mit 6 vermischten Verantwortlichkeiten: State Machine, Prozess-Lifecycle, Docker-Orchestrierung, I/O-Stream-Parsing, Temp-File-Management und Baudrate-Throttling.

**Refactoring-Roadmap:**

| Phase | Extraktion | Lines gewonnen | Impact |
|-------|-----------|----------------|--------|
| **P0** | `ProcessManager` extrahieren (spawn/pause/resume/kill) | −200 | Isoliert OS-Prozess-Logik |
| **P0** | `setupDockerHandlers` + `setupLocalHandlers` unifizieren | −130 | Eliminiert 70% identen Code über Strategy-Pattern |
| **P1** | `CleanupManager` extrahieren (Temp-Dir + Registry) | −100 | Testbar ohne Sandbox |
| **P1** | `RunSketchOptions`-Interface statt 11 Parameter | −0 (LOC-neutral) | Kognitive Last signifikant reduziert |
| **P2** | `scheduleErrorFlush` → `handleParsedLine` wiederverwenden | −50 | DRY-Violation eliminiert |

---

### Hotspot #3: `server/routes.ts` (744 LOC)
**Schweregrad: 🔴 KRITISCH**

| Metrik | Wert | Ziel |
|--------|------|------|
| Zeilen als 1 Funktion | 717 | < 50 pro Funktion |
| Verantwortlichkeiten | 6 | 1 pro Route-Gruppe |
| `start_simulation` Case | 240 Zeilen | < 30 (Delegation) |
| Inline-Callback-Lambdas | 9 | 0 (Named Functions) |

**Problem:** `registerRoutes()` ist eine 717-Zeilen-God-Function, die HTTP-Endpoints, WebSocket-Lifecycle, Simulation-State-Machine und Compilation-Caching in einer einzigen Closure vereint.

**Refactoring-Roadmap:**

| Phase | Extraktion | Impact |
|-------|-----------|--------|
| **P0** | `setupHttpRoutes(app)` — Health, Examples, CRUD, Compile | Eigenständig testbar |
| **P0** | `setupWebSocket(server)` — Connection Lifecycle | Isoliert WS von HTTP |
| **P1** | `SimulationSession` Klasse — Named Callbacks statt 9 Lambdas | Testbar, wiederverwendbar |
| **P1** | `CompilationCache` Klasse — TTL + Hash-Logik | Separation of Concerns |

---

### Hotspot #4: `shared/code-parser.ts` (622 LOC)
**Schweregrad: 🟠 HOCH**

| Metrik | Wert | Ziel |
|--------|------|------|
| Analyse-Domains | 5 in 1 Klasse | 5 separate Checker |
| `parseHardwareCompatibility` | 187 LOC | < 50 pro Checker |
| `parseSerialConfiguration` | 106 LOC | < 40 |
| Regex-Pattern | ~25 inline | Benannte Konstanten |

**Problem:** "God Parser" — 5 unabhängige Analyse-Domains (Serial, Struktur, Hardware, Pin-Konflikte, Performance) in einer einzigen Klasse. `parseHardwareCompatibility` hat die höchste zyklomatische Komplexität im gesamten Repository.

**Refactoring-Roadmap:**

| Phase | Extraktion | Impact |
|-------|-----------|--------|
| **P1** | Plugin/Strategy-Pattern: `SerialChecker`, `StructureChecker`, `HardwareChecker`, `PinConflictChecker`, `PerformanceChecker` | Einzeln testbar, erweiterbar |
| **P1** | Regex-Patterns als benannte Konstanten extrahieren | Lesbarkeit, Wiederverwendung |
| **P2** | `CodeParser.parseAll()` als Kompositions-Facade beibehalten | API-Kompatibilität |

---

### Hotspot #5: Hook-Kopplung `use-compilation` ↔ `use-simulation-controls`
**Schweregrad: 🟠 HOCH**

| Metrik | Wert | Ziel |
|--------|------|------|
| Parameter an `use-compilation` | 20 | < 5 (Context/Store) |
| Parameter an `use-simulation-controls` | 13 | < 5 |
| Bidirektionale Abhängigkeit | Ja (über Parent-Ref-Bridge) | Unidirektional |
| Render-Time Ref-Mutation | L185 in controls | useEffect |

**Problem:** Beide Hooks sind keine eigenständigen Einheiten — sie sind fragmentierte Teile eines "Compile-and-Run"-Workflows, zusammengeklebt durch den Parent via 33 durchgereichte Parameter und Ref-basierte Kreisabhängigkeitsbrücken.

**Refactoring-Roadmap:**

| Phase | Aktion | Impact |
|-------|--------|--------|
| **P1** | Zusammenführen zu `useCompileAndRun` mit internem State-Management | Eliminiert bidirektionale Kopplung |
| **P1** | `useMutation` für WS-Sends durch simple `useCallback` ersetzen | Semantisch korrekt, weniger Overhead |
| **P2** | Context-Provider für Compilation-State statt Prop-Drilling | AppHeader und SerialPanel werden unabhängig |

---

## 3. Test-Suite: Duplikations-Analyse

### Kritische Duplikation: Load-Tests (1.731 LOC, ~95% identisch)

| Datei | LOC | Einziger Unterschied |
|-------|-----|---------------------|
| `tests/server/load-test-50-clients.test.ts` | 445 | `NUM_CLIENTS=50`, Thresholds |
| `tests/server/load-test-100-clients.test.ts` | 428 | `NUM_CLIENTS=100`, Thresholds |
| `tests/server/load-test-200-clients.test.ts` | 428 | `NUM_CLIENTS=200`, Thresholds |
| `tests/server/load-test-500-clients.test.ts` | 430 | `NUM_CLIENTS=500`, Thresholds |

**Empfehlung:** Konsolidierung in 1 parametrisierte Datei mit Config-Array:

```typescript
const LOAD_CONFIGS = [
  { clients: 50, passRate: 0.6, avgLimit: 40_000, timeout: 90_000 },
  { clients: 100, passRate: 0.55, avgLimit: 50_000, timeout: 180_000 },
  { clients: 200, passRate: 0.30, avgLimit: 60_000, timeout: 300_000 },
  { clients: 500, passRate: 0.25, avgLimit: 90_000, timeout: 720_000 },
];
```

**Einsparung: ~1.300 LOC** (75% Reduktion der Test-Dateien).

### Output-Panel Tests: ~35% Überlappung

| Datei | LOC | Abstraktionsebene |
|-------|-----|-------------------|
| `output-panel-auto-behavior.test.tsx` | 720 | Pure Sizing-Berechnung |
| `output-panel-integration.test.tsx` | 572 | State-Machine-Übergänge |
| `output-panel-runtime.test.tsx` | 487 | Reales DOM-Rendering |

Sizing-Formeln (`HEADER_HEIGHT=50`, `PER_LINE=20`, `PADDING=60`, `AVAILABLE_HEIGHT=800`) und identische Szenarien sind 3× dupliziert. **Empfehlung: Shared Test-Utilities extrahieren** (~200–300 LOC Einsparung).

### Test-zu-Source-Ratio pro Bereich

| Bereich | Source | Tests | Ratio | Bewertung |
|---------|--------|-------|-------|-----------|
| Backend Services | 6.144 | 14.670 | 2,39:1 | 🟡 Leicht aufgebläht durch Load-Test-Duplikation |
| Frontend | 12.854 | 9.591 | 0,75:1 | 🟢 Angemessen |
| Shared | 577 | 1.536 | 2,66:1 | 🟢 Gute Abdeckung |

---

## 4. Weitere Auffälligkeiten

### `server/mocks/arduino-mock.ts` (941 LOC) — Irreführende Benennung

**Problem:** Trotz des Namens `mocks/` ist dies **kein Test-Mock**, sondern die produktive C++-Laufzeitumgebung als Template-Literal. Sie wird User-Sketches vorangestellt und kompiliert.

| Risiko | Detail |
|--------|--------|
| Keine Tooling-Unterstützung | ~900 Zeilen C++ als String-Literal: kein Syntax-Highlighting, kein Linting, keine IDE-Navigation |
| Hardcodierte Zeilen-Offset | `ARDUINO_MOCK_LINES = 427` ist als "approximate" markiert — Drift führt zu falschen Fehlerzeilennummern |
| Toter Export | `ARDUINO_MOCK_CODE_MINIMAL` ist identisch mit `ARDUINO_MOCK_CODE` |
| Protokoll-Synchronisierung | `[[PIN_MODE:...]]`, `[[SERIAL_EVENT:...]]` etc. müssen handisch mit dem Server-Parser synchron gehalten werden |

**Empfehlung:** Datei nach `server/runtime/arduino-runtime.cpp.ts` umbenennen. `ARDUINO_MOCK_LINES` durch automatische Zählung ersetzen.

### `client/src/components/features/arduino-board.tsx` (1.076 LOC)

**Problem:** ~85% imperative SVG-DOM-Manipulation, 10ms Polling-Loop, Fade-Out-Tracking — der React-Anteil ist minimal.

**Empfehlung:** SVG-Update-Logik in `useSvgPinUpdater` Hook extrahieren (~300 LOC). `AnalogDialogPortal` und `DialogInner` in eigene Datei verschieben.

### `client/src/hooks/use-output-panel.ts` (376 LOC)

**Problem:** 7 separate `useEffect`s mit imperativem DOM-Zugriff (`getBoundingClientRect`, `style.minHeight`). Lauscht auf Custom DOM Events (`showCompileOutputChange`) ohne typisierte Contracts — die Sender sind unsichtbar.

**Empfehlung:** Pixel-basierte Sizing-Logik in CSS/Container-Queries verlagern.

---

## 5. Priorisierte Roadmap

```
Phase 0 (Sofort — 1 Sprint)        Phase 1 (Kurzfristig — 2 Sprints)     Phase 2 (Mittelfristig)
─────────────────────────────       ────────────────────────────────       ───────────────────────
                                                                           
[H1] WS-Handler extrahieren        [H1] Analog-Pin-Parser Hook           [H1] Mobile-Layout
[H1] Output-Panel Komponente        [H1] Serial/Board-Panel Komp.         [H1] Editor-Commands
[H2] Docker/Local Handler            [H2] CleanupManager                   [H2] Error-Flush DRY
     unifizieren                     [H2] RunSketchOptions Interface       [H4] Regex-Konstanten
[H3] HTTP-Routes extrahieren        [H3] SimulationSession Klasse        [H5] Context-Provider
[H3] WS-Handler extrahieren         [H4] Parser Plugin-Pattern                 statt Props
[H5] Load-Tests konsolidieren       [H5] Hooks zusammenführen             
                                                                           
Geschätzte LOC-Reduktion:           Geschätzte LOC-Reduktion:             Geschätzte LOC-Reduktion:
Source: ~1.200 (via Dedup)          Source: ~800 (via Extraktion)         Source: ~500
Tests:  ~1.300 (Load-Tests)         Tests:  ~300 (shared utils)          Tests:  ~200
```

### Impact-Matrix

| Hotspot | Kognitive Last (vorher) | Kognitive Last (nachher) | Risiko bei Nicht-Handeln |
|---------|------------------------|-------------------------|--------------------------|
| H1: arduino-simulator.tsx | 🔴 Extrem (52 Hooks) | 🟢 Niedrig (~10 Hooks) | Jede UI-Änderung ist ein Glücksspiel |
| H2: sandbox-runner.ts | 🔴 Extrem (27 Felder) | 🟡 Moderat (~8 Felder) | Docker/Local-Änderung bricht andere Pfade |
| H3: routes.ts | 🔴 Hoch (717 LOC/Fn) | 🟢 Niedrig (~50 LOC/Fn) | Neue Endpoints = Merge-Konflikte |
| H4: code-parser.ts | 🟠 Hoch (187 LOC/Fn) | 🟢 Niedrig (~40 LOC/Fn) | Neue Parser-Regel = Seiteneffekte |
| H5: Hook-Kopplung | 🟠 Hoch (33 Params) | 🟢 Niedrig (~5 Params) | Neue Features = Prop-Drilling-Kaskade |

---

## 6. Zusammenfassung

Die Codebase hat eine **solide fachliche Struktur** (klare Trennung Client/Server/Shared, gute Test-Abdeckung), leidet aber unter **5 monolithischen Hotspots**, die zusammen 6.106 LOC (31% des Source-Codes) ausmachen und ~80% der Wartungslast tragen.

Die vorgeschlagene Roadmap reduziert die kognitive Last in 3 Phasen:

| Kennzahl | Ist | Soll (nach Phase 2) | Reduktion |
|----------|-----|---------------------|-----------|
| Größte Datei (Source) | 2.761 LOC | ~1.100 LOC | −60% |
| Größte Funktion | 717 LOC | ~50 LOC | −93% |
| Max. Hooks/Komponente | 52 | ~10 | −81% |
| Max. Parameter/Hook | 20 | ~5 | −75% |
| Test-Duplikation (Load) | 1.731 LOC | ~450 LOC | −75% |

**Kernprinzip aller Empfehlungen:** Module zusammenfassen wo Kopplung bereits besteht (use-compilation ↔ use-simulation-controls), trennen wo Verantwortlichkeiten vermischt sind (sandbox-runner, routes, code-parser).
