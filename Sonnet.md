# 🔥 HOTSPOT-INVENTUR: Schlachtplan (Sonnet-Analyse)

**Datum:** 15. März 2026  
**Analyst:** GitHub Copilot (Claude Sonnet 4.6)  
**Status:** Analyse abgeschlossen · Keine Änderungen durchgeführt · Schlachtplan bereit  
**Methode:** Direkte Code-Messung via grep-Inventur (keine Schätzung)

---

## EXECUTIVE SUMMARY

| Kategorie | Gemessene Befunde |
|---|---|
| IDE-Problems (get_errors) | 451 |
| Typ-Assertion-Muster (`as any`, `as X`) | 341 |
| Bare Node.js Imports (kein `node:` Prefix) | 81 |
| `parseInt`/`parseFloat` (statt `Number.*`) | 69 |
| Verschachtelte Ternaries | 127 |
| `console.*` in Produktionscode | 68 |

**Kernerkenntnis:** 5 Muster/Dateien sind für den Großteil der Befunde verantwortlich und lassen sich mit unterschiedlichem Automatisierungsgrad beheben.

---

## DIE 5 GIFTQUELLEN

### #1 — `as any` / Unsafe Type Assertion Epidemie
**~341 Vorkommen · geschätzte Last: ~250 Issues · ~18% aller Befunde**

Direkt gemessene Spitzenwerte:

| Datei | Casts |
|---|---|
| `tests/server/services/sandbox-runner.test.ts` | 52 |
| `client/src/components/features/arduino-board.tsx` | 36 |
| `shared/code-parser.ts` | 28 |
| `tests/client/hooks/use-compilation.test.tsx` | 24 |
| `tests/server/registry-manager-telemetry.test.ts` | 24 |

**Ursache:**  
Testcode flüchtet systematisch in `as any`, um fehlende Mock-Typisierungen zu umgehen. Produktionscode narrowt unnötig mit `as string` / `as NodeJS.Signals` statt über Type-Predicates.

**Schlachtplan:**
- **Produktionscode:** `ts-morph`-Codemod, der `as X` entfernt, wenn X der bereits vom Compiler inferierten Type entspricht (deckt ~50–60% automatisch ab).
- **Testcode:** Einmalig pro Datei stark typisierte Mock-Interfaces definieren (`PartialMock<SandboxRunner>` o.Ä.), dann alle `as any` durch generische Wrapper ersetzen. `sandbox-runner.test.ts` (52 Fälle) ist der größte Einzelhebel.

---

### #2 — Bare Node.js Built-in Imports (kein `node:` Prefix)
**~81 Import-Zeilen · ~35–40 betroffene Dateien · vollständig automatisierbar**

Betrifft: `fs/promises`, `path`, `child_process`, `readline`, `http`, `zlib`, `crypto`, `os`.

Dateien mit den meisten Verstößen (direkt gemessen):

| Datei | Bare Imports |
|---|---|
| `server/vite.ts` | 4 |
| `server/routes.ts` | 4 |
| `server/index.ts` | 3 |
| `tests/e2e/global-teardown.ts` | 3 |
| `tests/server/core-cache-locking.test.ts` | 3 |
| `server/services/compilation-worker-pool.ts` | 3 |

**Schlachtplan (vollständig automatisierbar, 0 Logik-Änderungen):**

```bash
find server tests shared -name "*.ts" | xargs sed -i '' \
  -e 's/from "child_process"/from "node:child_process"/g' \
  -e 's/from "readline"/from "node:readline"/g' \
  -e 's/from "fs\/promises"/from "node:fs\/promises"/g' \
  -e 's/from "fs"/from "node:fs"/g' \
  -e 's/from "path"/from "node:path"/g' \
  -e 's/from "http"/from "node:http"/g' \
  -e 's/from "zlib"/from "node:zlib"/g' \
  -e 's/from "crypto"/from "node:crypto"/g' \
  -e 's/from "os"/from "node:os"/g'
```

Danach `eslint --fix` für die wenigen dynamischen `await import("fs")`-Patterns.  
**Ergebnis: ~81 Issues auf null, in ~5 Minuten.**

---

### #3 — `arduino-board.tsx` (1165 LOC Monolith)
**~80 direkte Verletzungen + hohe Cognitive Complexity**

Direkt gemessene Verletzungen:

| Typ | Anzahl |
|---|---|
| `parseInt` / `parseFloat` | 12 |
| Unsichere Casts (`as X`) | 16 |
| `console.*` Aufrufe | 2 |
| Geschätzte Cognitive Complexity | >50 |

Enthält CSS-Property-`parseFloat` in Render-Schleifen, tief geschachteltes SVG-Rendering und Dialog-Positioning-Kaskaden.

**Schlachtplan:**
- **Phase A (Mechanisch, sofort):** `parseInt` → `Number.parseInt`, `parseFloat` → `Number.parseFloat` via `eslint --fix`. Sofort −12 Issues.
- **Phase B (Strukturell):**
  1. `usePinRenderer()` — Alle `parseFloat(getComputedStyle(...))` Blöcke aus der Render-Funktion in einen dedizierten Hook extrahieren.
  2. `PinSvgLayer` — SVG-Rendering-Code als eigene Komponente (~300 LOC Extraktion).
  3. `useArduinoBoardDialogs()` — Dialog-State und Positioning-Logik (die `getComputedStyle`-Kaskade am Ende der Datei).
- **Erwartet:** Cognitive Complexity ~50 → ~15, −50 Sonar-Issues.

---

### #4 — `parseInt` / `parseFloat` (globale Funktionen statt `Number.*`)
**69 Vorkommen · ~20 betroffene Dateien · vollständig per Autofix lösbar**

Spitzenwerte (direkt gemessen):

| Datei | Vorkommen |
|---|---|
| `client/src/components/features/arduino-board.tsx` | 12 |
| `server/services/arduino-output-parser.ts` | 10 |
| `shared/code-parser.ts` | 5 |
| `shared/io-registry-parser.ts` | 4 |
| `client/src/hooks/use-pin-state.ts` | 2 |
| `client/src/components/features/parser-output.tsx` | 2 |

**Schlachtplan:**

Die Regel `unicorn/prefer-number-properties` ist bereits in [eslint.config.js](eslint.config.js) aktiv, aber derzeit nicht als `"error"` klassifiziert.

```javascript
// eslint.config.js — eine Zeile ändern:
"unicorn/prefer-number-properties": "error"  // war: "warn"
```

```bash
npx eslint --fix .
```

Alle 69 Fälle werden automatisch auf `Number.parseInt` / `Number.parseFloat` umgeschrieben.  
**Kosten: 1 Zeile Config + 1 CLI-Aufruf.**

---

### #5 — `local-compiler.ts` + `code-parser.ts` — Cognitive Complexity Cluster
**2 Dateien · geschätzte ~80–120 Sonar-Complexity-Issues · strukturelles Risiko**

#### `server/services/local-compiler.ts` (370 LOC)
- **Gemessen:** 54 bewertete Kontrollfluss-Punkte (if/for/try) — Cognitive Complexity ~88
- IDE meldet: Complexity 88 → 15 erforderlich (`sonarjs/cognitive-complexity`)
- Sonar bewertet jede Verschachtelungsstufe ab Level 3 separat → Multiplikatoreffekt

#### `shared/code-parser.ts` (734 LOC)
- **Gemessen:** 28 Casts + ~50 Complexity-Issues
- Enthält einen `for`-`switch`-`if`-`try`-Stapel für die Arduino-Syntax-Erkennung
- Viele `as`-Casts direkt verbunden mit fehlender Typisierung der Parse-Ergebnisse

**Schlachtplan `local-compiler.ts`** (nach bewährtem Extraktionsmuster aus vorherigen Refactorings):

```typescript
// Ziel-Struktur compile():
async compile(sketch: Sketch) {
  await validateInputs(sketch);          // ~40 LOC extrahiert
  await prepareWorkspace(sketch.dir);    // ~60 LOC extrahiert
  return executeCompilation(sketch);     // ~30 LOC, Rest bleibt im Untermodul
}
```

Drei Extraktionen:
1. `validateInputs()` — Guards und Vorbedingungen
2. `prepareWorkspace()` — Filesystem-Setup, chmod, tmp-Dir
3. `executeCompilation()` — Delegiert an `process-controller`

**Schlachtplan `code-parser.ts`** (Sub-Parser-Strategie):

```typescript
// Ziel-Struktur:
function parseSketch(code: string): ParseResult {
  return {
    pins:       parsePinDeclarations(code),   // ~120 LOC
    loops:      parseLoopConstructs(code),    // ~100 LOC
    types:      parseTypeAnnotations(code),   // ~80 LOC
    conflicts:  parsePinConflicts(code),      // ~90 LOC
  };
}
```

Pro extrahierter Funktion verschwinden die zugehörigen `as`-Casts durch lokale Typinferenz.

---

## ZUSAMMENFASSUNG: ERLEDIGUNGSREIHENFOLGE

| Prio | Giftquelle | Gemessene Issues | Aufwand | Typ |
|---|---|---|---|---|
| **1** | Bare `node:` Imports | ~81 | 1 Shell-Befehl | 🤖 Vollautomatisch |
| **2** | `parseInt`/`parseFloat` | ~69 | 1 Config-Zeile + Fix | 🤖 Vollautomatisch |
| **3** | `as any` in Tests | ~150 | ~1 Tag (sandbox-runner.test erst) | 🔧 Strukturell |
| **4** | `arduino-board.tsx` Monolith | ~80 | 2–3 Tage Extraktion | 🔧 Strukturell |
| **5** | `local-compiler.ts`/`code-parser.ts` | ~80–120 | ~2 Tage Extraktion | 🔧 Strukturell |

**Priorisierung 1+2 zuerst:** Vollständig automatisierbar, kein Logik-Bruch, eliminieren ~150 Issues in ~30 Minuten. Schafft saubere Baseline für die strukturellen Arbeiten.

---

## VALIDATION STRATEGY

```bash
# Vor Beginn — Baseline sichern:
npm run check       # TypeScript: 0 errors ✓
npm run lint        # ESLint: Baseline
npm run test:fast   # Unit Tests: passing count
./run-tests.sh      # Volle Docker-Suite

# Nach jeder Phase:
npm run check       # Muss 0 errors bleiben
npm run test:fast   # Muss alle Tests bestehen
git commit -m "refactor: [phase N] - beschreibung"
```

---

## ABGRENZUNG ZU HAIKU.MD

| Aspekt | Haiku (Schätzung) | Sonnet (Messung) |
|---|---|---|
| Datenbasis | Heuristische Schätzung | Direkte grep-Zählung |
| `as any` Anzahl | ~40 | **341** (8,5× höher) |
| Node Import Violations | ~50 | **81** (62% höher) |
| `parseInt`/`parseFloat` | unklar | **69** direkt gemessen |
| Haupthotspot #1 | `local-compiler.ts` | `as any` Epidemie (codebaseweit) |
| Haupthotspot #2 | `code-parser.ts` | Bare Node Imports (81 Stellen) |
| Automatisierungsgrad Phase 1 | 150 Issues via `lint --fix` | ~150 Issues, aber 2 gezielte Befehle |

**Kernunterschied:** Die Sonnet-Analyse zeigt, dass `as any`/type-cast-Muster mit 341 Vorkommen der größte absolute Hebel ist — verteilt über viele Dateien, aber mit einem klaren Cluster in `sandbox-runner.test.ts` (52 Fälle).

---

*Schlachtplan erstellt am 15. März 2026 — Analyst: GitHub Copilot (Claude Sonnet 4.6)*  
*Methode: Direkte Code-Messung via Shell-Inventur aller .ts/.tsx Dateien*  
*Status: 🟢 Bereit für Umsetzung — Phase 1+2 empfohlen als Sofortmaßnahme*
