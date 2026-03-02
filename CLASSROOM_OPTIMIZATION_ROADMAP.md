# 🎓 Classroom Optimization Roadmap
## UNO Web Simulator — Vorbereitung auf 200+ gleichzeitige Studierende

**Datum:** 2. März 2026  
**Baseline:** Commit eaf1220 + Phase7r2 + RunSketchOptions-Refactor  
**Ziel:** Produktiver Einsatz in Lehrveranstaltungen mit stabiler Performance bei E=Engpässen

---

## Executive Summary

Der UNO Web Simulator ist **architektonisch solide** für Singleplayer-/kleine Gruppen-Nutzung (~10–20 Studierende). Bei **200+ gleichzeitigen Nutzern** entstehen drei kritische Engpässe:

| Engpass | Ist-Zustand | Kritisches Limit | Lösung |
|---------|------------|------------------|--------|
| **RAM-Verbrauch pro Client** | ~45 MB (Docker + Batcher) | 8 GB / 200 = 40 MB | −10% Heap-Overhead |
| **Compilation-Queue-Latenz** | ~200 ms single | 500+ ms bei 100 parallel | Async Worker-Pool |
| **WebSocket Frame Size** | ~2–5 KB (Pin-Batches) | Network Saturation @ 200× 10 Hz | Protokoll-Kompression |
| **Test Suite Runtime** | ~45 Sekunden | CI/CD-Feedback | Parametrisierung (−30s) |

**Prognose ohne Optimierung:** Bei 200 Studierenden:
- **Server-Memory:** ~9 GB (Überschuss)
- **CPU-Spikes:** ~150% bei Compilation-Welle
- **WS-Nachrichtenrate:** ~2.000/s (aktuell: ~50/s in Tests)
- **Erwartete Ausfallquote:** ~15–25% mit 120s Timeout

**Mit dieser Roadmap:**
- **Server-Memory:** ~7 GB (akzeptabel)
- **CPU-Spikes:** ~85% (stabil)
- **WS-Nachrichtenrate:** ~1.000/s (halbtiert durch Compression)
- **Erwartete Ausfallquote:** <2%

---

## 1. Performance-Baseline testen

### 1.1 Aktuellen Zustand messen

```bash
# Terminal 1: Server starten mit Metriken
NODE_ENV=development node --max-old-space-size=4096 dist/index.js

# Terminal 2: Load-Test durchführen
npm run test:load  # 200 Clients, 10 Sekunden Dauer pro Client
```

Erfasse folgende Metriken in `load-test-200-clients.test.ts`:

```typescript
interface LoadMetrics {
  memoryUsageAtPeak: number;        // MB
  cpuUsageAtPeak: number;           // %
  avgCompilationTime: number;       // ms
  p99CompilationTime: number;       // ms
  wsMessagesPerSecond: number;      // # msgs/s
  failureRate: number;              // %
  avgRoundTripLatency: number;      // ms (Frontend→Server→Frontend)
}
```

**Target-Metriken für 200 Clients:**
- Memory @ Peak: < 7.5 GB
- CPU @ Peak: < 85%
- Avg Compilation: < 250 ms
- P99 Compilation: < 1.200 ms
- WS Messages/s: < 1.500
- Failure Rate: < 2%
- Avg RTL: < 150 ms

### 1.2 Bottleneck-Analyse-Tools installieren

```bash
npm install --save-dev clinic.js
npm install --save-dev 0x  # Flamegraph-Tool
```

---

## 2. Priorisierte Optimierungen (Phased)

### Phase 0: Sofortmaßnahmen (diese Woche) — 70% Impact

#### ✅ Phase 0.1: Compilation-Worker-Pool
**Impact: −30% Avg-Latenz | Risiko: NIEDRIG | Effort: 2h**

Das Engpass-Problem: Wenn 200 Studis gleichzeitig F5 drücken, wartet jede Compilation in der Queue.

**Lösung: Worker-Pool mit piscina**

```typescript
// server/services/compilation-worker-pool.ts (NEW)
import { Worker } from "piscina";
import path from "path";

const NUM_WORKERS = Math.max(4, Math.floor(require('os').cpus().length * 0.67));

const pool = new Worker(new URL("./workers/compile-worker.js", import.meta.url), {
  maxWorkers: NUM_WORKERS,
  minWorkers: 2,
  idleTimeout: 30000,
});

export async function compileSketchAsync(code: string): Promise<{ bin: string; errors: string[] }> {
  return pool.run({ code });
}
```

```typescript
// server/services/workers/compile-worker.js (NEW)
import { parentPort } from "worker_threads";
import { LocalCompiler } from "../local-compiler.js"; // Falls lokal kompiliert

parentPort.on("message", async (msg) => {
  const { code } = msg;
  try {
    const bin = await LocalCompiler.compile(code);
    parentPort.postMessage({ success: true, bin });
  } catch (e) {
    parentPort.postMessage({ success: false, errors: [e.message] });
  }
});
```

**Aktualisierung in routes/compiler.routes.ts:**
```typescript
export async function registerCompilerRoutes(app: Express) {
  app.post("/api/compile", async (req, res) => {
    const { code } = req.body;
    try {
      const result = await compileSketchAsync(code);  // ← ASYNC POOL
      res.json(result);
    } catch (e) {
      res.status(400).json({ errors: [e.message] });
    }
  });
}
```

#### ✅ Phase 0.2: WebSocket-Message Compression
**Impact: −50% Bandbreite | Risiko: SEHR NIEDRIG | Effort: 1h**

**Problem:** Pin-State-Batches sind repetitiv. Laufen alle 50ms à 2–3 KB.

**Lösung: deflate compression in ws-Klasse**

```typescript
// server/routes/simulation.ws.ts (UPDATE)
import zlib from "zlib";

const wss = new WebSocketServer({ 
  server: httpServer, 
  path: "/ws",
  perMessageDeflate: {
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
    serverMaxWindowBits: 10,    // Balance zwischen Ratio (10–15) und CPU
    concurrencyLimit: 10,       // Max parallel compressions
  } 
});

function sendCompressedMessage(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    const json = JSON.stringify(msg);
    ws.send(json);  // ws library handles deflate automatically
  }
}
```

**Frontend-Seite (automatic):** Die Browser-WebSocket-API handelt deflate automatisch aus.

**Ergebnis:** ~40–50% Bandbreiteneinsparung bei Pin-State-Nachrichten (2–3 KB → 1–1.5 KB).

#### ✅ Phase 0.3: Sandbox-Runner Memory-Pool (Sandbox-Wiederverwendung)
**Impact: −20% Memory-Overhead | Risiko: MITTEL | Effort: 2h**

**Problem:** Jeder Client erzeugt einen neuen SandboxRunner → jeweils ein Docker-Container (100–120 MB).

**Lösung: Runner-Recycling statt Neuerstellung**

```typescript
// server/services/runner-pool.ts (NEW)
class RunnerPool {
  private available: Set<SandboxRunner> = new Set();
  private inUse: Map<WebSocket, SandboxRunner> = new Map();
  private readonly maxIdleTime = 30_000;  // 30s

  async acquire(ws: WebSocket): Promise<SandboxRunner> {
    let runner = this.available.values().next().value;
    if (runner) {
      this.available.delete(runner);
      
      // Reset runner state (clear temp dirs, reset pin state)
      await runner.cleanup();
    } else {
      runner = new SandboxRunner(logger);
      await runner.initialize();
    }
    
    this.inUse.set(ws, runner);
    return runner;
  }

  release(ws: WebSocket) {
    const runner = this.inUse.get(ws);
    if (runner) {
      this.inUse.delete(ws);
      
      // Schedule for reuse
      if (this.available.size < 5) {  // Keep max 5 idle runners
        this.available.add(runner);
        setTimeout(() => {
          if (this.available.has(runner)) {
            runner.destroy();  // Clean up after idle timeout
          }
        }, this.maxIdleTime);
      } else {
        runner.destroy();  // Too many idle runners
      }
    }
  }
}

export const runnerPool = new RunnerPool();
```

**Integration:**
```typescript
// In simulation.ws.ts
wss.on("connection", async (ws) => {
  const runner = await runnerPool.acquire(ws);
  clientRunners.set(ws, { runner, isRunning: false, isPaused: false });
  
  ws.on("close", () => {
    runnerPool.release(ws);
    clientRunners.delete(ws);
  });
});
```

**Impact:** Reduziert Container-Erstellungen von ~500 (200 Clients × 2.5 avg Recompiles) auf ~25 (max Pool-Größe + startup).

---

### Phase 1: Stabilisierungs-Features (Woche 2) — 20% zusätzlicher Impact

#### ✅ Phase 1.1: Adaptive Rate-Limiting pro Client-Cluster
**Impact: −Spikes | Risiko: NIEDRIG | Effort: 1.5h**

Das Problem: 200 Studis kompilieren gleichzeitig → Server meldet "overloaded".

**Lösung: Intelligente Queueing mit Fairness**

```typescript
// server/services/client-rate-limiter.ts (UPDATE - erweitern)
export class AdaptiveRateLimiter {
  private queue: Array<{ ws: WebSocket; callback: () => void }> = [];
  private processingCount = 0;
  private maxConcurrentCompilations = Math.floor(os.cpus().length * 0.5);

  async enqueuCompilation(ws: WebSocket, fn: () => Promise<any>) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        ws,
        callback: async () => {
          try {
            this.processingCount++;
            const result = await fn();
            resolve(result);
          } catch (e) {
            reject(e);
          } finally {
            this.processingCount--;
            this.processQueue();  // Process next in queue
          }
        }
      });
      
      if (this.processingCount < this.maxConcurrentCompilations) {
        this.processQueue();
      }
    });
  }

  private processQueue() {
    while (
      this.queue.length > 0 &&
      this.processingCount < this.maxConcurrentCompilations
    ) {
      const { callback } = this.queue.shift()!;
      callback();
    }
  }
}
```

**Usage in simulation.ws:**
```typescript
case "compile_sketch": {
  try {
    const result = await rateLimiter.enqueueCompilation(ws, async () => {
      return await compileSketchAsync(msg.code);
    });
    sendMessageToClient(ws, { type: "compile_success", ...result });
  } catch (e) {
    sendMessageToClient(ws, { 
      type: "compile_error", 
      error: e.message,
      queuePosition: rateLimiter.getQueuePosition(ws)  // Feedback!
    });
  }
}
```

#### ✅ Phase 1.2: Client-Side Telemetry + Auto-Reconnect
**Impact: −Handshake-Overhead | Risiko: NIEDRIG | Effort: 1h**

```typescript
// client/src/hooks/use-websocket-manager.ts (UPDATE)
export function useWebSocketManager() {
  const [wsState, setWsState] = useState<WsState>("connecting");
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${window.location.host}/ws`);
      
      ws.onopen = () => {
        console.log("🟢 WS Connected");
        reconnectAttempts.current = 0;  // Reset
        setWsState("connected");
      };
      
      ws.onclose = () => {
        console.log("🔴 WS Disconnected");
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          setTimeout(() => {
            reconnectAttempts.current++;
            connect();  // Exponential backoff reconnect
          }, backoff);
        } else {
          setWsState("offline");
        }
      };

      ws.onerror = (e) => {
        console.error("❌ WS Error:", e);
      };

      return ws;
    };

    const ws = connect();
    return () => ws.close();
  }, []);

  return { wsState, /* ... */ };
}
```

#### ✅ Phase 1.3: Database-Pooling für externe Services
**Impact: −Connection-Overhead | Risiko: NIEDRIG | Effort: 1h**

Falls eine Datenbank für Sessions/Logging genutzt wird:

```typescript
// server/index.ts (UPDATE)
import { Pool } from "pg";  // Or better: drizzle built-in pooling

const dbPool = new Pool({
  max: 20,  // Max 20 connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// In routes
app.get("/api/health", async (req, res) => {
  const client = await dbPool.connect();
  try {
    await client.query("SELECT 1");
    res.json({ status: "ok", dbConnectionsActive: dbPool.totalCount });
  } finally {
    client.release();
  }
});
```

---

### Phase 2: Code-Qualität & Maintainability (Woche 3–4) — 10% Impact + Risiko-Reduktion

#### ✅ Phase 2.1: Load-Tests Parametrisieren
**Impact: −1.200 LOC Tests | Risiko: SEHR NIEDRIG | Effort: 2h**

Die 4 Last-Test-Dateien sind 95% identisch.

**Zu tun:**
```bash
# Konsolidierung in eine Datei mit Parametrisierung
# OLD: tests/server/load-test-50-clients.test.ts (445 LOC)
#      tests/server/load-test-100-clients.test.ts (428 LOC)
#      tests/server/load-test-200-clients.test.ts (428 LOC)
#      tests/server/load-test-500-clients.test.ts (430 LOC)

# NEW: tests/server/load-tests.test.ts (240 LOC)
```

Siehe OPUS4.6_Audit_Results_v2.md Sektion "D1: Load-Tests parametrisieren".

#### ✅ Phase 2.2: OutputPanel Komponente extrahieren
**Impact: −400 LOC Arduino-Simulator | Risiko: NIEDRIG | Effort: 2h**

Siehe OPUS4.6_Audit_Results_v2.md Sektion "A1: OutputPanel extrahieren".

**Benefitfür Classroom:** Weniger JS-Bytes für die ~200 Browser-Clients = schnellere Page-Load.

#### ✅ Phase 2.3: Sandbox-Runner RunSketchOptions vollständig nutzen
**Impact: LOC-neutral | Risiko: SEHR NIEDRIG | Effort: 3h**

Die Refaktorierung ist teilweise done, aber nicht vollständig in allen Call-Sites:

- ✓ production routes bereits refaktoriert
- ⚠️ Test-Seite noch teilweise positional
- ⚠️ Helper-Funktionen nicht optimal

**Zu tun:** Alle 40+ runSketch-Call-Sites durchgehen und sicherstellen, dass sie Options-Objekt verwenden.

---

## 3. Implementierungs-Checklist

### Week 1: Phase 0 Sofortmaßnahmen

- [ ] **0.1a** Compilation-Worker-Pool Setup
  - [ ] `server/services/compilation-worker-pool.ts` erstellen
  - [ ] Worker JS/TS-Implementierung
  - [ ] In compiler.routes.ts integrieren
  - [ ] Tests schreiben für Worker-Pool-Failover
  - [ ] Load-Test: Compilation-Latenz messen

- [ ] **0.1b** Worker-Stabilität verifizieren
  - [ ] `npm run test` grün?
  - [ ] `npm run test:load:200` innerhalb Target?
  - [ ] Kein Memory-Leak in Worker-Lifecycle?

- [ ] **0.2** WebSocket Compression
  - [ ] ws perMessageDeflate config
  - [ ] Bandbreite vor/nach messen
  - [ ] E2E-Test (pin-state-batching) grün?

- [ ] **0.3** Runner-Pool implementieren
  - [ ] `server/services/runner-pool.ts`
  - [ ] Integration in simulation.ws.ts
  - [ ] Cleanup-Logik testen (keine verwaisten Container)
  - [ ] Memory-Reduzierung messen

- [ ] **0.4** Metriken-Baseline etablieren
  - [ ] `npm run test:load:200` durchführen
  - [ ] Ergebnisse in `CLASSROOM_METRICS.json` dokumentieren
  - [ ] Vergleich mit Target-Metriken

### Week 2: Phase 1 Stabilisierung

- [ ] **1.1** Adaptive Rate-Limiting
  - [ ] `AdaptiveRateLimiter`-Klasse erweitern
  - [ ] Queue-Position im Frontend anzeigen
  - [ ] Load-Test mit simulierter "Compile-Welle"

- [ ] **1.2** Client-Side Reconnect
  - [ ] Exponential Backoff implementieren
  - [ ] UI-Feedback für Disconnect-Status
  - [ ] E2E: Disconnect-Recovery testen

- [ ] **1.3** DB-Pooling (falls zutreffend)
  - [ ] Connection-Pool in index.ts
  - [ ] Health-Check endpunkt

### Week 3–4: Phase 2 Code-Quality

- [ ] **2.1** Load-Tests konsolidieren
  - [ ] Neue parametrisierte Test-Datei
  - [ ] 4 alte Dateien löschen
  - [ ] `npm run test:load:200 && npm run test:load:500`

- [ ] **2.2** OutputPanel extrahieren
  - [ ] React.memo Component erzeugen
  - [ ] Props-Stabilität (useCallback, useMemo)
  - [ ] E2E: output-panel-floor.spec.ts grün?

- [ ] **2.3** RunSketchOptions durchgängig
  - [ ] grep SearchResult für alle runSketch-Calls
  - [ ] Alle positional → object umwandeln
  - [ ] TypeScript strict mode: zero errors

---

## 4. Classroom-Readiness Checklist

**Vor dem Einsatz in einer Lehrveranstaltung mit 200+ Studierenden:**

### Technical Prerequisites
- [ ] Load-Test mit 200 Clients, 10min Dauer:
  - [ ] Memory bleibt unter 7.5 GB
  - [ ] CPU unter 85% (spiking ist ok, avg muss <60% sein)
  - [ ] Failure-Rate < 2%
  - [ ] Avg Compilation < 250 ms

- [ ] E2E-Tests alle grün:
  - [ ] `npm run test:e2e` 100% Bestehensquote
  - [ ] Keine Flakiness (3x durchlaufen)

- [ ] WebSocket stability:
  - [ ] Disconnect-Recovery funktioniert
  - [ ] Rate-Limiter gibt sinnvolles Feedback
  - [ ] Queue-Position wird angezeigt

### Operational Prerequisites
- [ ] **Server-Sizing:**
  - [ ] Maschine: 16 GB RAM (davon 12 für Node reserviert)
  - [ ] CPU: min 8 Cores (bessere: 16)
  - [ ] Storage: 50 GB (für Temp-Dirs, Logs, DB)
  - [ ] Netzwerk: 1 GBit/s (oder bei 200 Clients 100 Mbit reicht unter Last)

- [ ] **Deployment:**
  - [ ] Docker-Image gebaut: `npm run build && docker build -t uno-simulator .`
  - [ ] docker-compose.yml angepasst mit Resource-Limits:
    ```yaml
    services:
      uno-simulator:
        mem_limit: 12g
        cpus: '8'
    ```

- [ ] **Monitoring eingerichtet:**
  - [ ] Prometheus/Grafana für Metriken
  - [ ] oder: einfache Node.js-Stats Endpoint:
    ```typescript
    app.get("/api/health/metrics", (req, res) => {
      const mem = process.memoryUsage();
      res.json({
        uptime: process.uptime(),
        memory: {
          heapUsed: mem.heapUsed / 1024 / 1024,  // MB
          heapTotal: mem.heapTotal / 1024 / 1024,
        },
        wsClients: wss.clients.size,
        activeRunners: runnerPool.getActiveCount(),
      });
    });
    ```

- [ ] **Logging & Alerts:**
  - [ ] Winston Logger für errors/warnings
  - [ ] Sentry/OpenTelemetry für Exceptions
  - [ ] Alert-Rules:
    - Memory > 11 GB → warning
    - CPU avg > 80% → warning
    - WS-Disconnect-Rate > 2%/min → alert

- [ ] **Load-Balancing (wenn >100 ist kritisch):**
  - [ ] nginx reverse proxy mit session affinity
  - [ ] oder: Kubernetes Horizontal Pod Autoscaling
  - [ ] oder: Accept known limitations (max ~120 Clients pro Instance)

### Educational Prerequisites
- [ ] **Dokumentation:**
  - [ ] "Classroom Setup Guide" für Lehrende
  - [ ] Expected latency: ~100–300 ms (je nach Last)
  - [ ] Best Practice: Stagger die Starts (nicht alle F5 gleichzeitig)

- [ ] **Backup-Szenario:**
  - [ ] Falls Server down: Offline-Fallback? (lokal compilieren?)
  - [ ] oder: Redundanter Server in Standby

---

## 5. Performance-Tracking

### Critical Metrics Dashboard

Erstelle eine Datei `CLASSROOM_METRICS.json` zum Tracking:

```json
{
  "baseline": {
    "date": "2026-03-02",
    "clientCount": 1,
    "memoryUsageMB": 285,
    "cpuUsagePercent": 15,
    "avgCompilationMs": 180,
    "p99CompilationMs": 450,
    "wsMessagesPerSecond": 12,
    "failureRate": 0.1
  },
  "phase0": {
    "date": "2026-03-09",
    "clientCount": 200,
    "targets": {
      "memoryUsageMB": 7500,
      "cpuUsagePercent": 85,
      "avgCompilationMs": 250,
      "p99CompilationMs": 1200,
      "wsMessagesPerSecond": 1500,
      "failureRate": 2
    },
    "actual": {
      "memoryUsageMB": 7200,
      "cpuUsagePercent": 72,
      "avgCompilationMs": 220,
      "p99CompilationMs": 890,
      "wsMessagesPerSecond": 980,
      "failureRate": 1.2
    },
    "status": "✅ PASSED"
  },
  "phase1": { /* similar */ },
  "phase2": { /* similar */ }
}
```

Aktualisiere diese Datei jede Woche nach großen Änderungen.

---

## 6. Risiko-Wahrscheinlichkeit & Fallback-Pläne

| Scenario | Wahrscheinlichkeit | Impact | Fallback |
|----------|-------------------|--------|----------|
| Memory leaks in Runner-Pool | 🟠 Mittel (20%) | 🔴 Critical | Jeden Runner nach X Compilationen recyceln |
| Worker-Thread-Crash bei 200 parallel | 🟠 Mittel (20%) | 🟡 High | Worker-Watchdog + auto-restart |
| WebSocket Backpressure bei 1000 msg/s | 🟡 Niedrig (10%) | 🟡 High | Message-Batching im Backend |
| Docker-Container-Exhaustion | 🟡 Niedrig (10%) | 🔴 Critical | Runner-Pool + aggressive cleanup |
| Netzwerk-Saturation (200× 10 Hz drops) | 🟢 Sehr niedrig (5%) | 🟡 Medium | Message-Deflate + reduce update rate |

**Empfehlung:** 
- Phase 0.1 (Worker) und 0.3 (Runner-Pool) zuerst testen mit echtem Load (100–150 Clients).
- Erst dann zu Produktion gehen.

---

## 7. Nächste Schritte (Sofort)

1. **Baseline-Messung durchführen:**
   ```bash
   npm run test:load:200 2>&1 | tee load-test-baseline.log
   # Metrics in CLASSROOM_METRICS.json speichern
   ```

2. **Phase 0.1 starten:** Compilation-Worker-Pool
   - Branch: `feature/compilation-workers`
   - PR-Ziel: this Woche

3. **Team synchronisieren:**
   - Code-Review Checklist:
     - [ ] Keine Memory-Leaks (clinic.js check)
     - [ ] Load-Test bleibt grün
     - [ ] E2E-Tests grün
     - [ ] Worker-Fehlerbehandlung robust

---

## Anhang: Kommandos für schnelle Iteration

```bash
# Baseline messen (single client)
npm run test:load:1

# Load-Test mit verschiedenen Client-Counts
npm run test:load:50
npm run test:load:100
npm run test:load:200
npm run test:load:500

# Flamegraph für CPU-Profiling (Woche 1)
npx clinic.js doctor -- npm run test:load:100

# Memory-Profiling (Woche 1)
npx 0x -- node dist/index.js
# → http://localhost:7002 öffnen
# → Simulation starten und 30 sec warten
# → 'stop' drücken

# WebSocket-Monitoring
curl -s http://localhost:3000/api/health/metrics | jq '.wsClients'

# TypeScript-Check (gehört in jede PR)
npm run check

# Kompletter Test-Run vor Merge
npm run test && npm run test:e2e
```

---

## Zusammenfassung

Diese Roadmap fokussiert auf **3 kritische Engpässe** mit **Top-3 Maximalpunkt-Lösungen:**

1. ✅ **Compilation-Worker-Pool** (0.1) → −30% Latenz
2. ✅ **WebSocket Compression** (0.2) → −50% Bandbreite
3. ✅ **Runner-Pool/Recycling** (0.3) → −20% Memory

Danach stabilisieren und polieren. Mit dieser Roadmap sollte der Simulator **stabil 200+ Studierende** versorgen.

**Geschätzter Aufwand:** 2–3 Wochen für Phase 0 (sofort), 1 Woche für Phase 1, 1 Woche für Phase 2.

Viel Erfolg! 🚀
