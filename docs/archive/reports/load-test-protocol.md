# Lasttest-Protokoll: 50/100/200 Clients

Status: current  
Version: 1.0.0  
Datum: 2026-09-06  
Grundlage: `docs/phase-3.4-3.10-operational-readiness-plan.md`, Maßnahme 3.4

---

## Zweck

Dieses Dokument definiert das verbindliche Messprofil für reproduzierbare Lasttests mit 50, 100 und 200 gleichzeitigen Clients. Es stellt sicher, dass Kapazitätsaussagen nur auf Basis dokumentierter Hostprofile, klarer Messgrößen und standardisierter Artefakte getroffen werden.

---

## Hostprofil (verbindlich zu dokumentieren)

**Warnung:** Keine Kapazitätsaussage ohne dokumentiertes Hostprofil. Jede Abweichung invalidiert die Messergebnisse.

### Erforderliche Hostprofil-Daten

| Kategorie | Feld | Beispiel | Pflicht |
| --- | --- | --- | --- |
| **CPU** | Modell | `Apple M2 Pro (12-Core)` | ✅ |
| | Kerne (P-/E-Cores) | `12 (8P + 4E)` | ✅ |
| | Taktfrequenz | `3.5 GHz` | ✅ |
| **RAM** | Gesamtspeicher | `32 GB` | ✅ |
| | Verfügbar für Docker | `24 GB` | ✅ |
| **OS** | Betriebssystem | `macOS 15.6.1` | ✅ |
| | Kernel-Version | `Darwin 24.6.0` | ✅ |
| **Docker** | Version | `Docker Desktop 4.38.0` | ✅ |
| | Engine | `28.2.2` | ✅ |
| | RAM-Limit | `24 GB` | ✅ |
| | CPU-Limit | `10 CPUs` | ✅ |
| | Storage-Typ | `overlay2` | ✅ |
| **Node.js** | Version | `24.20.0` | ✅ |
| | npm-Version | `11.4.2` | ✅ |
| **Browser** (für Playwright) | Name | `Chromium` | ✅ |
| | Version | `140.0.7339.10` | ✅ |
| **UnoSim-Konfiguration** | `WORKER_COUNT` | `8` | ✅ |
| | `COMPILE_MAX_CONCURRENT` | `8` | ✅ |
| | `SANDBOX_POOL_MIN_RUNNERS` | `5` | ✅ |
| | `SANDBOX_POOL_MAX_RUNNERS` | `100` | ✅ |
| | `SANDBOX_MEMORY_MB` | `256` | ✅ |
| | `SANDBOX_CPU_LIMIT` | `0.5` | ✅ |
| | `UNOSIM_SIMULATION_MODE` | `docker-sandbox` | ✅ |
| | `DOCKER_SANDBOX_IMAGE` | `unosim-sandbox:latest` | ✅ |

### Hostprofil-Vorlage (JSON)

```json
{
  "timestamp": "2026-09-06T10:00:00.000Z",
  "cpu": {
    "model": "Apple M2 Pro",
    "cores": 12,
    "pCores": 8,
    "eCores": 4,
    "frequency": "3.5 GHz"
  },
  "ram": {
    "total": 32,
    "dockerAvailable": 24,
    "unit": "GB"
  },
  "os": {
    "platform": "macOS",
    "version": "15.6.1",
    "kernel": "Darwin 24.6.0"
  },
  "docker": {
    "desktopVersion": "4.38.0",
    "engineVersion": "28.2.2",
    "ramLimit": 24,
    "cpuLimit": 10,
    "storageDriver": "overlay2"
  },
  "node": {
    "version": "24.20.0",
    "npmVersion": "11.4.2"
  },
  "browser": {
    "name": "Chromium",
    "version": "140.0.7339.10"
  },
  "unosim": {
    "workerCount": 8,
    "compileMaxConcurrent": 8,
    "sandboxPoolMinRunners": 5,
    "sandboxPoolMaxRunners": 100,
    "sandboxMemoryMb": 256,
    "sandboxCpuLimit": 0.5,
    "simulationMode": "docker-sandbox",
    "dockerSandboxImage": "unosim-sandbox:latest"
  }
}
```

---

## Messgrößen (verbindlich zu erfassen)

### Client-Level-Metriken (pro Client)

| Metrik | Beschreibung | Einheit | Messpunkt |
| --- | --- | --- | --- |
| `clientId` | Eindeutige Client-ID | Integer | Test-Harness |
| `connectLatency` | Zeit bis WebSocket-Verbindung steht | ms | WS `open` Event |
| `fetchSketchTime` | Zeit zum Laden der Sketch-Liste | ms | HTTP GET `/api/sketches` |
| `compileTime` | Zeit von Compile-Request bis Response | ms | HTTP POST `/api/compile` |
| `startSimLatency` | Zeit von start_simulation bis compilation_status | ms | WS-Nachricht |
| `firstOutputLatency` | Zeit bis erste Serial-Ausgabe | ms | Erste `serial_output` WS-Nachricht |
| `totalSimTime` | Gesamtzeit von Connect bis Stop | ms | Lifecycle |
| `success` | Simulation erfolgreich | Boolean | Test-Harness |
| `error` | Fehlermeldung (falls fehlgeschlagen) | String | Error-Handler |

### Server-Level-Metriken (global)

| Metrik | Beschreibung | Einheit | Messpunkt |
| --- | --- | --- | --- |
| `activeClients` | Aktuell verbundene Clients | Integer | `/api/status` |
| `activeRunners` | Aktive Sandbox-Runner | Integer | `/api/status` |
| `queueDepth` | Wartende Requests in Queue | Integer | `/api/status` |
| `compileSlotsUsed` | Belegte Compile-Slots | Integer | `/api/status` |
| `workerThreadsActive` | Aktive Worker-Threads | Integer | `/api/status` |
| `cpuUsage` | CPU-Auslastung (Host) | % | `os.cpus()` / Docker Stats |
| `memoryUsage` | RAM-Nutzung (Host) | MB | `os.totalmem()` / Docker Stats |
| `dockerContainerCount` | Laufende Sandbox-Container | Integer | `docker ps` |
| `healthLatency` | Response-Zeit `/api/health` | ms | HTTP GET |
| `statusLatency` | Response-Zeit `/api/status` | ms | HTTP GET |
| `wsPingLatency` | WebSocket Ping/Pong-Latenz | ms | WS Ping/Pong |
| `timeoutCount` | Anzahl Timeouts | Integer | Test-Harness |
| `errorCount` | Anzahl Fehler | Integer | Test-Harness |
| `cleanupSuccess` | Cleanup erfolgreich | Boolean | `./check-leaks.sh` |

### Prozentile (über alle Clients)

| Metrik | Beschreibung |
| --- | --- |
| `p50` | 50. Perzentil (Median) der Gesamtzeit |
| `p90` | 90. Perzentil |
| `p95` | 95. Perzentil |
| `p99` | 99. Perzentil |
| `min` | Mindestzeit |
| `max` | Maximalzeit |
| `avg` | Durchschnittszeit |
| `stdDev` | Standardabweichung |

---

## Pass/Fail-Kriterien

### 50 Clients (Baseline)

| Kriterium | Ziel | Toleranz | Status |
| --- | --- | --- | --- |
| **Erfolgsrate** | ≥ 98 % (49/50) | ≥ 95 % akzeptabel | 🔴 Pflicht |
| **Connect-Latenz (p95)** | ≤ 5 s | ≤ 10 s akzeptabel | 🔴 Pflicht |
| **First-Output-Latenz (p95)** | ≤ 15 s | ≤ 20 s akzeptabel | 🔴 Pflicht |
| **Compile-Zeit (p95)** | ≤ 10 s | ≤ 15 s akzeptabel | 🔴 Pflicht |
| **Health-Latenz (p95)** | ≤ 500 ms | ≤ 1 s akzeptabel | 🔴 Pflicht |
| **Status-Latenz (p95)** | ≤ 1 s | ≤ 2 s akzeptabel | 🔴 Pflicht |
| **Timeout-Rate** | ≤ 2 % | ≤ 5 % akzeptabel | 🔴 Pflicht |
| **Cleanup** | 0 verbleibende Container | 0 Container Pflicht | 🔴 Pflicht |
| **CPU (Host)** | ≤ 80 % | ≤ 90 % akzeptabel | 🟡 Warnung |
| **RAM (Host)** | ≤ 85 % | ≤ 90 % akzeptabel | 🟡 Warnung |
| **Queue-Overflow** | 0 | 0 Pflicht | 🔴 Pflicht |

**Bestanden:** Alle 🔴 Pflicht-Kriterien erfüllt.  
**Durchgefallen:** ≥ 1 🔴 Kriterium nicht erfüllt.  
**Mit Warnungen:** Alle 🔴 erfüllt, aber ≥ 1 🟡 überschritten.

---

### 100 Clients (Erweitert)

| Kriterium | Ziel | Toleranz | Status |
| --- | --- | --- | --- |
| **Erfolgsrate** | ≥ 95 % (95/100) | ≥ 90 % akzeptabel | 🔴 Pflicht |
| **Connect-Latenz (p95)** | ≤ 10 s | ≤ 15 s akzeptabel | 🔴 Pflicht |
| **First-Output-Latenz (p95)** | ≤ 25 s | ≤ 30 s akzeptabel | 🔴 Pflicht |
| **Compile-Zeit (p95)** | ≤ 15 s | ≤ 20 s akzeptabel | 🔴 Pflicht |
| **Health-Latenz (p95)** | ≤ 1 s | ≤ 2 s akzeptabel | 🔴 Pflicht |
| **Status-Latenz (p95)** | ≤ 2 s | ≤ 3 s akzeptabel | 🔴 Pflicht |
| **Timeout-Rate** | ≤ 5 % | ≤ 10 % akzeptabel | 🔴 Pflicht |
| **Cleanup** | 0 verbleibende Container | 0 Container Pflicht | 🔴 Pflicht |
| **CPU (Host)** | ≤ 85 % | ≤ 90 % akzeptabel | 🟡 Warnung |
| **RAM (Host)** | ≤ 90 % | ≤ 95 % akzeptabel | 🟡 Warnung |
| **Queue-Overflow** | 0 | 0 Pflicht | 🔴 Pflicht |

**Voraussetzung:** 50-Client-Baseline muss stabil bestanden sein.  
**Bestanden:** Alle 🔴 Pflicht-Kriterien erfüllt.  
**Durchgefallen:** ≥ 1 🔴 Kriterium nicht erfüllt.

---

### 200 Clients (Stress)

| Kriterium | Ziel | Toleranz | Status |
| --- | --- | --- | --- |
| **Erfolgsrate** | ≥ 90 % (180/200) | ≥ 85 % akzeptabel | 🔴 Pflicht |
| **Connect-Latenz (p95)** | ≤ 20 s | ≤ 30 s akzeptabel | 🔴 Pflicht |
| **First-Output-Latenz (p95)** | ≤ 40 s | ≤ 50 s akzeptabel | 🔴 Pflicht |
| **Compile-Zeit (p95)** | ≤ 25 s | ≤ 35 s akzeptabel | 🔴 Pflicht |
| **Health-Latenz (p95)** | ≤ 2 s | ≤ 3 s akzeptabel | 🔴 Pflicht |
| **Status-Latenz (p95)** | ≤ 3 s | ≤ 5 s akzeptabel | 🔴 Pflicht |
| **Timeout-Rate** | ≤ 10 % | ≤ 15 % akzeptabel | 🔴 Pflicht |
| **Cleanup** | 0 verbleibende Container | 0 Container Pflicht | 🔴 Pflicht |
| **CPU (Host)** | ≤ 90 % | ≤ 95 % akzeptabel | 🟡 Warnung |
| **RAM (Host)** | ≤ 95 % | ≤ 98 % akzeptabel | 🟡 Warnung |
| **Queue-Overflow** | 0 | 0 Pflicht | 🔴 Pflicht |

**Voraussetzung:** 100-Client-Test muss stabil bestanden sein.  
**Bestanden:** Alle 🔴 Pflicht-Kriterien erfüllt.  
**Durchgefallen:** ≥ 1 🔴 Kriterium nicht erfüllt.  
**Hinweis:** 200 Clients ist ein Stresstest; einzelne Timeouts sind erwartbar.

---

## Messartefakt-Format (standardisiert)

### Artefakt-Verzeichnis

```
test-results/
├── load-2026-09-06T10-00-00Z/
│   ├── host-profile.json
│   ├── metrics-50.json
│   ├── metrics-100.json (falls durchgeführt)
│   ├── metrics-200.json (falls durchgeführt)
│   ├── client-details-50.json
│   ├── client-details-100.json (falls durchgeführt)
│   ├── client-details-200.json (falls durchgeführt)
│   ├── server-metrics-50.json
│   ├── server-metrics-100.json (falls durchgeführt)
│   ├── server-metrics-200.json (falls durchgeführt)
│   ├── cleanup-report.json
│   └── summary.md
└── ...
```

### `host-profile.json`

```json
{
  "timestamp": "2026-09-06T10:00:00.000Z",
  "testId": "load-2026-09-06T10-00-00Z",
  "cpu": { ... },
  "ram": { ... },
  "os": { ... },
  "docker": { ... },
  "node": { ... },
  "browser": { ... },
  "unosim": { ... }
}
```

### `metrics-{N}.json` (Zusammenfassung)

```json
{
  "testName": "Load Test: N Concurrent Clients",
  "timestamp": "2026-09-06T10:00:00.000Z",
  "totalClients": N,
  "successful": N,
  "failed": 0,
  "successRate": 100,
  "totalTime": 12345,
  "avgTime": 246.9,
  "minTime": 150,
  "maxTime": 450,
  "throughput": 4.05,
  "p50": 230,
  "p90": 350,
  "p95": 400,
  "p99": 440,
  "stdDev": 45.2,
  "avgConnectLatency": 120,
  "avgCompileTime": 2500,
  "avgFirstOutputLatency": 3200,
  "avgHealthLatency": 150,
  "avgStatusLatency": 200,
  "timeoutCount": 0,
  "errorCount": 0,
  "peakCpuUsage": 65.3,
  "peakMemoryUsage": 18432,
  "peakActiveRunners": N,
  "peakQueueDepth": 0,
  "cleanupSuccess": true
}
```

### `client-details-{N}.json` (pro Client)

```json
{
  "clientId": 1,
  "fetchSketchTime": 50,
  "compileTime": 2300,
  "startSimTime": 100,
  "connectLatency": 120,
  "firstOutputLatency": 3100,
  "totalSimTime": 5670,
  "success": true,
  "error": null
}
```

### `server-metrics-{N}.json` (Zeitreihe)

```json
{
  "samples": [
    {
      "timestamp": "2026-09-06T10:00:00.000Z",
      "activeClients": 10,
      "activeRunners": 8,
      "queueDepth": 2,
      "compileSlotsUsed": 6,
      "cpuUsage": 45.2,
      "memoryUsage": 12288,
      "healthLatency": 120,
      "statusLatency": 180
    }
  ]
}
```

### `cleanup-report.json`

```json
{
  "timestamp": "2026-09-06T10:05:00.000Z",
  "containersBefore": 0,
  "containersAfter": 0,
  "processesBefore": 0,
  "processesAfter": 0,
  "leakDetected": false,
  "details": "All containers cleaned up successfully"
}
```

### `summary.md`

```markdown
# Load Test Summary

**Test ID:** `load-2026-09-06T10-00-00Z`  
**Datum:** 2026-09-06  
**Hostprofil:** Siehe `host-profile.json`

## Ergebnisse

| Test | Clients | Erfolgreich | Fehlgeschlagen | Erfolgsrate | p95 Gesamtzeit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 50 Clients | 50 | 50 | 0 | 100 % | 400 ms | ✅ Bestanden |
| 100 Clients | 100 | 98 | 2 | 98 % | 650 ms | ✅ Bestanden |
| 200 Clients | 200 | 185 | 15 | 92.5 % | 1200 ms | ⚠️ Mit Warnungen |

## Host-Metriken

- **CPU-Spitze:** 78 %
- **RAM-Spitze:** 22 GB (68 %)
- **Aktive Runner (max):** 100
- **Queue-Tiefe (max):** 5

## Cleanup

- **Container vor/nach Test:** 0 / 0
- **Prozesse vor/nach Test:** 0 / 0
- **Leak erkannt:** Nein

## Fazit

50 und 100 Clients stabil bestanden. 200 Clients zeigt erste Timeout-Rate von 7.5 %, was im akzeptablen Bereich liegt. CPU- und RAM-Auslastung bleiben unter kritischen Schwellen.

**Empfehlung:** 100 Clients als Produktionslimit dokumentieren. 200 Clients nur mit erweitertem Host-RAM (≥ 48 GB) empfohlen.
```

---

## Test-Durchführungs-Protokoll

### Vorbereitung

1. **Hostprofil erfassen:**
   ```bash
   node scripts/capture-host-profile.mjs > test-results/load-YYYY-MM-DDTHH-MM-SSZ/host-profile.json
   ```

2. **Docker-Stack bereinigen:**
   ```bash
   docker-compose down
   docker ps -aq --filter "name=unosim-sandbox" | xargs docker rm -f 2>/dev/null || true
   ./check-leaks.sh --cleanup
   ```

3. **Server starten (frischer Zustand):**
   ```bash
   npm run dev:e2e
   # Warten bis Server bereit: http://localhost:3000/api/health
   ```

### Durchführung

1. **50 Clients (Baseline):**
   ```bash
   npm run test:load:50
   ```
   - Artefakte speichern unter `test-results/load-YYYY-MM-DDTHH-MM-SSZ/`
   - Cleanup prüfen: `./check-leaks.sh --cleanup`

2. **100 Clients (nur wenn 50 stabil):**
   ```bash
   npm run test:load:100
   ```

3. **200 Clients (nur wenn 100 stabil):**
   ```bash
   npm run test:load:200
   ```

### Nachbereitung

1. **Cleanup verifizieren:**
   ```bash
   ./check-leaks.sh --cleanup > test-results/load-YYYY-MM-DDTHH-MM-SSZ/cleanup-report.json
   ```

2. **Zusammenfassung erstellen:**
   ```bash
   node scripts/generate-load-summary.mjs test-results/load-YYYY-MM-DDTHH-MM-SSZ/
   ```

3. **Artefakte archivieren:**
   - Git-Tag oder Release-Note verlinken
   - Hostprofil und Metriken im Release-Artefakt speichern

---

## Belastbarkeits-Aussagen

### Belastbare Aussagen (evidenzbasiert)

✅ **50 Clients:**
- Bei dokumentiertem Hostprofil (CPU, RAM, Docker-Limits)
- Mit Erfolgsrate ≥ 98 %, p95-Latenzen im Zielbereich
- Cleanup erfolgreich, keine Leaks
- **Aussage:** "50 gleichzeitige Clients bei Host-Profil X stabil unterstützt"

✅ **100 Clients:**
- Wenn 50-Client-Baseline stabil
- Erfolgsrate ≥ 95 %, p95-Latenzen im erweiterten Zielbereich
- Cleanup erfolgreich
- **Aussage:** "100 gleichzeitige Clients bei Host-Profil Y mit erweiterten Ressourcen unterstützt"

### Nicht belastbare Aussagen (ohne Evidenz)

❌ **"UnoSim unterstützt 200 Clients":**
- Ohne dokumentiertes Hostprofil
- Ohne 50/100-Client-Vorstufen
- Mit Mock-Tests statt realer Docker-Last
- Mit einzelnen Testläufen ohne Reproduzierbarkeit

❌ **"Skaliert beliebig":**
- Ohne dokumentierte Ressourcenlimits
- Ohne Queue-/Timeout-Verhalten unter Last
- Ohne Cleanup-Nachweis

---

## Test-Harness-Trennung: Real vs. Mock

### Reale Docker-Last (verbindlich für Kapazitätsaussagen)

**Merkmale:**
- Echter Express-Server mit `UNOSIM_SIMULATION_MODE=docker-sandbox`
- Echte `SandboxRunner` mit Docker-Containern
- Reale Compile-Zeiten (2–10 s pro Sketch)
- Echte WebSocket-Verbindungen über `ws`-Paket
- Docker-Ressourcenlimits werden wirksam

**Tests:**
- `tests/server/load-suite.test.ts` (mit realem Server)
- `tests/integration/concurrent-50-clients.test.ts` (mit realem Pool)
- `e2e/scalability-many-clients.spec.ts` (Playwright mit echten iframes)

**Aktivierung:**
```bash
# Standard (real, wenn Server läuft)
npm run test:load:50

# Mit explizitem Docker-Flag
DOCKER_SANDBOX_MODE=real npm run test:load:50
```

### Mock-/Synthetische Last (nur für Entwicklung/CI-Quick-Checks)

**Merkmale:**
- `MockSandboxRunner` ohne Docker
- Simulierte Compile-Zeiten (~20 ms)
- Keine echten Ressourcenlimits
- Schnell, aber nicht aussagekräftig für Produktion

**Tests:**
- `tests/server/services/scalability-stress.test.ts` (Mock-Pool-Logik)
- `tests/integration/concurrent-50-clients.test.ts` (kann mit Mock laufen)

**Warnung:** Mock-Tests dürfen nicht für Kapazitätsaussagen verwendet werden.

---

## Abbruchkriterien

Ein Lasttest wird abgebrochen, wenn:

1. **Hostprofil fehlt:** Keine dokumentierten CPU/RAM/Docker-Limits
2. **50-Client-Baseline rot:** Erfolgsrate < 95 % oder p95 > 20 s
3. **Cleanup fehlschlägt:** Container/Prozesse bleiben zurück
4. **Ressourcen-Overflow:** CPU > 95 % oder RAM > 98 % über > 30 s
5. **Queue-Deadlock:** Queue-Tiefe wächst monoton über > 60 s
6. **WebSocket-Massenausfall:** > 20 % Clients verbinden sich nicht innerhalb 60 s
7. **Server-Crash:** Prozess beendet sich oder wird inkompetent

---

## Historie

| Version | Datum | Änderungen |
| --- | --- | --- |
| 1.0.0 | 2026-09-06 | Initiale Version, Phase 3.4 implementiert |

---

## Referenzen

- `docs/phase-3.4-3.10-operational-readiness-plan.md` – Maßnahme 3.4
- `docs/SCALABILITY_100_STUDENTS.md` – Skalierungs-Ist und -Ziele
- `docs/TESTING_STANDARDS.md` – Teststandards, Heavy-Tests
- `package.json` – `test:load:50/100/200` Scripts
- `vitest.config.ts` – Load-Projekt-Konfiguration
- `playwright.scalability.config.ts` – Playwright-Scalability
- `tests/server/load-suite.test.ts` – Load-Test-Suite
- `tests/integration/concurrent-50-clients.test.ts` – 50-Client-Integration
- `e2e/scalability-many-clients.spec.ts` – E2E-Scalability
