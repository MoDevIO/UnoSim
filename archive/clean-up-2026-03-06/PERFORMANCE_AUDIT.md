# UnoSim Performance-Audit & Entschlackungs-Roadmap

**Auditor:** Claude Opus 4.6 — System-Architekt für High-Performance Emulation  
**Datum:** 4. März 2026  
**Scope:** Full-Stack-Analyse — Latenz, Parallelisierung, I/O, Redundanz, Dependencies, Projektstruktur  
**Basis:** Audit v2 (20.02.2026) + aktuelle Codebase

---

## Kennzahlen (Ist-Zustand)

| Metrik | Wert |
|--------|------|
| Source-Code (client + server + shared) | 23.595 LOC |
| Tests (unit + e2e) | 25.541 LOC |
| Archiv (Markdown-Docs) | 10.826 LOC / 57 Dateien / 3.9 MB |
| Git-tracked Dateien gesamt | 364 |
| `node_modules` | 477 MB |
| Größte Dependency: `monaco-editor` | 95 MB |
| Größte Dependency (Runtime): `lucide-react` | 32 MB |
| Server Services | 5.874 LOC / 18 Dateien |
| Größte Datei: `sandbox-runner.ts` | 1.633 LOC |

---

## 1. The Kill-List

### 1.1 Tote Dateien (sofort löschbar)

| Datei | LOC | Grund |
|-------|-----|-------|
| `client/src/components/debug-console.tsx` | 0 | Leere Datei (0 Bytes) |
| `client/src/hooks/use-file-management.ts` | 207 | Nirgends importiert — Dead Code |
| `drizzle.config.ts` | 14 | Drizzle-ORM ist nicht installiert; `db:push` Script würde fehlschlagen |
| `server/services/simulation-end.ts` | 5 | Einzeiler-Predicate, kann inline in `simulation.ws.ts` |
| `scripts/check-raw-hex.js` | ~53 | Duplikat von `check-raw-hex.cjs` (das `.cjs` ist referenziert) |
| `scripts/bench-sandbox.js` | 173 | Duplikat — `.ts`-Version existiert ebenfalls |
| `scripts/image-diff.js` | 53 | Duplikat von `image-diff.cjs` |

**Sofort eliminierbar: ~505 LOC + 3 Duplikat-Scripts**

### 1.2 Unbenutzte Scripts (Cleanup-Kandidaten)

15 von 17 Dateien in `scripts/` sind weder in `package.json` noch in CI referenziert:

| Script | Kontext |
|--------|---------|
| `bench-sandbox.ts` | Benchmark, gitignored |
| `debug-runner.ts` | Debugging-Helper |
| `find-diffs.cjs` | Diff-Utility |
| `frontend-source-analysis.sh` | Shell-Analyse |
| `image-diff.cjs` | Screenshot-Vergleich |
| `image-stats.cjs` | Bild-Statistik |
| `inspect-css.cjs` | CSS-Inspektion |
| `loc-report.sh` | LOC-Report |
| `logger-stub.js` | Logger-Stub |
| `mini-bench.js` | Mini-Benchmark |
| `simple-load-test.mjs` | Vereinfachter Load-Test |
| `source-stats.sh` | Source-Statistiken |
| `cleanup-build-cache.ts` | Cache-Bereinigung |

**Empfehlung:** Alle in `archive/scripts/` verschieben. Nur `check-raw-hex.cjs` behalten.

### 1.3 Tote npm-Dependencies

| Package | `node_modules`-Größe | Grund |
|---------|---------------------|-------|
| `@radix-ui/react-collapsible` | ~200 KB | **Null Imports** — nirgendwo im Source verwendet |
| `@radix-ui/react-hover-card` | ~200 KB | **Null Imports** — nirgendwo im Source verwendet |
| `@radix-ui/react-popover` | ~200 KB | **Null Imports** — keine UI-Komponente nutzt Popover |
| `@radix-ui/react-label` | ~150 KB | **Null Imports** — kein `<Label>`-Wrapper existiert |

**Sicher deinstallierbar:** 4 Radix-Pakete (~750 KB), minimal.

### 1.4 Schwere Dependencies — Optimierungspotenzial

| Package | Größe | Nutzung | Alternative |
|---------|-------|---------|-------------|
| `monaco-editor` | **95 MB** | Code-Editor (core feature) | Nicht ersetzbar, aber: **dynamischer Import** + Code-Splitting (nur Editor-Chunk laden wenn Tab sichtbar). Aktuell im Main-Bundle. |
| `lucide-react` | **32 MB** | Icon-Library | Tree-shaking aktiv via Vite, aber `node_modules` sind groß. Kein Action nötig (Build-Output ist OK). |
| `recharts` | **5.2 MB** | Nur `serial-plotter.tsx` (1 Datei) | **Lazy-Load** via `React.lazy()` — Plotter ist selten genutzt. Spart ~150 KB im Initial-Bundle. |
| `@tanstack/react-query` | **4.3 MB** | 5 `useMutation`-Calls, 0 `useQuery` | **Eliminierbar** — die 5 Mutations sind simple `fetch()`-Wrapper. Eigene ~50 LOC `useMutation`-Utility reicht. Spart ~80 KB Bundle + 4.3 MB `node_modules`. |
| `zod` | **5.0 MB** | Schema in `shared/schema.ts` | Schema wird runtime **nicht validiert** (`JSON.parse` statt `schema.parse`). Nur als TypeScript-Type-Inference genutzt. Könnte durch reine TS-Interfaces ersetzt werden — aber Zod hat tree-shaking, also minimal im Bundle. Niedrige Priorität. |
| `wouter` | ~50 KB | Router in `App.tsx` — **1 Route** | Für eine Single-Page-App mit genau einer Route: ersetzen durch 10 LOC eigenen Code. Marginal. |

### 1.5 Archiv & Projekt-Hygiene

| Verzeichnis | Größe | Status | Empfehlung |
|-------------|-------|--------|------------|
| `archive/` | 3.9 MB / 57 Dateien | Git-tracked | In separates Repo/Wiki verschieben. 10.826 LOC Markdown belasten IDE-Indexierung und Git-Operationen. |
| `archive/misc-20260121/` | 3.0 MB | Screenshots + Test-Results | **Sofort löschen** — Build-Artefakte |
| `archive/typography/` + `typography2/` | 120 KB | Font-Experimente | Archivieren oder löschen |
| `screenshots/` | 1.1 MB / 3 PNGs | Git-tracked | In README verlinken via URL oder in `archive/` |
| `coverage/` | 6.7 MB | Gitignored, aber lokal | OK (gitignored) |
| `IMPLEMENTATION_STATUS.md` | Root-Level | Veraltet? | Prüfen & ggf. in `archive/` |
| `TODO.md` | Root-Level | Veraltet? | Prüfen & ggf. in `archive/` |
| `licenses.json` | 257 KB | NPM-Lizenzliste | Generierte Datei — sollte `.gitignore`d und bei Bedarf neu erzeugt werden |

**Potenzielle Ersparnis:** ~8 MB Git-Repository-Größe, weniger IDE-Indexierung.

### 1.6 Test-Duplikation

| Dateien | LOC gesamt | Duplikation |
|---------|------------|-------------|
| `load-test-50-clients.test.ts` | 469 | ~90% identisch |
| `load-test-100-clients.test.ts` | 452 | ~90% identisch |
| `load-test-200-clients.test.ts` | 455 | ~90% identisch |
| `load-test-500-clients.test.ts` | 431 | ~90% identisch |

**Lösung:** Ein parametrisierter Test mit `describe.each` → ~500 LOC statt 1.807 LOC (**−1.307 LOC**).

---

## 2. Compiler-Parallelisierungsanalyse

### 2.1 Ist-Zustand: Kompilier-Pfade

UnoSim hat **zwei getrennte Kompilier-Pipelines**, die nie Ergebnisse teilen:

```
Pipeline A: "Native Simulation" (SandboxRunner → LocalCompiler → g++)
  Zweck: x86-Binary zur lokalen Ausführung
  Gatekeeper: Inline-Semaphore in sandbox-runner.ts (MAX_CONCURRENT = 8)
  Cache: sim-native-core.a (einmalig g++ + ar)

Pipeline B: "Arduino CLI" (PooledCompiler → ArduinoCompiler → arduino-cli)
  Zweck: .hex für echte Arduino-Boards (API-Endpoint /api/compile)
  Gatekeeper: compile-gatekeeper.ts (MAX_CONCURRENT = 4)
  Cache: 3-Tier (binary-storage → hex-cache → build-cache)
  Worker: CompilationWorkerPool (2–4 Threads, nur Production)
```

### 2.2 Blockierungspunkte

| Stelle | Blockierungstyp | Dauer | Impact |
|--------|----------------|-------|--------|
| `sandbox-runner.ts:351–365` | 3× `execSync` Docker-Check | **bis 6s** | Blockiert Event-Loop komplett beim ersten Run |
| `local-compiler.ts:286` | `execSync("ls -R ...")` | ~100ms | Diagnostik in Produktion — **muss entfernt werden** |
| `local-compiler.ts:215–218` | `statSync` CLI-Cache-Check | ~1ms | Minimal, aber sync |
| `local-compiler.ts:346–348` | `mkdirSync` | ~1ms | Sollte async sein |
| `arduino-compiler.ts:223` | `mkdtempSync` | ~2ms | Sollte async `mkdtemp` verwenden |
| `sandbox-runner.ts:1346–1353` | `renameSync` + `rmSync` in Cleanup | ~10–50ms | Blockiert in Cleanup-Phase |
| `compile-worker.ts:264` | `mkdirSync` bei **jedem** Request | ~1ms | Redundant — Worker-Dir existiert bereits nach erstem Run |
| `registry-manager.ts:292` | `appendFileSync` Telemetrie | ~5ms/s | Blockiert Event-Loop jede Sekunde |
| `simulation.ws.ts:247–249` | `existsSync` + `writeFileSync` Registry | ~5ms | Blockiert bei jedem Registry-Update |

### 2.3 Filesystem-Abhängigkeiten, die Parallelisierung verhindern

```
Sequentielle Kette pro Simulation:
  1. mkdir temp/{uuid}/           ← Sketch-Dir
  2. writeFile sketch.cpp         ← SketchFileBuilder (mock + user code)
  3. [optional] arduino-cli       ← core.a Extraktion (einmalig)
  4. g++ sketch.cpp → binary     ← Eigentliche Kompilierung
  5. spawn(binary)                ← Ausführung
  
Schritte 1–2 sind I/O-bound
Schritt 3 ist CPU-bound (einmalig cachebar)
Schritt 4 ist CPU-bound (nicht cachebar — Code ändert sich)
Schritt 5 ist I/O-bound
```

**Problem:** Schritte 1–4 sind strikt sequentiell wegen Filesystem-Abhängigkeit (Schritt 4 liest die Datei aus Schritt 2). Parallelisierung zwischen Clients ist möglich (und durch den Gatekeeper limitiert), aber die Kette pro Build ist nicht parallelisierbar.

### 2.4 Doppelter Gatekeeper-Engpass

Ein Request von `SandboxRunner.performCompilation()` muss **zwei** unabhängige Semaphores passieren:

1. **Inline-Gatekeeper** in `sandbox-runner.ts` (MAX_CONCURRENT = 8)
2. **Standalone-Gatekeeper** in `compile-gatekeeper.ts` (MAX_CONCURRENT = 4)

Effektives Limit: `min(8, 4) = 4`. Der Inline-Gatekeeper ist **nutzlos** und fügt nur Overhead hinzu.

### 2.5 Worker erstellt Compiler-Instanz pro Request

`compile-worker.ts:264` erstellt bei **jedem** eingehenden Message einen `new ArduinoCompiler()`. Das löst erneut `ensureTempDir()` mit redundanten `mkdir`-Calls aus. Eine wiederverwendbare Instanz würde ~2ms pro Request sparen.

---

## 3. I/O & Stream-Audit

### 3.1 Der Serial-Daten-Pfad: 11 Kopien für 6 Bytes

```
"Hello\n" (6 Bytes Nutzlast) durchläuft:

 C++ Mock:
  ① base64_encode("Hello\n")          → "SGVsbG8K" (8 Bytes, +33%)
  ② std::cerr << "[[SERIAL_EVENT:...]]"

 Node.js ProcessController:
  ③ stderr Buffer → .toString()       → String-Kopie
  ④ errorBuffer += str                → String-Concat (O(n) bei Akkumulation)
  ⑤ split(/\r?\n/)                    → Array + N String-Kopien

 ArduinoOutputParser:
  ⑥ Buffer.from(base64, "base64")     → Buffer-Allokation
  ⑦ buf.toString("utf8")              → String-Kopie

 SerialOutputBatcher:
  ⑧ pendingData = pendingData + data  → String-Concat (O(n²) bei Akkumulation!)
  ⑨ pendingData.slice(0, budget)      → String-Kopie (alle 50ms)
  ⑩ pendingData.slice(budget)         → String-Kopie (alle 50ms)

 WebSocket:
  ⑪ JSON.stringify({type, data})      → Serialisierung
  ⑫ perMessageDeflate                 → Komprimierung
```

**11–12 Allokationen/Kopien** für eine simple Serial-Zeile. Bei 2.000 Zeilen/Sekunde entsteht massiver GC-Druck.

### 3.2 Kritischste Ineffizienz: String-Akkumulation im SerialOutputBatcher

```typescript
// serial-output-batcher.ts:136 — O(n²) Pattern!
this.pendingData = this.pendingData + data;  // jedes enqueue kopiert ALLES
```

Bei hoher Serial-Last (z.B. `Serial.println()` in engem Loop) wächst `pendingData` auf bis zu 100KB (`MAX_QUEUE_BYTES`). Jede `enqueue()`-Operation kopiert den gesamten bestehenden String (~10–100KB) + neuen Chunk. Bei 2.000 Calls/s sind das **100–200 MB/s String-Kopien nur im Batcher**.

### 3.3 Sync-I/O im Hot-Path

| Datei | Zeile | Operation | Frequenz | Fix |
|-------|-------|-----------|----------|-----|
| `registry-manager.ts` | L292 | `appendFileSync()` Telemetrie | 1×/s | → `fs.createWriteStream()` |
| `simulation.ws.ts` | L247–249 | `existsSync` + `writeFileSync` Registry | Pro Registry-Update | → `fs.promises.writeFile()` |
| `routes.ts` | L96–100 | `readdirSync` + `statSync` für Examples | Pro API-Call | → Cache bei Server-Start |
| `index.ts` | L21–43 | Cleanup mit `readdirSync/statSync/rmSync` | Alle 60s | → `fs.promises.*` |
| `sandbox-runner.ts` | L351–365 | `execSync("docker ...")` 3× | Einmal pro Instanz | → `execFile` async |
| `local-compiler.ts` | L286 | `execSync("ls -R ...")` | Während Kompilierung | → **Entfernen** (nur Diagnostik) |

### 3.4 Unnötige JSON-Serialisierungen

| Stelle | Was | Frequenz | Fix |
|--------|-----|----------|-----|
| `registry-manager.ts:610` | `JSON.stringify(normalized)` für Hash | Pro Pin-State-Change | → `crypto.createHash` mit inkrementellem Update |
| `simulation.ws.ts:199` | `JSON.stringify(opts, null, 2)` Audit-Log | Pro Simulation-Start | → Conditional auf LOG_LEVEL oder entfernen |
| `index.ts:128` | `JSON.stringify(response)` + truncate auf 80 chars | Pro API-Response | → Conditional auf LOG_LEVEL |
| `simulation.ws.ts:97` | `console.info("[WS-IN]...")` | **Jede WS-Message** | → Entfernen in Production |

### 3.5 Redundante Datenkopien in RegistryManager

```typescript
// registry-manager.ts — Triple-Allokation pro Hash-Berechnung:
computeRegistryHash() {
  const normalized = this.registry
    .map(pin => ({ ...pin }))      // Kopie 1: Objekt-Spread pro Pin
    .sort(...)                      // Kopie 2: Sortiertes Array
  return JSON.stringify(normalized) // Kopie 3: String-Serialisierung
}
```

Bei 20 Pins und häufigen Updates (20×/s durch PinStateBatcher): **60 Objekt-Allokationen + 1 JSON.stringify pro Sekunde** nur für Hashing.

---

## 4. Redundanz-Check

### 4.1 Doppelter Code

| Redundanz | Stellen | LOC-Overlap |
|-----------|---------|-------------|
| **CompileGatekeeper (2×)** | `sandbox-runner.ts:35–65` (inline) + `compile-gatekeeper.ts` (standalone) | ~30 LOC. Zwei unabhängige Semaphores für dieselbe Ressource. |
| **setup()/loop()-Validierung (2×)** | `arduino-compiler.ts:265–278` + `sketch-file-builder.ts:46–47` | ~15 LOC. Gleiche Regex in zwei Dateien. |
| **Compiler-Error-Bereinigung (3×)** | `sandbox-runner.ts:1237` + `arduino-compiler.ts:667` + `local-compiler.ts:400` | ~30 LOC. Gleiche Pfad-Cleaning-Logik. |
| **Binary-Cache-Schreiben (2×)** | `arduino-compiler.ts` (hex-cache + binary-storage) + `compile-worker.ts` (parallel touch) | Doppelter Disk-Write pro erfolgreicher Kompilierung. |
| **Lock-Mechanismus (2×)** | `compile-gatekeeper.ts` (`mkdir`-Lock) + `compile-worker.ts` (`open("wx")`-Lock) | Zwei verschiedene Implementierungen desselben Konzepts. |
| **Load-Tests (4×)** | 4 nahezu identische Dateien | 1.307 LOC Redundanz |
| **Baudrate-Erkennung (2×)** | `shared/code-parser.ts:65` + `sandbox-runner.ts:563` | ~5 LOC. Gleiche Regex. |

**Gesamt redundanter Code: ~1.400 LOC** (davon 1.307 in Tests).

### 4.2 Tote Infrastruktur

| Element | Grund |
|---------|-------|
| Drizzle-Config (`drizzle.config.ts` + `db:push` Script) | Drizzle ist nicht installiert |
| Zod-Schemas (`shared/schema.ts`) | Runtime-WS-Validierung nutzt `JSON.parse`, nicht `schema.parse()` |
| In-Memory-Storage (`server/storage.ts`) als `Map` | Kein Persistenz-Layer — alles verloren bei Restart |

---

## 5. Concurrency Blueprint: Zustandsloser Parallel-Build

### 5.1 Architektur-Plan

```
AKTUELL:  Sequentiell mit doppeltem Gatekeeper
───────────────────────────────────────────────
Client → SandboxRunner.runSketch()
           ├── [Inline-Gatekeeper 8]
           ├── mkdir + writeFile (sync-ish)
           ├── g++ compile (20s timeout)
           └── spawn binary
           
ZIEL:     Stateless Pipeline mit Worker-Pool
───────────────────────────────────────────────
Client → SimulationOrchestrator
           ├── [Single Gatekeeper: max(2, floor(cpus * 0.5))]
           │
           ├── PreparePhase (async, non-blocking):
           │   └── Promise.all([
           │         ensureNativeCore(),    // Cache-Hit: 0ms
           │         buildSketchFile(code)  // In-Memory statt Disk
           │       ])
           │
           ├── CompilePhase (Worker-Thread):
           │   └── Worker receives: { code: string, coreArchivePath: string }
           │       Worker writes tempfile + g++ → binary path
           │       Worker returns: { binaryPath: string, compileTimeMs: number }
           │
           └── RunPhase (child_process.spawn):
               └── ProcessController(binaryPath) → Stream pipeline
```

### 5.2 Kernänderungen

**A. Inline-Gatekeeper eliminieren** — nur einen `CompileGatekeeper` behalten (der Standalone)

**B. SketchFileBuilder: In-Memory statt Disk** für die Vorbereitung:
```typescript
// AKTUELL: 
buildSketchFile() → writeFile("temp/{uuid}/sketch.cpp")
g++ temp/{uuid}/sketch.cpp → temp/{uuid}/sketch

// ZIEL (Option 1 — g++ von stdin):
buildSketchString() → string
echo "$SKETCH" | g++ -x c++ - -o temp/{uuid}/sketch  // g++ kann von stdin lesen

// ZIEL (Option 2 — tmpfile nur für g++):
buildSketchString() → string
writeFile( os.tmpdir() + "/sketch.cpp" )  // OS-level tmpfs, nicht im Projektordner
```

**C. ProcessController: `readline`-Interface statt manuelles Buffering**
```typescript
// AKTUELL: 
child.stderr.on('data', (chunk) => {
  errorBuffer += chunk.toString();   // O(n²) concat
  const lines = errorBuffer.split(/\r?\n/);
  ...
});

// ZIEL:
import { createInterface } from 'readline';
const rl = createInterface({ input: child.stderr });
rl.on('line', (line) => parser.parseStderrLine(line));  // Zero-copy line splitting
```

**D. Docker-Check async machen**
```typescript
// AKTUELL: 3× execSync (bis 6s blocking)
execSync("docker --version", { timeout: 2000 });

// ZIEL: 
const { execFile } = await import("child_process");
await Promise.all([
  execFileAsync("docker", ["--version"], { timeout: 2000 }),
  execFileAsync("docker", ["info"], { timeout: 2000 }),
]);
// Image-Check nur wenn Docker verfügbar
```

---

## 6. Stream-Mapping

### 6.1 Serial-Daten-Pipeline: Von 11 Kopien auf 4

```
AKTUELL: stderr → Buffer.toString → concat → split → base64Decode → concat → slice → JSON.stringify
         (11–12 Allokationen)

ZIEL:    stderr → readline → base64Decode → ringBuffer → JSON.stringify
         (4 Allokationen)
```

| Schritt | Aktuell | Ziel | Ersparnis |
|---------|---------|------|-----------|
| stderr-Buffering | `errorBuffer += chunk` (O(n²)) | `readline.createInterface()` | Eliminiert concat + split |
| base64-Decode | `Buffer.from()` + `.toString()` | `atob()` (V8-native) oder TextDecoder | −1 Buffer-Allokation |
| SerialBatcher | `pendingData = pendingData + data` + `slice` | `string[]`-Ring-Buffer + Index-Swap | Eliminiert O(n²)-Concat |
| Registry-Hash | `map + sort + JSON.stringify` | Inkrementeller Hash via `crypto.createHash` | −3 Allokationen |

### 6.2 Konkrete Umbauten

**A. SerialOutputBatcher: Ring-Buffer statt String-Concat**
```typescript
// AKTUELL:
pendingData = pendingData + data;           // O(n) Kopie bei jedem enqueue
dataToSend = pendingData.slice(0, budget);  // O(n) Kopie bei jedem tick

// ZIEL:
private chunks: string[] = [];
private totalBytes = 0;

enqueue(data: string) {
  this.chunks.push(data);        // O(1) amortized
  this.totalBytes += data.length;
}

tick() {
  const batch = this.chunks.splice(0, budgetChunks);  // Move, nicht Copy
  const joined = batch.join('');  // Ein einziger concat
  this.totalBytes -= joined.length;
}
```

**B. Registry-Telemetrie: WriteStream statt appendFileSync**
```typescript
// AKTUELL (blockiert Event-Loop):
appendFileSync(debugPath, debugLine);

// ZIEL:
private debugStream: fs.WriteStream | null = null;

writeTelemetry(line: string) {
  if (!this.debugStream) {
    this.debugStream = fs.createWriteStream(debugPath, { flags: 'a' });
  }
  this.debugStream.write(line);  // Non-blocking, kernel-buffered
}
```

**C. Examples-API: Cache statt Sync-ReadDir**
```typescript
// AKTUELL (blockiert pro Request):
function readExamplesRecursive(dir) {
  const files = fs.readdirSync(dir);
  ...
}

// ZIEL (einmal beim Start):
let cachedExamples: ExampleTree | null = null;

async function getExamples(): Promise<ExampleTree> {
  if (cachedExamples) return cachedExamples;
  cachedExamples = await readExamplesAsync(examplesDir);
  return cachedExamples;
}
```

---

## 7. Performance-Forecast

### 7.1 Zeitersparnis pro Build-Zyklus

| Phase | Aktuell (geschätzt) | Nach Optimierung | Δ |
|-------|-------------------|------------------|---|
| **Docker-Check** (First Run) | 2–6s (blocking!) | 200–600ms (async, parallel) | **−5.4s** (Event-Loop frei) |
| **Docker-Check** (Folge-Runs) | 0ms (cached) | 0ms | 0 |
| **mkdir + writeFile** (Sketch) | 5–15ms | 3–5ms (tmpfs/OS-tmpdir) | −10ms |
| **g++ Compile** (Cache Miss) | 1–5s | 1–5s (nicht optimierbar) | 0 |
| **g++ Compile** (Cache Hit) | 0ms | 0ms | 0 |
| **Gatekeeper-Overhead** | ~2ms (doppelt) | ~1ms (einfach) | −1ms |
| **Serial-Batcher Tick** | 50ms base + GC-Pauses | 50ms base − GC | −5–20ms GC |

### 7.2 Durchsatz-Verbesserung

| Metrik | Aktuell | Nach Optimierung | Faktor |
|--------|---------|------------------|--------|
| Event-Loop-Blocking pro Simulation-Start | ~6s (Docker-Check) + ~5ms (Sync-I/O) | 0ms | **∞** (non-blocking) |
| Serial-Throughput (Allokationen/s) | ~22.000 (bei 2K lines/s × 11 copies) | ~8.000 (bei 2K lines/s × 4 copies) | **2.7×** |
| Max. Concurrent Compiles | 4 (min von zwei Gatekeepern) | 4 (explizit konfiguriert) | 1× (gleich, aber sauberer) |
| GC-Pressure (String-Churn) | ~200 MB/s bei Serial-Hochlast | ~40 MB/s durch Ring-Buffer | **5×** weniger |
| Registry-Hash Overhead | 60 Objekte + JSON.stringify/s | 1 Hash-Update/s | **60×** weniger |

### 7.3 Latenz Code-Eingabe → Simulation

```
AKTUELL (Worst Case, Cold Start):
  Upload (WS) ────── 10ms
  Docker-Check ───── 6.000ms (BLOCKING!)
  mkdir + writeFile ─ 15ms
  g++ compile ────── 3.000ms
  spawn binary ───── 50ms
  First output ───── 50ms (Batcher-Tick)
  ─────────────────────────
  TOTAL: ~9.125ms

NACH OPTIMIERUNG (Cold Start):  
  Upload (WS) ────── 10ms
  Docker-Check ───── 600ms (async, parallel, non-blocking)
  tmpfile + writeFile 5ms
  g++ compile ────── 3.000ms (unveränderlich)
  spawn binary ───── 50ms
  First output ───── 50ms
  ─────────────────────────
  TOTAL: ~3.715ms  (−59%)

NACH OPTIMIERUNG (Warm, Docker cached):
  Upload (WS) ────── 10ms
  Setup ──────────── 5ms
  g++ compile ────── 2.000ms (warm build-cache)
  spawn + output ─── 100ms
  ─────────────────────────
  TOTAL: ~2.115ms
```

---

## 8. Sprint-Plan

### Sprint 1: Cleanup & Low-Hanging Fruit (1–2 Tage)

**Ziel:** Toten Code eliminieren, Sync-Blocker entfernen, Projekt entschlacken.

| # | Task | Impact | Risiko |
|---|------|--------|--------|
| 1.1 | Tote Dateien löschen (debug-console.tsx, use-file-management.ts, drizzle.config.ts, simulation-end.ts inline, Duplikat-Scripts) | −505 LOC | 🟢 Kein |
| 1.2 | 4 unbenutzte Radix-Pakete deinstallieren (`npm uninstall @radix-ui/react-{collapsible,hover-card,popover,label}`) | −750 KB node_modules | 🟢 Kein |
| 1.3 | `db:push` Script aus `package.json` entfernen | Cleanup | 🟢 Kein |
| 1.4 | `execSync("ls -R")` in `local-compiler.ts:286` entfernen (Diagnostik) | Entblockiert Compile-Path | 🟢 Kein |
| 1.5 | `appendFileSync` in `registry-manager.ts` → `fs.createWriteStream` | Entblockiert Event-Loop | 🟢 Niedrig |
| 1.6 | `writeFileSync` in `simulation.ws.ts` → `fs.promises.writeFile` | Entblockiert Event-Loop | 🟢 Niedrig |
| 1.7 | `readdirSync`/`statSync` in `routes.ts` → gecachte Startup-Funktion | Entblockiert Examples-API | 🟢 Niedrig |
| 1.8 | Sync-Cleanup in `index.ts` → `fs.promises.*` | Entblockiert Cleanup-Timer | 🟢 Niedrig |
| 1.9 | `console.info("[WS-IN]")` in `simulation.ws.ts` → Conditional auf LOG_LEVEL | Weniger Log-Churn | 🟢 Kein |
| 1.10 | `archive/misc-20260121/` löschen (3 MB Build-Artefakte) | Git-Hygiene | 🟢 Kein |
| 1.11 | Verbleibende Scripts → `archive/scripts/` verschieben | Ordnung | 🟢 Kein |
| 1.12 | Load-Tests parametrisieren (4 Dateien → 1) | −1.307 LOC | 🟡 Mittel |

**Erwartete Ergebnisse Sprint 1:**
- ~1.800 LOC eliminiert
- 0 sync-blockierende Calls im Hot-Path
- Saubere Projektstruktur

### Sprint 2: Parallelisierung & Gatekeeper-Fix (2–3 Tage)

**Ziel:** Event-Loop entblockieren, Compile-Pipeline optimieren.

| # | Task | Impact | Risiko |
|---|------|--------|--------|
| 2.1 | Inline-CompileGatekeeper aus `sandbox-runner.ts` entfernen → standalone nutzen | −30 LOC, kein doppelter Semaphore | 🟡 Mittel |
| 2.2 | Docker-Check async: `execSync` → `execFile` (promisified) + `Promise.all` | −6s Event-Loop-Blocking (Cold) | 🟡 Mittel |
| 2.3 | `compile-worker.ts`: ArduinoCompiler-Instanz wiederverwenden statt `new` pro Request | −2ms/Request, weniger GC | 🟢 Niedrig |
| 2.4 | stderr-Parsing: manuelles Buffer-Concat → `readline.createInterface` | Eliminiert O(n²)-Concat + split | 🟡 Mittel |
| 2.5 | Redundanzbereinigung: setup()/loop()-Validierung, Error-Cleaning, Baudrate-Regex → shared Utils | −45 LOC | 🟢 Niedrig |
| 2.6 | `SketchFileBuilder`: Temp-Dir in `os.tmpdir()` statt Projektverzeichnis | Nutzt OS-tmpfs (RAM-backed auf Linux) | 🟢 Niedrig |

**Erwartete Ergebnisse Sprint 2:**
- Event-Loop nie mehr >50ms blockiert
- Cold-Start-Latenz von ~9s auf ~3.7s
- Saubere Compile-Pipeline ohne Redundanz

### Sprint 3: I/O-Tuning & Stream-Optimization (2–3 Tage)

**Ziel:** Serial-Durchsatz maximieren, GC-Pressure minimieren.

| # | Task | Impact | Risiko |
|---|------|--------|--------|
| 3.1 | SerialOutputBatcher: String-Concat → `string[]` Ring-Buffer | −80% String-Allokationen | 🟡 Mittel |
| 3.2 | PinStateBatcher: String-Keys → numerische Keys | −2.000 String-Alloks/s | 🟢 Niedrig |
| 3.3 | ArduinoOutputParser: `Buffer.from(base64)` → `atob()` | −1 Buffer-Allok pro Serial-Event | 🟢 Niedrig |
| 3.4 | RegistryManager: `JSON.stringify`-Hash → `crypto.createHash` inkrementell | −60 Objekt-Alloks/s | 🟢 Niedrig |
| 3.5 | `recharts` lazy-loaden via `React.lazy()` in `serial-plotter.tsx` | −150 KB Initial-Bundle | 🟢 Niedrig |
| 3.6 | `@tanstack/react-query` evaluieren: Replace mit eigenem ~50 LOC `useMutation`-Hook | −80 KB Bundle, −4.3 MB node_modules | 🟡 Mittel |
| 3.7 | WebSocket `perMessageDeflate`: `clientNoContextTakeover: false` testen | Bessere Kompression bei repeating patterns | 🟢 Kein |

**Erwartete Ergebnisse Sprint 3:**
- Serial-Throughput 2.7× besser
- GC-Pressure 5× reduziert
- Initial-Bundle ~230 KB kleiner


---

## 9. Zusammenfassung: Vorher → Nachher

| Metrik | Ist | Ziel (nach 3 Sprints) | Δ |
|--------|-----|----------------------|---|
| Source-LOC | 23.595 | ~21.800 | −1.795 |
| Test-LOC | 25.541 | ~24.200 | −1.307 |
| Archiv im Repo | 3.9 MB / 57 Dateien | 0 (ausgelagert) | −3.9 MB |
| Sync-Blocking-Calls im Server | **14 Stellen** | **0** | −14 |
| Event-Loop-Block (max) | 6.000ms | ~50ms | **120×** besser |
| Cold-Start-Latenz (Code→Simulation) | ~9.1s | ~3.7s | **−59%** |
| Warm-Latenz (Code→Simulation) | ~3.1s | ~2.1s | **−32%** |
| Serial-Allokationen pro Event | 11 | 4 | **2.7×** weniger |
| String-Churn bei 2K lines/s | ~200 MB/s | ~40 MB/s | **5×** weniger |
| Doppelter Gatekeeper | Ja | Nein | ✅ |
| Compile-Gatekeeper-Overhead | 2 Semaphores | 1 Semaphore | ✅ |
| node_modules (grob) | 477 MB | ~468 MB | −9 MB |
| Initial-Bundle-Size (geschätzt) | ~1.8 MB | ~1.5 MB | −300 KB |
| npm-Dependencies (prod) | 29 | 24 | −5 |

---

## Appendix A: Vollständige Sync-Blocker-Liste

| # | Datei | Zeile | Call | Kontext |
|---|-------|-------|------|---------|
| 1 | `sandbox-runner.ts` | 351 | `execSync("docker --version")` | Docker-Verfügbarkeit |
| 2 | `sandbox-runner.ts` | 354 | `execSync("docker info")` | Docker-Daemon |
| 3 | `sandbox-runner.ts` | 361 | `execSync("docker image inspect")` | Image-Check |
| 4 | `sandbox-runner.ts` | 1291 | `renameSync()` | Registry-Cleanup |
| 5 | `sandbox-runner.ts` | 1348 | `renameSync()` | Dir-Cleanup |
| 6 | `sandbox-runner.ts` | 1353 | `rmSync()` | Dir-Removal |
| 7 | `local-compiler.ts` | 286 | `execSync("ls -R")` | Diagnostik |
| 8 | `local-compiler.ts` | 346–348 | `mkdirSync()` | Output-Dir |
| 9 | `arduino-compiler.ts` | 85 | `renameSync()` | Trash-Rename |
| 10 | `arduino-compiler.ts` | 223 | `mkdtempSync()` | Temp-Dir |
| 11 | `registry-manager.ts` | 292 | `appendFileSync()` | Telemetrie |
| 12 | `simulation.ws.ts` | 247–249 | `existsSync` + `writeFileSync` | Registry |
| 13 | `routes.ts` | 96–100 | `readdirSync` + `statSync` | Examples |
| 14 | `index.ts` | 21–43 | `readdirSync/statSync/unlinkSync/rmSync` | Cleanup |

## Appendix B: Bezug zum Audit v2 (20.02.2026)

Dieser Performance-Audit ergänzt den Architektur-Audit v2 um die Performance-Dimension. Die Roadmap-Schritte sind kompatibel:

| Audit v2 Schritt | Performance-Audit Bezug |
|-------------------|------------------------|
| A1–A4 (Frontend-Extraktionen) | Unverändert gültig. Sprint 3 (recharts lazy-load) ist additiv. |
| A5 (Hook-Merger) | Unverändert gültig. Kein Performance-Impact. |
| B1 (RunSketchOptions) | → Sprint 2.1 (Gatekeeper-Fix) sollte **vor** B1 passieren. |
| B2 (Handler-Unifikation) | → Sprint 2 integrierbar. |
| B3 (ProcessManager) | → Sprint 2.4 (readline) gehört dazu. |
| B4 (CleanupManager) | → Sprint 1.8 (async Cleanup) ist die Vorbereitung. |
| D1 (Load-Tests) | → Sprint 1.12 (identisch). |

**Reihenfolge-Empfehlung:** Performance-Sprint 1 → Audit-v2 Phase A → Performance-Sprint 2 → Audit-v2 Phase B → Performance-Sprint 3.
