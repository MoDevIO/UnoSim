# Funktionsbeschreibung: Skalierbarkeit – UnoSim

**Branch:** `feature/scalability-100-students`  
**Stand:** Mai 2026

---

## Inhaltsverzeichnis

1. [Überblick](#1-überblick)
2. [Zwei Ausführungsachsen: Server-Modus und Simulations-Modus](#2-zwei-ausführungsachsen-server-modus-und-simulations-modus)
3. [Compilierung: wann mit Docker, wann ohne](#3-compilierung-wann-mit-docker-wann-ohne)
4. [Simulation: wann mit Docker, wann ohne](#4-simulation-wann-mit-docker-wann-ohne)
5. [Zustände einer Client-Instanz](#5-zustände-einer-client-instanz)
6. [Umgang mit vielen gleichzeitigen Compile-Anfragen](#6-umgang-mit-vielen-gleichzeitigen-compile-anfragen)
7. [Umgang mit vielen gleichzeitigen Simulations-Anfragen](#7-umgang-mit-vielen-gleichzeitigen-simulations-anfragen)
8. [Warten auf freie Ressourcen und Starten nach Freigabe](#8-warten-auf-freie-ressourcen-und-starten-nach-freigabe)
9. [Verhalten bei Verbindungstrennung](#9-verhalten-bei-verbindungstrennung)
10. [Konfigurationsübersicht: relevante Parameter](#10-konfigurationsübersicht-relevante-parameter)
11. [Client-seitige Connect-Strategie](#11-client-seitige-connect-strategie)
---

## 1. Überblick

UnoSim kann bis zu 200 Schüler-Instanzen gleichzeitig betreiben. Jede Instanz läuft als eigenständiges Browser-Iframe und kommuniziert mit demselben Backend-Prozess. Das Backend verwaltet zwei voneinander unabhängige Ressourcen-Pools:

| Ressource | Verwaltet durch | Zweck |
|-----------|----------------|-------|
| Compile-Slots | `UnifiedGatekeeper` | Begrenzt parallele g++/arduino-cli-Prozesse |
| Simulations-Runner | `SandboxRunnerPool` | Stellt isolierte Laufzeitumgebungen bereit |

Wenn mehr Instanzen compilieren oder simulieren wollen als Ressourcen verfügbar sind, **warten sie in einer FIFO-Warteschlange**. Sobald ein Slot frei wird, wird die erste wartende Instanz automatisch gestartet – ohne Benutzereingriff.

---

## 2. Zwei Ausführungsachsen: Server-Modus und Simulations-Modus

Das System kennt zwei unabhängige Konfigurationsachsen, die zusammen die Laufzeittopologie bestimmen:

### Server-Modus (`serverMode`)

| Wert | Wann aktiv | Bedeutung |
|------|-----------|-----------|
| `"local"` | Entwicklung, `tsx`-Start | Server läuft direkt als Node.js-Prozess |
| `"docker"` | Produktion, `docker-compose up` | Server läuft als Docker-Container |

Gesetzt über `UNOSIM_SERVER_MODE`. Die Auflösungsreihenfolge lautet:

```
UNOSIM_SERVER_MODE   → wenn gesetzt und nicht leer: direkt verwenden
(leer)               → falls NODE_ENV === "production": "docker"
                       sonst:                           "local"
```

Der Rückfall auf `NODE_ENV` ist bewusst, weil `docker-compose.yml` bereits `NODE_ENV=production` als Umgebungsvariable setzt. Damit gilt: Wer in docker-compose startet, bekommt automatisch `serverMode = "docker"` – ohne `UNOSIM_SERVER_MODE` explizit setzen zu müssen. Die Variable `UNOSIM_SERVER_MODE` dient als **expliziter Override**, z. B. um im Container dennoch `"local"` zu erzwingen (Unit-Tests, Debug-Szenarien) oder auf einem Nicht-Docker-Produktiv-Host trotzdem `"docker"` zu signalisieren.

### Simulations-Modus (`simulationMode`)

| Wert | Wann aktiv | Bedeutung |
|------|-----------|-----------|
| `"local"` | Entwicklung ohne `FORCE_DOCKER` | Sketch läuft als nativer Kind-Prozess |
| `"docker-sandbox"` | Produktion oder `FORCE_DOCKER=1` | Jede Simulation bekommt einen eigenen Docker-Container |

Gesetzt über `UNOSIM_SIMULATION_MODE` oder das Legacy-Flag `FORCE_DOCKER`.

---

## 3. Compilierung: wann mit Docker, wann ohne

### 3a. Entwicklungsmodus (`serverMode = "local"`)

```
Browser → POST /api/compile
  → CompilerWithFallback.compile()
      → ArduinoCompiler.compile()   ← direkt, kein Worker-Thread
          → UnifiedGatekeeper (Compile-Slot)
              → arduino-cli compile (nativer Kindprozess)
```

**Warum kein Worker-Thread in der Entwicklung?**  
Die Worker-Threads (`compile-worker.ts`) laden Module über das `@shared/*`-Alias. Dieses Alias wird von `tsx` (dem Entwicklungs-Loader) nur im Haupt-Thread aufgelöst; in Worker-Threads ist es nicht verfügbar. Die Klasse `CompilerWithFallback` erkennt den Dev-Modus (`serverMode !== "docker"`) und weicht direkt auf `ArduinoCompiler` aus.

### 3b. Produktionsmodus (`serverMode = "docker"`)

```
Browser → POST /api/compile
  → CompilerWithFallback.compile()
      → CompilationWorkerPool.compile()   ← Worker-Thread-Pool (8 Threads)
          → compile-worker.ts (Worker-Thread)
              → ArduinoCompiler.compile()
                  → arduino-cli compile (nativer Kindprozess im Worker)
```

Der `CompilationWorkerPool` verteilt Compile-Anfragen gleichmäßig auf bis zu 8 Worker-Threads. Jeder Worker hält seine eigene temporäre Verzeichnisstruktur, sodass parallele `arduino-cli`-Aufrufe nicht kollidieren.

**Wichtig:** Diese Compilierung erzeugt eine fertige `*.hex`-Datei/ELF-Binary. Im Docker-Simulations-Modus (`simulationMode = "docker-sandbox"`) findet die Compilierung statt **innerhalb des Sandbox-Containers** (siehe Abschnitt 4b) – nicht über diesen HTTP-Pfad.

---

## 4. Simulation: wann mit Docker, wann ohne

### 4a. Lokaler Simulations-Modus (`simulationMode = "local"`)

```
WebSocket-Nachricht: start_simulation
  → SandboxRunner.runSketch()
      → ExecutionManager.runSketch()
          → Gatekeeper: Compile-Slot warten
          → LocalCompiler: Sketch compilieren (g++ nativer Prozess)
          → Gatekeeper: Slot freigeben
          → AVR-Binary als nativer Kindprozess starten
          → stdout/stderr → PinStateBatcher + SerialOutputBatcher → WebSocket
```

Kein Docker. Die Simulation läuft als isolierter Kindprozess auf dem Host. Geeignet für Entwicklung und Tests.

### 4b. Docker-Sandbox-Modus (`simulationMode = "docker-sandbox"`)

```
WebSocket-Nachricht: start_simulation
  → SandboxRunnerPool.acquireRunner()     ← wartet bei Bedarf in Queue
  → SandboxRunner.runSketch()
      → ExecutionManager.runSketch()
          → docker run unosim-sandbox:latest \
                --memory=256m --cpus=0.25 --pids-limit=50 \
                --network=none --read-only \
                [sketch-Verzeichnis als Volume]
                → arduino-cli compile + avr-Executable starten
          → DockerCompileSemaphore: max 8 parallele Compile-Phasen
          → stdout/stderr geparst → PinStateBatcher + SerialOutputBatcher → WebSocket
```

Jede Simulation läuft in einem vollständig isolierten, kurzlebigen Docker-Container:
- **Netzwerk:** deaktiviert (`--network=none`)
- **Dateisystem:** read-only (nur das Sketch-Verzeichnis ist beschreibbar)
- **Speicher:** max. 256 MB (deckt g++/cc1plus-Spitze, AVR-Runtime benötigt nur ~30 MB)
- **CPU:** 0,25 Kerne (25 % eines vCPUs)
- **PIDs:** max. 50 (verhindert Fork-Bomben)
- **Laufzeit:** max. 60 Sekunden

Der Container wird nach Beendigung der Simulation automatisch entfernt (`docker rm`). Das zugehörige temporäre Verzeichnis auf dem Host wird ebenfalls bereinigt.

**Sandbox-Image:** `unosim-sandbox:latest` – vorab gebaut, enthält `arduino-cli` + AVR-Toolchain. Wird nicht zur Laufzeit gebaut.

---

## 5. Zustände einer Client-Instanz

Jede Browser-Instanz durchläuft einen klar definierten Zustandsautomaten. Die Zustände werden im Debug-Header der UI sichtbar gemacht.

### 5a. Vollständiger Lebenszyklus

```
IDLE
  │
  ├─ (externe Start-Anfrage kommt, bevor WS verbunden ist)
  │    ↓
  │  QUEUED_FOR_COMPILING   ← simuliert Wartezeit auf Compilation-Ressource
  │    ↓
  ├─ (WS verbunden, Compile-Anfrage wird gesendet)
  │    ↓
  │  COMPILING              ← Gatekeeper-Slot belegt, g++ läuft
  │    │
  │    ├─ (Fehler)  → ERROR → IDLE
  │    │
  │    ↓ (Compile erfolgreich)
  │
  QUEUED_FOR_SIMULATION     ← alle SandboxRunner belegt, wartet in Pool-Queue
  │    ↓ (Runner verfügbar)
  │
  RUNNING                   ← Docker-Container/nativer Prozess aktiv
    │
    ├─ PAUSED               ← SIGSTOP gesendet, Container/Prozess eingefroren
    │    └─ RUNNING         ← SIGCONT gesendet, Fortsetzung
    │
    └─ IDLE                 ← Simulation beendet (Exit, Timeout, Stop-Befehl)
```

### 5b. Herleitung des Client-Zustands (`deriveClientState`)

Der sichtbare Client-Zustand wird aus drei unabhängigen Signalen hergeleitet:

| Priorität | Bedingung | Angezeigter Zustand |
|-----------|-----------|---------------------|
| 1 | `pendingExternalStart === true` | `QUEUED_FOR_COMPILING` |
| 2 | `compilationStatus === "compiling"` | `COMPILING` |
| 3 | `simulationStatus === "queued"` | `QUEUED_FOR_SIMULATION` |
| 4 | `simulationStatus === "running"` | `RUNNING` |
| 5 | `simulationStatus === "paused"` | `PAUSED` |
| 6 | `compilationStatus === "error"` | `ERROR` |
| — | (sonst) | `IDLE` |

**Sonderfall `pendingExternalStart`:** Wenn eine `START_SIMULATION`-Nachricht über die externe API eintrifft, bevor die WebSocket-Verbindung aufgebaut ist, wird `simulationStatus` client-seitig auf `"queued"` gesetzt – obwohl die Instanz tatsächlich auf die Compilation wartet, nicht auf einen Simulations-Runner. Ohne die `pendingExternalStart`-Prüfung würde das Badge fälschlicherweise `QUEUED_FOR_SIMULATION` zeigen.

### 5c. Server-seitige Zustände (intern)

Innerhalb des `SandboxRunner` gibt es einen eigenen Zustandsautomaten (`SimulationState`):

| Zustand | Bedeutung |
|---------|-----------|
| `STOPPED` | Ruhezustand, bereit für die nächste Simulation |
| `STARTING` | `runSketch()` wurde aufgerufen, Vorbereitung läuft |
| `RUNNING` | Simulation/Prozess aktiv |
| `PAUSED` | Prozess via SIGSTOP eingefroren |
| `ERROR` | Fehler aufgetreten (Gatekeeper-Timeout, Docker-Fehler) |

---

## 6. Umgang mit vielen gleichzeitigen Compile-Anfragen

### Der UnifiedGatekeeper (Compile-Semaphore)

Wenn viele Instanzen gleichzeitig compilieren wollen, koordiniert der `UnifiedGatekeeper` den Zugang:

```
Instanz 1 ──→ acquireCompileSlot() → Slot verfügbar → Compile läuft sofort
Instanz 2 ──→ acquireCompileSlot() → Slot verfügbar → Compile läuft sofort
...
Instanz N ──→ acquireCompileSlot() → Alle Slots belegt → Wartet in Prioritäts-Queue
                                                          (max. 30 Sekunden)
                                                          ↓
                                         onCompileQueued() → Client-Badge: COMPILING
```

**Kapazität:**  
`maxConcurrent = max(1, Anzahl CPU-Kerne − 1)`

Beispiele:
- 4-Kern-System → 3 gleichzeitige Compiles
- 8-Kern-System → 7 gleichzeitige Compiles
- 16-Kern-System → 15 gleichzeitige Compiles

Überschreibbar via `COMPILE_MAX_CONCURRENT`.

**Prioritäten:**

| Priorität | Verwendung |
|-----------|-----------|
| `HIGH` | Vom Benutzer ausgelöste Simulationsstarts |
| `NORMAL` | Reguläre API-Compile-Anfragen |
| `LOW` | Hintergrundaufgaben |

HIGH-Anfragen werden bevorzugt vor NORMAL-Anfragen in der Queue eingereiht.

**Timeouts:**
- Slot-Wartezeit max. **30 Sekunden** (`compileGatekeeperAcquireMs`). Danach: Fehler, Badge wechselt zu `ERROR`.

  **Warum 30 Sekunden?** Diese Grenze deckt zwei Szenarien ab:

  1. **Warteschlangenzeit vs. Compile-Zeit trennen.** Die eigentliche Compilation dauert bis zu 60 Sekunden (eigener Timeout). Die 30 s sind die maximale Zeit, die eine Instanz *darauf wartet, überhaupt compilieren zu dürfen*. Beide Timeouts zusammen ergeben eine Worst-Case-Gesamtzeit von ~90 s – gerade noch akzeptabel für ein Unterrichtssetting.

  2. **Schutz vor Lock-Starvation.** Der Lock-TTL beträgt 60 Sekunden. Stirbt ein Prozess, während er einen Compile-Slot hält, wird der Lock nach spätestens 60 s automatisch freigegeben (Deadlock-Prävention). Mit einer Acquire-Wartezeit von 30 s ist garantiert, dass eine wartende Instanz den freigegebenen Slot noch innerhalb ihres eigenen Timeouts bemerkt, ohne selbst abzubrechen.

  Bei einem massiven Burst (z. B. alle 200 Instanzen gleichzeitig) kann der Gatekeeper auf einem 16-Kern-System 15 Compiles parallel ausführen. Dauert jedes Compile ~15 s, schafft er ~14 Batches à 15 Instanzen in 30 s – das reicht für die ersten ~210 Instanzen. In der Praxis verteilen sich Start-Klicks im Unterricht über mehrere Sekunden, sodass der Burst deutlich flacher ist. Der Wert ist nicht per Env-Variable konfigurierbar, kann aber direkt in `config.ts` (`compileGatekeeperAcquireMs`) angepasst werden.
- Lock-TTL: **60 Sekunden** – verhindert Deadlocks, wenn ein Slot nicht manuell freigegeben wird.
- Prüfintervall für abgelaufene Locks: **5 Sekunden**.
- Queue-Größenlimit: **500 Einträge** – verhindert unbegrenztes Speicherwachstum unter Extremlast.

### Zusätzliche Begrenzung im Docker-Modus (DockerCompileSemaphore)

Im Docker-Simulations-Modus compiliert `arduino-cli` **innerhalb des Containers**. Laufen zu viele Compile-Phasen gleichzeitig, führt das zu CPU-Starvation. Ein zweiter Semaphor (`DockerCompileSemaphore`) begrenzt die simultanen Docker-Compile-Phasen auf **8** (konfigurierbar via `DOCKER_COMPILE_CONCURRENT`). Der Slot wird freigegeben, sobald der Runtime-Start (`[RUNTIME_START]`-Marker im stderr) erkannt wird.

---

## 7. Umgang mit vielen gleichzeitigen Simulations-Anfragen

### Der SandboxRunnerPool

Jede laufende Simulation belegt einen Simulations-Runner. Der Pool verwaltet diese Ressource:

```
Beim Serverstart:
  → 5 Warm-Runner vorinitialisiert (sofort verfügbar, kein Startup-Overhead)

Client 1–5:     Runner sofort aus dem Warm-Pool
Client 6–200:   On-Demand-Erstellung, bis maxRunners erreicht
Client 201+:    Wartet in FIFO-Queue (max. 60 Sekunden)
                → Client erhält sofort: { status: "queued" }
                → Client-Badge wechselt zu: QUEUED_FOR_SIMULATION
```

**Pool-Konfiguration:**

| Parameter | Entwicklung | Produktion (docker-compose) |
|-----------|-------------|------------------------------|
| `minRunners` | 5 | 5 |
| `maxRunners` | 5 (= min) | 200 |
| `idleTimeoutMs` | 120 s | 300 s |
| `acquireTimeoutMs` | 60 s | 60 s |
| `maxQueueSize` | 500 | 500 |

**On-Demand-Wachstum:** Zwischen `minRunners` und `maxRunners` werden neue Runner bei Bedarf sofort erstellt (kein Warten). Oberhalb von `maxRunners` wird gewartet. Runner, die über den Warm-Floor (`minRunners`) hinausgehen und länger als `idleTimeoutMs` unbenutzt sind, werden automatisch abgebaut.

---

## 8. Warten auf freie Ressourcen und Starten nach Freigabe

### 8a. Warten auf einen Compile-Slot

```
1. Instanz X sendet POST /api/compile (oder start_simulation mit Compile-Phase)
2. UnifiedGatekeeper.acquireCompileSlotHighPriority() aufgerufen
3. Alle Slots belegt → Instanz X wird in Prioritäts-Queue eingereiht
4. onCompileQueued()-Callback ausgelöst → Client-Badge: COMPILING
   (Der Badge zeigt COMPILING, auch wenn der Slot noch nicht frei ist – das ist bewusst,
    da die Wartezeit aus Nutzersicht Teil des Compile-Vorgangs ist)
5. Slot-Timeout-Timer (30 s) gestartet

Sobald ein aktiver Compile fertiggestellt wird:
6. releaseCompileSlot() ruft createReleaseFunction() auf
7. availableSlots++
8. Nächste Aufgabe aus der Prioritäts-Queue wird entnommen und gestartet (grant())
9. Instanz X beginnt mit der Compilation
10. Nach Abschluss: releaseCompileSlot() → nächste wartende Instanz, usw.
```

### 8b. Warten auf einen Simulations-Runner

```
1. WebSocket-Nachricht: start_simulation
2. Raten-Limiter-Prüfung (abgelehnt → Fehlermeldung, kein weiterer Fortschritt)
3. Pool-Zustand prüfen: availableRunners === 0 && totalRunners >= maxRunners?
   → JA: Client erhält sofort { status: "queued" } (Badge: QUEUED_FOR_SIMULATION)
4. AbortController erstellt und auf clientState.queueAbortController gesetzt
5. pool.acquireRunner(abortController.signal) aufgerufen → blockiert asynchron

Sobald ein aktiver Runner freigegeben wird:
6. releaseRunner() → Runneraustand zurücksetzen (stop(), Listener entfernen)
7. Reset-Timeout-Guard: max. 10 Sekunden; bei Überschreitung → stuck Runner wird
   durch frischen Runner ersetzt
8. Nächste Eintrags aus FIFO-Queue entnommen: entry.resolve(freeRunner.runner)
9. acquireRunner() gibt den Runner an Instanz X zurück (await beendet)
10. clientState.queueAbortController = null
11. Instanz X erhält:
    - { type: "simulation_status", status: "running" }
    - { type: "compilation_status", gccStatus: "compiling", workerIndex, workerTotal }
12. runSketch() startet (Compile + Simulation)
```

### 8c. Zeitlicher Ablauf einer vollständigen Simulation (Sequenzdiagramm)

```
Browser-Instanz          WebSocket-Handler           SandboxRunnerPool         Docker/Prozess
      │                        │                             │                       │
      │── start_simulation ───>│                             │                       │
      │                        │── acquireRunner(signal) ───>│                       │
      │                        │   [Pool voll? → Queue]      │                       │
      │<── { status:"queued" } ─│                            │                       │
      │                        │                             │                       │
      │     [... warten ...]   │                             │                       │
      │                        │     [anderer Runner frei]  │                       │
      │                        │<── runner ─────────────────│                       │
      │<── { status:"running" }─│                            │                       │
      │<── { gccStatus:"compiling", workerIndex:2, workerTotal:5 }                  │
      │                        │── runner.runSketch() ───────────────────────────>  │
      │                        │   [Compile-Gatekeeper-Slot]                        │
      │                        │   [docker run ... oder lokaler Prozess]            │
      │<── serial_output ───────│<────────────────────────────────────────────────  │
      │<── pin_state ──────────│<────────────────────────────────────────────────  │
      │                        │                                                    │
      │── stop_simulation ────>│                             │                       │
      │                        │── safeReleaseRunner() ─────>│                       │
      │                        │   [reset, nächste Queue-Instanz starten]           │
      │<── { status:"stopped" }─│                            │                       │
```

---

## 9. Verhalten bei Verbindungstrennung

Trennt ein Client die WebSocket-Verbindung, während er in der Warteschlange auf einen Simulations-Runner wartet, greift der **Abort-on-Disconnect**-Mechanismus:

```
1. WebSocket-Close-Event empfangen
2. clientState.queueAbortController?.abort() aufgerufen
3. Pool-Warteschlange: onAbort()-Handler entfernt Eintrag aus Queue
4. clearTimeout(entry.timeout) → kein Timeout-Fehler
5. Promise verworfen: "acquire cancelled (client disconnected)"
6. Slot-Position in der Queue wird sofort frei → nächste Instanz rückt vor
```

**Ohne diesen Mechanismus** würde die Queue-Position 60 Sekunden lang blockiert bleiben, bis der Timeout eintritt – ein signifikanter Ressourcen-Verlust bei 200 gleichzeitigen Instanzen.

Läuft eine Simulation bereits, wenn der Client trennt:

```
1. WebSocket-Close-Event
2. safeReleaseRunner() aufgerufen (Grund: "ws-close")
3. Runner wird zurückgesetzt
4. Nächste wartende Instanz erhält den Runner
```

---

## 10. Konfigurationsübersicht: relevante Parameter

Alle Parameter werden in `server/config.ts` als Single Source of Truth verwaltet und können über Umgebungsvariablen überschrieben werden.

### Simulations-Pool (`config.sandbox.pool`)

| Parameter | Env-Variable | Entwicklung | Produktion | Bedeutung |
|-----------|-------------|-------------|------------|-----------|
| `minRunners` | `SANDBOX_POOL_MIN_RUNNERS` | 5 | 5 | Warm-Runner beim Start |
| `maxRunners` | `SANDBOX_POOL_MAX_RUNNERS` | 5 | 200 | Maximale Runner-Anzahl |
| `idleTimeoutMs` | `SANDBOX_POOL_IDLE_TIMEOUT_MS` | 120 000 ms | 300 000 ms | Idle-Runner werden entfernt |
| `acquireTimeoutMs` | _(hardcoded)_ | 60 000 ms | 60 000 ms | Max. Wartezeit in Queue |
| `maxQueueSize` | _(hardcoded)_ | 500 | 500 | Queue-Größenlimit |

### Container-Ressourcen (`config.sandbox.resources`)

| Parameter | Env-Variable | Wert | Bedeutung |
|-----------|-------------|------|-----------|
| `memoryMB` | `SANDBOX_MEMORY_MB` | 256 MB | Speicher-Ceiling pro Container |
| `cpuLimit` | `SANDBOX_CPU_LIMIT` | 0.25 | CPU-Anteil pro Container |
| `pidsLimit` | _(hardcoded)_ | 50 | Max. Prozesse pro Container |
| `maxExecutionTimeSec` | _(hardcoded)_ | 60 s | Laufzeit-Limit |

### Compilation (`config.compilation`)

| Parameter | Env-Variable | Entwicklung | Produktion | Bedeutung |
|-----------|-------------|-------------|------------|-----------|
| `workerCount` | `WORKER_COUNT` | ½ × CPU-Kerne | 8 | Worker-Threads für Compilation |
| `maxConcurrent` | `COMPILE_MAX_CONCURRENT` | CPU-Kerne − 1 | CPU-Kerne − 1 | Gatekeeper-Semaphor |
| `dockerCompileConcurrent` | `DOCKER_COMPILE_CONCURRENT` | 8 | 8 | Simultane Docker-Compile-Phasen |
| `timeoutMs` | _(hardcoded)_ | 60 000 ms | 60 000 ms | Compile-Timeout |

### Timeouts (`config.timeouts`)

| Parameter | Wert | Bedeutung |
|-----------|------|-----------|
| `compileGatekeeperAcquireMs` | 30 000 ms | Max. Wartezeit auf Compile-Slot |
| `gatekeeperLockTTLMs` | 60 000 ms | Deadlock-Prävention (Lock-Ablauf) |
| `gatekeeperLockCheckIntervalMs` | 5 000 ms | Prüfintervall für abgelaufene Locks |
| `batcherTickIntervalMs` | 50 ms | Pin-State- und Serial-Output-Batching |
| `registryWaitModeAfterStartMs` | 5 000 ms | IO-Registry-Sammelzeit nach Sketch-Start |

---

## 11. Client-seitige Connect-Strategie

Jede UnoSim-Instanz im Browser verwaltet eine einzige persistente WebSocket-Verbindung
über den `WebSocketManager` (`client/src/lib/websocket-manager.ts`).
Bei einem Klassen-Szenario mit 200 Iframes auf einer einzigen Seite müssen
alle Instanzen koordiniert verbinden, ohne den HTTP/1.1-Connection-Pool des Browsers
zu erschöpfen (Limit: 6 gleichzeitige TCP-Verbindungen pro Host).

### Iframe-Stagger (Donnerherd-Vermeidung)

| Parameter | Wert | Begründung |
|-----------|------|-----------|
| `IFRAME_STAGGER_MAX_MS` | **10 000 ms** | Verteilt bis zu 200 Iframes gleichmäßig über 10 Sekunden, was eine Spitzenrate von ~20 Connect-Versuchen/Sekunde ergibt. Der Wert 3 000 ms (veraltet) erzeugte ~67 Versuche/Sekunde, was bei aktivem HTTP-Polling (Health, Status) zu Pool-Starvation führte. |

Beim ersten Verbindungsaufbau wählt jeder Iframe einen zufälligen Stagger-Wert
`δ ∈ [0, IFRAME_STAGGER_MAX_MS]` und wartet diesen vor dem ersten `connect()`-Aufruf ab.
Der Hauptframe (kein Iframe) überspringt den Stagger (`inIframe = false`).

```
Iframe 0:  δ = 230 ms  →  WebSocket-Upgrade bei t = 0.23 s
Iframe 1:  δ = 5 420 ms →  WebSocket-Upgrade bei t = 5.42 s
Iframe 2:  δ = 8 900 ms →  WebSocket-Upgrade bei t = 8.90 s
...
```

### Connection-Timeout

| Parameter | Wert | Begründung |
|-----------|------|-----------|
| `CONNECTION_TIMEOUT_MS` | **30 000 ms** | Gibt dem WS-Upgrade-Handshake 30 Sekunden, bevor eine Verbindung als fehlgeschlagen gilt. Früher 10 000 ms – bei 200 Iframes können WS-Upgrade-Anfragen mehrere Sekunden im Browser-Queue warten, bis ein HTTP/1.1-Slot frei wird. 10 s war zu knapp. |

### Reconnect-Policy (Exponential Backoff, unbegrenzt)

| Parameter | Wert | Begründung |
|-----------|------|-----------|
| `RECONNECT_MAX_ATTEMPTS` | **`Infinity`** | Keine permanente Aufgabe. Der Manager bleibt dauerhaft im Zustand `"reconnecting"`, bis die Verbindung erfolgreich ist. Früher 15 Versuche – nach 15 fehlgeschlagenen Versuchen (~8 Minuten Backoff) blieb der Client endlos im Zustand `"disconnected"` mit ausgegrautem Start-Button. |
| `RECONNECT_BASE_DELAY_MS` | 1 000 ms | Startintervall für exponentiellen Backoff |
| `RECONNECT_MAX_DELAY_MS` | 30 000 ms | Cap: maximale Wartezeit zwischen zwei Versuchen |

Backoff-Formel (mit Jitter):
```
delay = min(1000 × 2^attempt + rand(0, 1000), 30 000) ms
```

Typische Backoff-Reihe: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s, 30 s, … (danach konstant 30 s ± Jitter).

### Polling-Intervalle (HTTP-Hintergrundabfragen pro Instanz)

| Abfrage | Parameter | Wert (neu) | Wert (alt) | Frequenz bei 200 Instanzen |
|---------|-----------|-----------|-----------|---------------------------|
| `/api/health` | `healthPollIntervalMs` | **15 000 ms** | 5 000 ms | 800 Anfragen/min (früher: 2 400) |
| `/api/status` | `statusPollIntervalMs` | **60 000 ms** | 15 000 ms | 200 Anfragen/min (früher: 800) |
| `/api/config` | _(einmalig beim Start)_ | – | – | 200 Anfragen/Start |

Zusätzlich senden beide Polling-Anfragen den Header `Connection: close`, damit der
Browser den TCP-Socket nach dem Response sofort freigibt statt ihn im Keep-Alive-Pool
zu halten. Das reduziert den dauerhaft belegten Slot-Anteil und schafft mehr Kapazität
für WS-Upgrade-Handshakes.

### Server-seitige Ergänzungen

| Einstellung | Wert | Begründung |
|-------------|------|-----------|
| `perMessageDeflate` | **`false`** | Deaktiviert zlib-Komprimierung. Das frühere `concurrencyLimit: 10` blockierte bei gleichzeitigen Pin-State-Bursts von 200 Clients. Bandbreiten-Overhead ist im LAN/Docker-Kontext vernachlässigbar. |
| `httpServer.keepAliveTimeout` | **65 000 ms** | Verhindert ECONNRESET, wenn ein Reverse-Proxy (nginx: 75 s, AWS ALB: 60 s) eine Verbindung schließt, die Node schon freigegeben hat. |
| `httpServer.headersTimeout` | **70 000 ms** | Muss > `keepAliveTimeout` sein, um Race auf gepipelinete Anfragen zu vermeiden. |
