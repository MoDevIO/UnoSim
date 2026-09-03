
# Skalierbarkeit: Ist-Zustand und zukünftige Kapazitätsziele

> **Stand 3. September 2026:** Dieses Dokument trennt gemessene bzw.
> konfigurationsabhängige Grenzen vom Zielbild. Der verbindliche Betrieb ist
> heute ein einzelner zustandsbehafteter Backend-Knoten; die Abschnitte zu 100
> bzw. 200 Clients sind Planungs- und Messszenarien, keine zugesicherte
> Produktionskapazität.

## 1. Wie genau kommt es zur Beschränkung auf 29 Instanzen?
Die Beschränkung ergibt sich aus einer Kette von drei Engpässen, wobei der erste der unmittelbar limitierende ist:

### Engpass A: Docker Desktop Arbeitsspeicher (PRIMÄR)

```text
Docker Desktop Memory:     7.653 GB (7.840 MB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bereits belegt:
  unosim-server:             369 MB
  SonarQube:               2.071 MB
  sonar-db:                   99 MB
  lucid_mcnulty:             253 MB
                           ─────────
  Summe Host-Container:    ~2.792 MB

Verfügbar für Sandboxen:   ~4.860 MB
Pro Sandbox (--memory):      256 MB
→ Max Sandboxen:          4860/256 = ~19
```

Aber `--memory 256m` ist ein cgroup-Ceiling, keine Reservierung. Ein typischer AVR-Sketch braucht real nur 5–30 MB. Docker schlägt erst zu, wenn ein Container die 256 MB tatsächlich erreicht. Deshalb kommen ~29 Container durch, obwohl die theoretische Summe (29×256 = 7.424 MB) die Gesamtkapazität übersteigt — die reale Nutzung liegt bei ca. 29×20 = 580 MB.

Der 30. Container scheitert, wenn Docker Desktop nicht mehr genug physischen Speicher zuweisen kann (OOM-Kill oder Container-Start-Fehler).

### Engpass B: Pool-Hardlimit (`docker-compose.yml:20`)

```text
SANDBOX_POOL_MAX_RUNNERS=30     # ← Hardlimit
```

In `sandbox-runner-pool.ts:99-140`:

- Start: 5 Warm-Runner → Clients 1–5 sofort bedient
- Clients 6–30: On-Demand-Erstellung bis `maxRunners=30`
- Client 31+: Queue mit 60s Timeout → `"SandboxRunnerPool: acquire timeout"`

Warum genau 29 und nicht 30? Ein Runner kann im Zustand `resetting: true` sein (10s Reset-Timeout nach `runner.stop()`). Dieser zählt zum Pool (`this.runners.length`), ist aber weder verfügbar noch kann ein neuer erstellt werden. Bei schnellem Connect/Disconnect eines früheren Clients ist effektiv 1 Slot blockiert.

### Engpass C: Browser-Connection-Multiplexing (SEKUNDÄR)
Chrome erlaubt 6 gleichzeitige HTTP/1.1-Verbindungen pro Origin. Alle 30+ Iframes teilen sich dieses Limit für `localhost:3000`:

| Quelle | Frequenz | Bei 30 Clients |
|--------|----------|---------------|
| `/api/health` Polling | 1/sec pro Client | 30 req/sec |
| `/api/status` Polling | 1/3sec pro Client | 10 req/sec |
| WebSocket Upgrade | einmalig | 30 Upgrades über 0–3s (Stagger) |
| Summe HTTP |  | ~40 req/sec durch 6 Slots |

Die WebSocket-Upgrades selbst dauern <10ms und blockieren den Slot nur kurz. Aber unter Last können Upgrade-Requests hinter Health-Check-Requests in der Schlange stehen und das 10s `CONNECTION_TIMEOUT_MS` erreichen.

### Zusammenfassung der Limitierungskette

```text
Browser (40 HTTP req/sec durch 6 Slots)
  └─ WebSocket Upgrade (kann unter Last timeout'en)
      └─ Server: pool.acquireRunner()
          └─ SANDBOX_POOL_MAX_RUNNERS = 30
              └─ Docker Container Start
                  └─ Docker Desktop Memory = 7.65 GB
                      └─ Pro Container: 256 MB ceiling, ~20 MB real
                          └─ ≈29 Container bevor OOM
```

| Faktor | Wert | Ort | Typ |
|--------|------|-----|-----|
| Docker Desktop RAM | 7.65 GB | Docker Desktop Settings | Hard |
| Pool Max Runners | 30 | `docker-compose.yml:20` | Hard |
| Memory pro Sandbox | 256 MB | `docker-compose.yml:23` | Per-Container |
| CPU pro Sandbox | 0.5 vCPU | `docker-compose.yml:24` | Per-Container |
| PIDs pro Sandbox | 50 | `docker-command-builder.ts:52` | Per-Container |
| Compile-Semaphore | 8 gleichzeitig | `docker-compose.yml:27` | Semaphore |
| Worker Threads | 8 | `docker-compose.yml:25` | Thread Pool |
| WS Compress Concurrency | 10 | `simulation.ws.ts:54` | Soft |
| Browser HTTP/1.1 Slots | 6 pro Origin | Chrome/Browser | Hard |
| Health Poll Rate | 1/sec | `use-backend-health.ts` | Per-Client |

## 2. Was muss für echte Multi-WS-Integration-Tests getan werden?

### Ist-Zustand der Tests

| Test | Echte WS? | Echte Docker? | Clients |
|------|-----------|---------------|---------|
| `concurrent-50-clients.test.ts` | ✅ Ja (`ws` Paket) | ❌ MockSandboxRunner | 50 |
| `scalability-stress.test.ts` | ❌ Nein | ❌ MockRunner | Pool-Logik |
| `load-suite.test.ts` | ❌ Nein | ❌ Stub-Server | HTTP-only |

Problem: Kein einziger Test prüft echte Docker-Container unter Last. Die Mocks simulieren ~20ms Compile+Output; real dauert eine Docker-Compilation 2–10 Sekunden.

### Was benötigt wird

#### A) Reusable WebSocket Client Library (`tests/utils/ws-test-client.ts`)

- `connect()` mit Retry und Timeout
- `sendStartSimulation(code) → Promise<SerialOutput>`
- `waitForMessage(type, timeout) → Promise<WSMessage>`
- Lifecycle: `connect → compile → start → collect output → stop → disconnect`
- Mess-Punkte: `connectLatency`, `firstOutputLatency`, `totalMessages`

#### B) Docker-fähige Testumgebung

- Test braucht laufenden Docker-Daemon + `unosim-sandbox:latest` Image
- Umgebungsvariable `REAL_DOCKER=1` aktiviert Docker-Tests (in CI überspringen)
- Setup startet echten Express-Server mit echtem Pool (`SANDBOX_POOL_MAX_RUNNERS=N`)
- Teardown fährt alle Sandbox-Container herunter

#### C) Parametrisierter Skalierungstest

```ts
test.each([5, 10, 20, 30, 50])('handles %i concurrent WS clients', async (n) => {
  // 1. Starte n WebSocket-Clients gleichzeitig
  // 2. Jeder Client: compile(code_N) → start_simulation → warte auf serial_output
  // 3. Assert: Jeder Client sieht NUR seine eigene Ausgabe
  // 4. Messe: connect-Latenz, first-output-Latenz, Throughput
  // 5. Assert: Keine Timeouts, keine "Server overloaded"
})
```

#### D) Health unter Last messen

- Während N Simulationen laufen: `/api/health` und `/api/status` Response-Zeiten messen
- Assert: Health-Endpoint antwortet <500ms auch bei 50 aktiven Sandboxen
- Assert: WebSocket Ping/Pong funktioniert für alle Clients

#### E) Cleanup-Verifizierung

- Nach Testende: `docker ps --filter name=unosim-sandbox → 0 Container`
- Pool-Stats: `pool.getStats() → 0 inUse, queue empty`
- Keine Zombie-Prozesse, keine offenen File-Handles

Aufwand-Schätzung: Ein Agent kann das implementieren, wenn Docker Desktop läuft. Die bestehende Infrastruktur in `concurrent-50-clients.test.ts` zeigt das Pattern — es muss nur von MockSandboxRunner auf echtes Docker umgestellt werden.

## 3. Konzept: Skalierung auf 200 Clients

### 3.1 Quick Wins (Docker-Architektur beibehalten)

| Maßnahme | Effekt | Aufwand |
|----------|--------|---------|
| Docker Desktop RAM → 16 GB | ~60 Container | Settings-Änderung |
| `SANDBOX_MEMORY_MB=64` statt 256 | 4× mehr Container (AVR-Sketches brauchen <30 MB) | 1 Zeile |
| `SANDBOX_CPU_LIMIT=0.25` statt 0.5 | 2× mehr CPU-Budget | 1 Zeile |
| `SANDBOX_POOL_MAX_RUNNERS=200` | Pool-Limit aufheben | 1 Zeile |
| Health Polling drosseln (5s statt 1s, 15s statt 3s) | 80% weniger HTTP-Overhead | Wenige Zeilen |
| SonarQube in separaten Docker-Daemon | ~2 GB frei | Docker-Compose Trennung |

Ergebnis: Mit 16 GB Docker RAM, 64 MB/Container, ohne SonarQube im selben Daemon → theoretisch ~200 Container.

### 3.2 In-Browser-Ausführung (kein Docker nötig)
Konzept: AVR-Simulation komplett im Browser via WebAssembly.

```text
┌─ Browser (1 Tab/Iframe) ──────────────────────┐
│  Arduino-Code → WASM-Compiler → AVR-Emulator  │
│  Pin-State, Serial-Output → React UI           │
│  Kein Server-Kontakt für Simulation nötig       │
└────────────────────────────────────────────────┘
```

Umsetzung:

- WASM-AVR-Emulator: Portiere `simavr` (C) oder `avr8js` (TypeScript/bereits WASM-ready) in den Browser
- In-Browser-Compiler:
  - Option A: `avr-gcc` als WASM (existiert: `avrgcc-wasm`)
  - Option B: Server kompiliert einmal → ELF-Binary per HTTP an Client → Client emuliert nur
- Code-Parser: `code-parser.ts` läuft bereits plattformunabhängig, muss nur `node:crypto` durch Web Crypto ersetzen
- IO-Registry: Bereits als JSON — funktioniert clientseitig

Vorteile:

- Unlimitierte Skalierung: 0 Server-Last pro Simulation
- Server nur noch für Authentifizierung, Code-Speicherung, Examens-Monitoring
- Jeder Client ist autark → funktioniert auch offline
- Kein Docker, kein Container-Overhead

Nachteile:

- AVR-Emulation ist weniger genau als nativer g++-Compile+Run
- Initiales WASM-Download: ~5–10 MB (einmal, dann gecacht)
- Entwicklungsaufwand: hoch (2–4 Wochen für WASM-Pipeline)

Referenz-Projekte:

- Wokwi — kommerzieller Arduino-Simulator, läuft komplett im Browser via `avr8js`
- `avr8js` — TypeScript AVR-Emulator, 8-bit AVR instruction set, MIT-Lizenz

### 3.3 Shared Server-Execution ohne Docker-Isolation
Konzept: Alle Sketches laufen als Prozesse direkt auf dem Server (wie `local-compiler.ts`), ohne Docker-Container.

```text
┌─ Server (1 Prozess pro Client) ────────────────┐
│  g++ sketch.cpp → ./sketch                      │
│  Pro Prozess: ~5 MB RAM, cgroup-Limits          │
│  200 Prozesse × 5 MB = 1 GB                     │
└────────────────────────────────────────────────┘
```

Umsetzung:

- Compilation: Direkt `g++` auf dem Server (schon implementiert in `local-compiler.ts`)
- Execution: `child_process.spawn()` mit OS-Level-cgroups statt Docker
- Isolation:
  - Separater User pro Sketch (`sandboxuser-N`)
  - `ulimit -v 64000` (64 MB VM-Limit)
  - `timeout 60s` (Max Laufzeit)
  - `chroot` oder namespaces für Filesystem-Isolation

Vorteile:

- ~50× weniger Overhead als Docker (kein containerd, kein overlay-FS)
- 200 Prozesse bei je 5 MB = 1 GB (statt 200×256 MB Docker)
- Startup <100ms statt ~2s für Docker-Container

Nachteile:

- Weniger Isolation als Docker (Sandbox-Escape theoretisch möglich)
- Linux-spezifisch (cgroups, namespaces)
- Für eine Hochschul-Umgebung mit kontrolliertem Code ausreichend sicher

### 3.4 Hybrid-Architektur (empfohlen für 200 Clients)

```text
┌─ Client (Browser) ─────────────────────────────────┐
│  Code-Editor  →  POST /api/compile                  │
│                                                      │
│  ┌─ Option A: Browser-Sim ─┐  ┌─ Option B: Server ─┐│
│  │  WASM AVR-Emulator      │  │  WS → Docker/Local  ││
│  │  (default, 0 Last)      │  │  (on-demand)        ││
│  └──────────────────────────┘  └─────────────────────┘│
└──────────────────────────────────────────────────────┘
```

Default: Browser-Emulation via `avr8js`-WASM

- Kein Server nötig für Simulation
- Unlimitierte Skalierung
- Compilation auf Server (einmal), dann Binary an Client

Fallback: Server-Sandbox für Features, die WASM nicht kann

- Erweiterte Hardware-Peripherie
- Exakte Timing-Tests
- Exam-Mode (verifizierte Ausführung serverseitig)

Server bleibt verantwortlich für:

- Compilation (`avr-gcc`)
- Code-Speicherung/Persistenz
- Authentifizierung
- Exam-Monitoring (serverseitige Simulation für Prüfungen)

### 3.5 Weitere Optimierungsideen

| Idee | Beschreibung | Skalierungseffekt |
|------|--------------|-------------------|
| WebSocket Multiplexing | Ein WS pro Iframe → ein geteilter WS + SharedWorker | 30 WS → 1 WS |
| SSE statt WS | Server-Sent Events für Serial-Output (kein Upgrade nötig) | Keine 6-Slot-Konkurrenz |
| Container-Sharing | Mehrere Sketches in einem Container (Process-Level Isolation) | 200 Prozesse in 10 Containern |
| Compilation-Cache | Identische Sketches → selbes Binary → kein Re-Compile | 90% weniger g++-Last |
| Lazy Simulation | Sandbox erst bei "Start" allokieren, nicht bei WS-Connect | Pool nur für aktive Sims |
| Cloud-Burst | Bei >30 lokalen Runnern → Overflow zu Cloud-Containern | Elastisch |

### Empfohlene Umsetzungsreihenfolge

| Prio | Maßnahme | Effekt | Aufwand |
|------|----------|--------|---------|
| 1 | `SANDBOX_MEMORY_MB=64`, Pool auf 100, Docker RAM 16 GB | 29 → ~100 Clients | 30 Min |
| 2 | Health-Polling drosseln (5s/15s) | Weniger HTTP-Overhead | 1 Stunde |
| 3 | Echte Multi-WS-Integration-Tests | Regression verhindern | 1 Tag |
| 4 | `avr8js`-WASM Browser-Integration (PoC) | 100 → ∞ Clients | 2–3 Wochen |
| 5 | Hybrid-Architektur (Browser-Default + Server-Fallback) | Production-ready | 4–6 Wochen |

---

## 4. Zentrale Konfiguration (`server/config.ts`)

### 4.1 Motivation

Vor der Zentralisierung waren **60+ konfigurierbare Parameter** über 15+ Dateien verstreut:
- `docker-compose.yml` setzte Umgebungsvariablen
- Jeder Service las `process.env.*` einzeln mit eigenen Defaults
- Hardcodierte Limits (Timeouts, Batch-Intervalle, Queue-Größen) waren als Magic Numbers im Code versteckt
- Kein einheitlicher Überblick über alle Tuning-Parameter

### 4.2 Design-Konzept: Zwei Achsen

Die zentrale Konfiguration modelliert zwei orthogonale Achsen:

```text
                        Simulation Mode
                   ┌──────────┬────────────────┐
                   │  local   │ docker-sandbox  │
  Server    ┌─────┼──────────┼────────────────┤
  Mode      │local│ Dev-Mode │ Dev + Docker    │
            │     │ (g++ auf │ (Container pro  │
            │     │  Host)   │  Sketch)        │
            ├─────┼──────────┼────────────────┤
            │dock-│ —        │ Production      │
            │er   │          │ (docker-compose) │
            └─────┴──────────┴────────────────┘
```

**Server Mode** (`local` | `docker`): Wo der UnoSim-Server selbst läuft.
- `local`: Direkt auf dem Entwicklungsrechner (`npm run dev`)
- `docker`: Im Container via `docker-compose up`

**Simulation Mode** (`local` | `docker-sandbox`): Wo Arduino-Sketches kompiliert und ausgeführt werden.
- `local`: Native `g++`-Compile + `child_process.spawn()` — minimaler Overhead, weniger Isolation
- `docker-sandbox`: Isolierter Docker-Container pro Sketch — volle Isolation, höherer Overhead

### 4.3 Konfigurationsstruktur

```typescript
// server/config.ts — Single Source of Truth
export const config = {
  serverMode:     "local" | "docker",
  simulationMode: "local" | "docker-sandbox",

  sandbox: {
    pool: {
      minRunners:       5,     // SANDBOX_POOL_MIN_RUNNERS
      maxRunners:     100,     // SANDBOX_POOL_MAX_RUNNERS (docker-compose; dev: =minRunners)
      idleTimeoutMs: 120_000,  // SANDBOX_POOL_IDLE_TIMEOUT_MS
      acquireTimeoutMs: 60_000,
      maxQueueSize:     500,
    },
    resources: {
      memoryMB:     64,        // SANDBOX_MEMORY_MB (was: 256)
      cpuLimit:   "0.25",      // SANDBOX_CPU_LIMIT (was: "0.5")
      pidsLimit:    50,
      maxExecutionTimeSec: 60,
      maxOutputBytes: 100 MB,
    },
    dockerImage: "unosim-sandbox:latest",
    dockerHost:  "unix:///var/run/docker.sock",
  },

  compilation: {
    workerCount:             min(8, cpus×0.5),
    dockerCompileConcurrent: 8,
    timeoutMs:               60_000,
    fqbn:                    "arduino:avr:uno",
    cacheDir:                "server/arduino-cache",
    buildCacheDir:           "storage/cache",
    buildCacheMaxBytes:      2 GB,
  },

  client: {
    healthPollIntervalMs:  5_000,   // was: 1_000
    statusPollIntervalMs: 15_000,   // was: 3_000
    startupGraceMs:        5_000,
    fetchTimeoutMs:        2_000,
  },
};
```

### 4.4 Umgebungsvariablen-Mapping

Jeder Parameter liest optional eine Umgebungsvariable. Ist sie nicht gesetzt, greift der in `config.ts` definierte Default:

| Parameter | Umgebungsvariable | Default | Geändert? |
|-----------|-------------------|---------|-----------|
| `sandbox.pool.maxRunners` | `SANDBOX_POOL_MAX_RUNNERS` | =minRunners (dev), 100 (docker-compose) | ✅ war 30 |
| `sandbox.resources.memoryMB` | `SANDBOX_MEMORY_MB` | 64 | ✅ war 256 |
| `sandbox.resources.cpuLimit` | `SANDBOX_CPU_LIMIT` | 0.25 | ✅ war 0.5 |
| `client.healthPollIntervalMs` | — | 5.000 | ✅ war 1.000 |
| `client.statusPollIntervalMs` | — | 15.000 | ✅ war 3.000 |
| `compilation.workerCount` | `WORKER_COUNT` | auto | — |
| `sandbox.dockerImage` | `DOCKER_SANDBOX_IMAGE` | unosim-sandbox:latest | — |

### 4.5 Verdrahtung

`config.ts` wird von den Konsumenten importiert statt `process.env` direkt zu lesen:

| Konsument | Vorher | Nachher |
|-----------|--------|---------|
| `sandbox-runner-pool.ts` | `process.env.SANDBOX_POOL_*` | `config.sandbox.pool.*` |
| `execution-manager.ts` (`SANDBOX_CONFIG`) | `process.env.SANDBOX_*` | `config.sandbox.resources.*` |
| `use-backend-health.ts` | hardcodiert 1s/3s | hardcodiert 5s/15s |

### 4.6 Nächste Schritte (inkrementelle Migration)

Die folgenden Dateien lesen noch direkt `process.env` und können Schritt für Schritt migriert werden:

| Datei | Env-Vars | Priorität |
|-------|----------|-----------|
| `compilation-worker-pool.ts` | `WORKER_COUNT` | Mittel |
| `arduino-compiler.ts` | `ARDUINO_FQBN`, `ARDUINO_CACHE_DIR` | Niedrig |
| `compile-gatekeeper.ts` | `COMPILE_MAX_CONCURRENT` | Mittel |
| `sandbox-runner.ts` | `FORCE_DOCKER`, `DOCKER_HOST` | Hoch |
| `server/index.ts` | `SIMULATOR_ALLOWED_PARENT_ORIGINS` | Niedrig |

---

## 5. Umgesetzte Quick Wins

### ✅ 5.1 Per-Sandbox Memory: 256 MB → 64 MB

**Begründung**: Typische AVR-Sketches nutzen real 5–30 MB RAM. Das `--memory 256m` Docker-Flag ist ein cgroup-Ceiling, keine Reservierung.
Mit 64 MB bleibt genug Headroom für worst-case Sketches, aber Docker Desktop kann 4× mehr Container starten, bevor OOM eintritt.

**Geändert in**: `docker-compose.yml`, `server/config.ts` (neuer Default)

### ✅ 5.2 Per-Sandbox CPU: 0.5 → 0.25

**Begründung**: Ein AVR-Sketch ist single-threaded und CPU-bound nur während g++ (das bereits via Semaphore auf 8 begrenzt ist).
Zur Laufzeit nutzt ein Sketch <5% CPU. 0.25 vCPU reicht für Echtzeit-Simulation.

**Geändert in**: `docker-compose.yml`, `server/config.ts` (neuer Default)

### ✅ 5.3 Pool Max Runners: 30 → 100

**Begründung**: Das Pool-Hardlimit war der zweite Engpass (nach Docker-Memory). Mit reduziertem Memory pro Container (64 MB)
können in 7,65 GB Docker Desktop RAM theoretisch ~120 Container laufen. 100 als Hardlimit lässt Reserve.

**Geändert in**: `docker-compose.yml`, `server/config.ts` (neuer Default)

### ✅ 5.4 Health Polling: 1s → 5s, Status Polling: 3s → 15s

**Begründung**: Bei 100 gleichzeitigen Clients erzeugen 1s-Health-Checks 100 req/sec — das sind 100 Requests durch die 6 HTTP/1.1-Slots
des Browsers. Mit 5s sinkt das auf 20 req/sec. Status-Polling (15s) senkt weitere 7 req/sec auf <1 req/sec pro Client.

**Geändert in**: `client/src/hooks/use-backend-health.ts`

### Theoretische Kapazität nach Quick Wins

```text
Docker Desktop Memory:     7.653 GB
Belegt (Host-Container):  ~2.8 GB
Verfügbar für Sandboxen:  ~4.8 GB
Pro Sandbox (--memory):     64 MB
→ Max Sandboxen:          4800/64 = 75

Mit Docker RAM auf 16 GB:
Verfügbar:                ~13.2 GB
→ Max Sandboxen:         13200/64 = 206
```

| Szenario | Max Clients |
|----------|-------------|
| Ist (7,65 GB, 256 MB/Container) | ~29 |
| Quick Wins (7,65 GB, 64 MB/Container, Pool=100) | ~75 |
| + Docker RAM 16 GB | ~200 |
| + SonarQube auslagern (+2 GB frei) | ~230 |
