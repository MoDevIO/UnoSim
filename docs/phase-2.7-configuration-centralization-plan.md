# Phase-2.7-Ausführungsplan: Konfigurationszugriffe zentralisieren

Status: planned

Grundlage: `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md`, Abschnitt **2.7 Konfigurationsbündelung** und Befund **Konfigurationsdrift**.

Ziel: verstreute Server-Konfigurationswerte schrittweise über `server/config.ts` bündeln, ohne Semantikänderung und ohne pauschale Migration.

Keine Codeänderungen in diesem Schritt.

## Scope / Non-Scope

### Scope

- Inventarisierte Server-Konfigurationszugriffe schrittweise zentralisieren.
- Vorhandene zentrale Werte in `server/config.ts` bevorzugen.
- Teilsteps klein, unabhängig und jeweils grün haltbar halten.
- Sicherheits-, Worker-, Gatekeeper-, Cache- und Timeout-Spezialfälle getrennt behandeln.
- Pro Teilstep klare Commit-Grenzen, Tests, Gates und Abbruchkriterien definieren.

### Non-Scope

- Keine Codeänderungen durch diesen Plan selbst.
- Keine pauschale Migration aller Werte nach `server/config.ts`.
- Keine neuen Env-Variablen ohne zwingenden Bedarf.
- Keine Semantikänderungen.
- Keine Testanpassungen.
- Keine neuen Abstraktionen ohne klaren Bedarf.
- Keine Vermischung unterschiedlicher Risikoklassen in einem Commit.

## Statusstruktur

| Status | Bedeutung |
| --- | --- |
| `planned` | Teilstep ist geplant, aber noch nicht begonnen. |
| `in progress` | Teilstep wird gerade umgesetzt. |
| `completed` | Teilstep ist umgesetzt, geprüft und commitfähig/committed. |

## Kritische Prüfung des bisherigen ersten Umsetzungsschnitts

Der frühere Vorschlag, gleichzeitig diese Dateien zu ändern:

- `server/index.ts`
- `server/services/sandbox/docker-manager.ts`
- `server/services/sandbox/execution-phases/start-phase.ts`

ist für einen weniger leistungsfähigen Agenten **zu breit**, weil er drei Risikoklassen mischt:

1. Start-/Logging-Umfeld
2. Sandbox-Output-/Timeout-Limits
3. Docker-Container-Sicherheitsparameter

Empfehlung: in **3 separate Commits** aufteilen.

# Gesamtregeln für alle Teilsteps

## Immer unverändert lassen

- keine neuen Env-Variablen ohne zwingenden Bedarf
- keine Testanpassungen
- keine Semantikänderung
- keine Umbenennung bestehender öffentlicher Config-Keys
- keine Änderung an Docker-Images, Docker-Host, Cache-Pfaden oder Worker-Verhalten, außer im expliziten Teilstep
- keine Änderung an `tests/**`, außer ein späterer separater Teststep fordert das ausdrücklich

## Standard-Gates nach jedem Code-Teilstep

Minimal:

- `npm run check`
- relevante Unit-/Integrationstests je Teilstep

Für riskantere Steps zusätzlich:

- `npm run build`
- ggf. `npm run test:integration`
- ggf. Smoke-Test mit `npm run dev` oder `npm run dev:e2e`

Sonar-Gate:

- Nach finalem Phase-2.7-Stand:
  - SonarQube-Analyse der geänderten Dateien
  - im vollständigen PR-Kontext: `npm run sonar`, falls Token/Server verfügbar

---

# Teilstep 2.7.1 — Start-Logging auf vorhandene Config umstellen

Status: completed

## Zweck

Einen direkten `process.env`-Zugriff entfernen, ohne Verhalten zu ändern.

## Dateien

- `server/index.ts`

## Exakte Stelle/Wert

Aktuell:

- `server/index.ts`
- Startup-Konfigurationsblock
- Zeile mit:
  - `process.env.NODE_ENV ?? "undefined"`

Ändern zu:

- `config.nodeEnv`

## Unverändert lassen

- `config.nodeEnv` selbst in `server/config.ts`
- `app.get("env")`
- `serverMode`
- `simulationMode`
- Port-/Host-Bindung
- alle Logs außer der `NODE_ENV`-Zeile

## Erwarteter semantischer Effekt

Keiner.

`config.nodeEnv` ist derzeit definiert als:

- `process.env.NODE_ENV ?? "development"`

Achtung: Der sichtbare Logwert ändert sich nur in einem Randfall:
- vorher bei fehlendem `NODE_ENV`: `"undefined"`
- danach: `"development"`

Das ist kein Runtime-Verhalten, aber ein beobachtbarer Log-Unterschied. Falls absolute Log-Kompatibilität nötig ist, diesen Step zurückstellen oder `config.rawNodeEnv` einführen. Für einen sicheren ersten Schnitt ist die Änderung trotzdem vertretbar, weil `config.ts` ausdrücklich Startup-Defaults zentralisiert.

## Notwendige Tests

- `npm run check`
- optional: `npm run test:unit`

## Relevante bestehende Tests

Keine spezifischen Tests bekannt; Änderung betrifft nur Konsolenausgabe.

## Build-/Sonar-Gates

- TypeScript: `npm run check`
- Sonar: keine neuen Issues erwartet

## Smoke-Test

Optional:

- `npm run dev`

Nur prüfen:
- Server startet
- Startup-Log zeigt `NODE_ENV`

## Abbruchkriterien

Abbrechen, wenn:

- TypeScript-Fehler entstehen
- Startup-Log/Tests explizit `"undefined"` erwarten
- `config.nodeEnv` zyklische Initialisierung verursacht

## Commit-Grenze

Nur `server/index.ts`.

## Commit-Message

`[Phase 2.7.1] Use central nodeEnv in startup logging`

---

# Teilstep 2.7.2 — DockerManager Output-/Runtime-Limits aus bestehender Sandbox-Config lesen

Status: completed

## Zweck

Klare Duplikate zu bereits vorhandenen zentralen Werten entfernen.

## Dateien

- `server/services/sandbox/docker-manager.ts`
- ggf. nur Import ergänzen:
  - `server/config.ts` via `../../config` oder passend relativ

## Exakte Stellen/Werte

Aktuell in `DockerManager`:

- `maxOutputBytes: 100 * 1024 * 1024`
- `maxExecutionTimeSec: 60`

Diese Werte existieren bereits zentral:

- `config.sandbox.resources.maxOutputBytes`
- `config.sandbox.resources.maxExecutionTimeSec`

Änderung:

- lokale `SANDBOX_CONFIG` entweder entfernen oder auf zentrale Werte umstellen
- `consumeOutputBudget()` soll weiterhin denselben Grenzwert verwenden
- Timeout-Fallback über `normalizeSimulationTimeout()` darf nicht verändert werden

## Unverändert lassen

- `normalizeSimulationTimeout(executionTimeout)`
- `executionTimeout` aus Run-Options
- Kill-Verhalten:
  - `SIGKILL`
  - Fehlermeldung `"Output size limit exceeded"`
- Callback-Reihenfolge
- Compile-/Runtime-Erkennung
- Stderr-/Stdout-Parsing

## Erwarteter semantischer Effekt

Keiner.

Die zentralen Defaults entsprechen aktuell den lokalen Werten:

- `maxOutputBytes = 100 * 1024 * 1024`
- `maxExecutionTimeSec = 60`

Zusätzlicher Effekt nur bei Env-/Config-Override:
- künftig greift `SANDBOX_MEMORY_MB` nicht relevant
- künftig würde ein zentral geänderter `maxOutputBytes`/`maxExecutionTimeSec` auch `DockerManager` erreichen

Da diese beiden Werte aktuell nicht per Env überschreibbar sind, bleibt Verhalten identisch.

## Notwendige Tests

- `npm run check`
- gezielt:
  - DockerManager-Test, falls vorhanden:
    - `tests/server/services/sandbox/docker-manager.test.ts`

Falls kein Einzelscript vorhanden:

- `npm run test:unit`

## Relevante bestehende Tests

- `tests/server/services/sandbox/docker-manager.test.ts`
  - prüft Timeout-Fallback `60_000`
  - prüft Output-Limit nahe `100 * 1024 * 1024`

## Build-/Sonar-Gates

- `npm run check`
- Sonar-Dateianalyse für:
  - `server/services/sandbox/docker-manager.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- DockerManager-Tests andere Millisekunden-/Sekundenwerte zeigen
- Output-Limit-Test fehlschlägt
- Importzyklus entsteht
- `normalizeSimulationTimeout(undefined)` nicht mehr `60` Sekunden ergibt

## Commit-Grenze

Nur `server/services/sandbox/docker-manager.ts`.

## Commit-Message

`[Phase 2.7.2] Read DockerManager limits from server config`

---

# Teilstep 2.7.3 — Docker `pidsLimit` aus bestehender Sandbox-Config verwenden

Status: completed

## Zweck

Container-Sicherheitslimit nicht doppelt hart kodieren.

## Dateien

- `server/services/sandbox/execution-phases/start-phase.ts`
- ggf. keine neue Config nötig, weil `SANDBOX_CONFIG` bereits importiert ist
- ggf. `server/services/sandbox/execution-manager.ts`, falls `SANDBOX_CONFIG` noch kein `pidsLimit` enthält

## Exakte Stellen/Werte

Aktuell:

- `start-phase.ts`
  - `pidsLimit: 50`

Zentral vorhanden:

- `server/config.ts`
  - `config.sandbox.resources.pidsLimit: 50`

Aktuelle lokale abgeleitete Konstante:

- `server/services/sandbox/execution-manager.ts`
  - `SANDBOX_CONFIG` enthält:
    - `maxMemoryMB`
    - `cpuLimit`
    - `maxExecutionTimeSec`
    - `maxOutputBytes`
  - enthält derzeit **nicht** `pidsLimit`

Empfohlene Änderung:

1. In `execution-manager.ts`:
   - `pidsLimit: config.sandbox.resources.pidsLimit` zu `SANDBOX_CONFIG` ergänzen
2. In `start-phase.ts`:
   - `pidsLimit: SANDBOX_CONFIG.pidsLimit`

## Unverändert lassen

- Docker-Command-Aufbau
- Memory-/CPU-Werte
- Image-Name
- Container-Name
- Command
- Security-Flags:
  - `noNetwork`
  - `readOnlyFs`
  - `dropCapabilities`
- Wert `50`

## Erwarteter semantischer Effekt

Keiner.

Nur Quelle des identischen Werts ändert sich.

## Notwendige Tests

- `npm run check`
- gezielt:
  - `tests/server/services/docker-command-builder.test.ts`
  - `tests/server/services/execution-manager-config.test.ts`
  - falls vorhanden: Start-Phase-/Execution-Manager-Tests

Sonst:

- `npm run test:unit`

## Relevante bestehende Tests

- `tests/server/services/docker-command-builder.test.ts`
- `tests/server/services/execution-manager-config.test.ts`
- `tests/server/services/sandbox-runner.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- Sonar-Dateianalyse:
  - `server/services/sandbox/execution-manager.ts`
  - `server/services/sandbox/execution-phases/start-phase.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- `SANDBOX_CONFIG`-Typisierung fehlschlägt
- Docker-Command-Test geänderte Args zeigt
- `--pids-limit` fehlt oder anderer Wert entsteht

## Commit-Grenze

Nur:

- `server/services/sandbox/execution-manager.ts`
- `server/services/sandbox/execution-phases/start-phase.ts`

## Commit-Message

`[Phase 2.7.3] Use configured sandbox PID limit`

---

# Teilstep 2.7.4 — Arduino CLI Timeout zentralen Compile-Timeout verwenden

Status: deferred

Deferred-Begründung: Die Realität weicht vom Plan ab. `CLICompileConfig` enthält keinen Timeoutwert; eine Umsetzung wäre nicht nur ein Wertetausch, sondern ein zusätzlicher Import/API-Umbau. Wegen der Planvorgabe, bei abweichender Realität zu stoppen, wurde dieser Teilstep nicht umgesetzt.

## Zweck

Einzelnen Compile-Timeout vereinheitlichen, ohne `LocalCompiler` oder `ProcessExecutor` anzufassen.

## Dateien

- `server/services/compiler/cli-runner.ts`

## Exakte Stelle/Wert

Aktuell:

- `timeout: 60000`

Zentral vorhanden:

- `config.compilation.timeoutMs = 60_000`

Ändern:

- `timeout: config.timeoutMs` falls Funktion bereits `CLICompileConfig config` nutzt
- oder `timeout: compileConfig.timeoutMs`, falls Name angepasst werden muss

Vor Änderung genau prüfen:
- In `cli-runner.ts` gibt es bereits einen Parameter/Typ namens `config`.
- Nicht versehentlich `server/config.ts` als `config` importieren und Namenskonflikt erzeugen.

## Unverändert lassen

- `ProcessExecutor.execute()`
- CLI-Args
- Build-Pfad-Discovery
- Error parsing
- Timeoutwert effektiv `60_000`

## Erwarteter semantischer Effekt

Keiner.

## Notwendige Tests

- `npm run check`
- relevante Compiler-Tests:
  - `tests/server/services/arduino-compiler.test.ts`
  - `tests/server/services/arduino-compiler-line-numbers.test.ts`
  - ggf. `tests/server/workers/compile-worker-utils.test.ts`

Falls unsicher:

- `npm run test:unit`

## Relevante bestehende Tests

- `tests/server/services/arduino-compiler.test.ts`
- `tests/server/services/arduino-compiler-line-numbers.test.ts`
- `tests/server/routes/compiler.routes.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- Sonar-Dateianalyse:
  - `server/services/compiler/cli-runner.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- `CLICompileConfig` keinen Timeoutwert enthält
- zusätzliche Config-Imports nötig werden und Namenskonflikte entstehen
- Tests zeigen, dass `60000` bewusst unabhängig von `config.compilation.timeoutMs` ist

## Commit-Grenze

Nur `server/services/compiler/cli-runner.ts`.

## Commit-Message

`[Phase 2.7.4] Use central compilation timeout for Arduino CLI`

---

# Teilstep 2.7.5 — Compile-Route-Cache-Konfiguration zentralisieren

Status: completed

## Zweck

HTTP-Compile-Route-Cache-Werte aus `server/routes.ts` nach `server/config.ts` verschieben.

## Dateien

- `server/config.ts`
- `server/routes.ts`

## Exakte Stellen/Werte

Aktuell:

- `server/routes.ts`
  - `new CompilationCache(100)`
  - `const CACHE_TTL = 5 * 60 * 1000`

Neue zentrale Werte, ohne neue Env-Variablen:

- `config.compilation.routeCacheMaxEntries: 100`
- `config.compilation.routeCacheTtlMs: 5 * 60 * 1000`

Oder neutraler:

- `config.compilation.resultCacheMaxEntries`
- `config.compilation.resultCacheTtlMs`

Empfohlen wegen Klarheit:

- `resultCacheMaxEntries`
- `resultCacheTtlMs`

## Unverändert lassen

- Hash-Funktion
- Cache-Key
- LRU-Verhalten
- TTL-Wert
- `registerCompilerRoutes` Dependency-Injection
- Name `CACHE_TTL` in Route kann lokal bleiben, wenn Wert aus Config kommt

## Erwarteter semantischer Effekt

Keiner.

## Notwendige Tests

- `npm run check`
- gezielt:
  - `tests/server/routes/compiler.routes.test.ts`
- ggf.:
  - `npm run test:unit`

## Relevante bestehende Tests

- `tests/server/routes/compiler.routes.test.ts`
  - enthält TTL-Erwartungen mit `5 * 60 * 1000`
- Cache-bezogene Tests:
  - `tests/server/cache-optimization.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- Sonar-Dateianalyse:
  - `server/config.ts`
  - `server/routes.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- Tests TTL über DI bewusst isoliert halten wollen
- `config.ts` dadurch zirkulär wird
- Cache-Verhalten für alte Einträge verändert wird

## Commit-Grenze

Nur:

- `server/config.ts`
- `server/routes.ts`

## Commit-Message

`[Phase 2.7.5] Centralize compile route cache settings`

---

# Teilstep 2.7.6 — Sandbox-Pool-Constructor-Defaults an zentrale Config angleichen, ohne DI zu verlieren

Status: completed

## Zweck

Lokale Defaults in `SandboxRunnerPool` vermeiden, aber Tests mit expliziten Options unverändert lassen.

## Dateien

- `server/services/sandbox-runner-pool.ts`

## Exakte Stellen/Werte

Aktuell im Constructor:

- `options.minRunners ?? 5`
- `options.maxRunners ?? this.minRunners`
- `options.maxQueueSize ?? 500`
- `options.idleTimeoutMs ?? 120000`
- `options.acquireTimeoutMs ?? 60_000`
- `options.resetTimeoutMs ?? 10_000`

Zentral vorhanden:

- `config.sandbox.pool.minRunners`
- `config.sandbox.pool.maxRunners`
- `config.sandbox.pool.maxQueueSize`
- `config.sandbox.pool.idleTimeoutMs`
- `config.sandbox.pool.acquireTimeoutMs`
- `config.sandbox.pool.resetTimeoutMs`

## Unverändert lassen

- Constructor-Options müssen Vorrang behalten
- Factory `getSandboxRunnerPool()` darf weiter Options aus Config übergeben
- Queue-Logik
- Reset-/Idle-Verhalten
- Pool-Initialisierung

## Erwarteter semantischer Effekt

Im produktiven Singleton keiner, weil Factory bereits Config übergibt.

Möglicher Effekt bei direktem `new SandboxRunnerPool()` in Tests:
- würde künftig Config-Defaults statt lokal harter Defaults nutzen
- aktuell identisch, solange `server/config.ts` dieselben Defaults hat

## Notwendige Tests

- `npm run check`
- gezielt:
  - `tests/server/services/sandbox-runner-pool.test.ts`
  - `tests/server/services/scalability-stress.test.ts`

## Relevante bestehende Tests

- `tests/server/services/sandbox-runner-pool.test.ts`
- `tests/server/services/scalability-stress.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- `npm run test:unit`
- Sonar-Dateianalyse:
  - `server/services/sandbox-runner-pool.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- Tests absichtlich Constructor-Default-Verhalten isoliert von globaler Config erwarten
- Env-mutierende Tests instabil werden
- Singleton-/Module-Cache-Probleme auftreten

## Commit-Grenze

Nur `server/services/sandbox-runner-pool.ts`.

## Commit-Message

`[Phase 2.7.6] Align sandbox pool defaults with config`

---

# Teilstep 2.7.7 — UnifiedGatekeeper Queue- und Timeout-Werte trennen prüfen

Status: completed

## Zweck

Gatekeeper-Werte zentralisieren, aber nicht Worker-Disable-Logik berühren.

## Dateien

- `server/config.ts`
- `server/services/unified-gatekeeper.ts`

## Exakte Stellen/Werte

Aktuell:

- `private readonly lockTTL = config.timeouts.gatekeeperLockTTLMs`
- `private readonly checkIntervalMs = config.timeouts.gatekeeperLockCheckIntervalMs`
- `private readonly maxQueueSize = 500`
- `acquireCompileSlotHighPriority(...): acquireCompileSlot(..., 30000, ...)`
- `acquireCompileSlot(... timeoutMs: number = 30000 ...)`

Zentral vorhanden:

- `config.timeouts.compileGatekeeperAcquireMs = 30_000`
- `config.timeouts.gatekeeperLockTTLMs = 60_000`
- `config.timeouts.gatekeeperLockCheckIntervalMs = 5_000`

Neu ohne Env:

- `config.compilation.gatekeeperMaxQueueSize: 500`
  oder
- `config.timeouts.gatekeeperMaxQueueSize` wäre semantisch falsch, weil kein Timeout

Empfohlen:

- `config.compilation.gatekeeperMaxQueueSize`

## Unverändert lassen

- `COMPILE_GATEKEEPER_DISABLED`
- `getCompileMaxConcurrent()`
- `calculateOptimalConcurrency()`
- Priority-Verhalten
- Queue-Reihenfolge
- Lock-TTL-Handling

## Erwarteter semantischer Effekt

Keiner, wenn nur `500` aus Config kommt und `30_000` aus bereits existierender Config verwendet wird.

## Notwendige Tests

- `npm run check`
- gezielt:
  - `tests/server/services/unified-gatekeeper.test.ts`
  - `tests/server/services/unified-gatekeeper-performance.test.ts`

## Relevante bestehende Tests

- `tests/server/services/unified-gatekeeper.test.ts`
  - enthält Boundary-Tests für `maxQueueSize=500`
- `tests/server/services/unified-gatekeeper-performance.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- `npm run test:unit`
- Sonar-Dateianalyse:
  - `server/config.ts`
  - `server/services/unified-gatekeeper.ts`

## Smoke-Test

Nicht erforderlich.

## Abbruchkriterien

Abbrechen, wenn:

- Queue-Full-Tests plötzlich andere Grenze erwarten
- Timing-Tests flaky werden
- Änderung an `COMPILE_GATEKEEPER_DISABLED` nötig wäre

## Commit-Grenze

Nur:

- `server/config.ts`
- `server/services/unified-gatekeeper.ts`

## Commit-Message

`[Phase 2.7.7] Centralize gatekeeper queue settings`

---

# Teilstep 2.7.8 — Gatekeeper-Disable-Mechanik separat analysieren und ggf. kapseln

Status: deferred

Deferred-Begründung: Die Mechanik ist ein runtime-mutiertes Worker-Thread-Signal (`COMPILE_GATEKEEPER_DISABLED`) und kein normaler statischer Config-Wert. Wegen der Verwechslungsgefahr mit `config.compilation.disableGatekeeper` bleibt der direkte Zugriff zunächst bewusst lokal.

## Zweck

`COMPILE_GATEKEEPER_DISABLED` ist kein normaler Betriebsparameter, sondern ein Worker-Thread-Signal. Deshalb separat behandeln.

## Dateien

- zunächst nur Analyse:
  - `server/services/unified-gatekeeper.ts`
  - `server/services/workers/compile-worker.ts`
  - `tests/server/services/unified-gatekeeper.test.ts`

## Aktuelle Stellen

- `compile-worker.ts`
  - `process.env.COMPILE_GATEKEEPER_DISABLED = "true"`
- `unified-gatekeeper.ts`
  - `process.env.COMPILE_GATEKEEPER_DISABLED === "true"`

## Mögliche spätere Änderung

Nur falls eindeutig sicher:

- In `server/config.ts` eine Funktion ergänzen, keine statische Property:
  - z. B. `isCompileGatekeeperDisabled()`
- Grund: Der Wert wird im Worker zur Laufzeit gesetzt. Eine beim Import gecachte `config.compilation.gatekeeperDisabled` könnte falsche Werte liefern.

## Unverändert lassen

- Env-Setzen im Worker
- Zeitpunkt des Setzens
- `Infinity`-Verhalten
- Worker-Pool-Concurrency

## Erwarteter semantischer Effekt

Keiner, falls nur Zugriff gekapselt wird.

## Notwendige Tests

- `npm run check`
- `tests/server/services/unified-gatekeeper.test.ts`
- `tests/server/worker-pool.test.ts`
- ggf. `tests/server/workers/compile-worker-canary.test.ts`

## Relevante bestehende Tests

- `tests/server/services/unified-gatekeeper.test.ts`
  - enthält Tests zu `COMPILE_GATEKEEPER_DISABLED`
- `tests/server/worker-pool.test.ts`
- `tests/server/workers/compile-worker-canary.test.ts`

## Build-/Sonar-Gates

- `npm run check`
- `npm run build:worker`
- Sonar-Dateianalyse:
  - `server/config.ts`
  - `server/services/unified-gatekeeper.ts`
  - `server/services/workers/compile-worker.ts`, falls geändert

## Smoke-Test

Falls geändert:

- `npm run test:integration`

## Abbruchkriterien

Abbrechen, wenn:

- Worker-Gatekeeper nicht mehr deaktiviert wird
- Tests zeigen, dass statische Config zu früh ausgewertet wird
- Worker-Build fehlschlägt
- Änderung mehr als eine dünne Kapselung erfordert

## Commit-Grenze

Separater Commit.

## Commit-Message

`[Phase 2.7.8] Encapsulate compile gatekeeper worker flag`

---

# Teilstep 2.7.9 — Timeout-Unterschiede dokumentiert analysieren, noch nicht vereinheitlichen

Status: completed

Analyse-Ergebnis: Die inventarisierten Timeout-Werte haben unterschiedliche fachliche Bedeutungen. `60_000`, `30_000`, `20_000` und `120_000` dürfen nicht pauschal zusammengeführt werden. Weitere Zentralisierungen bleiben auf die separaten Teilsteps 2.7.10 und 2.7.11 beschränkt; Worker-/Cache-Timeouts bleiben in 2.7.12 separat.

## Zweck

Scheinbar gleiche Timeout-Werte nicht blind zusammenführen.

## Betroffene Dateien

- `server/config.ts`
- `server/services/local-compiler.ts`
- `server/services/process-executor.ts`
- `server/services/compiler/cli-runner.ts`
- `server/services/sandbox/docker-compile-semaphore.ts`
- `server/services/workers/compile-worker-utils.ts`
- `server/services/workers/compile-worker.ts`

## Zu analysierende Werte

| Datei | Wert | Bedeutung |
|---|---:|---|
| `config.compilation.timeoutMs` | `60_000` | allgemeiner Compile-Timeout |
| `local-compiler.ts` | `20_000` | lokaler g++/CLI-Timeout |
| `local-compiler.ts` Coverage | `60_000` | Coverage-Sonderfall |
| `process-executor.ts` | `20_000` | generischer Prozess-Default |
| `cli-runner.ts` | `60_000` | Arduino CLI Compile |
| `docker-compile-semaphore.ts` | `60_000` | Warten auf Docker-Compile-Slot |
| `compile-worker-utils.ts` | `120_000` | Arduino CLI JSON/Core-Cache-Lock-Kontext |
| `compile-worker.ts` | `120_000` Lock | Core-Cache-Lock |
| `config.timeouts.compileGatekeeperAcquireMs` | `30_000` | Warten auf Gatekeeper-Slot |
| `config.timeouts.gatekeeperLockTTLMs` | `60_000` | Lock-TTL |

## Ergebnis dieses Teilsteps

Nur Dokumentation/Plan-Notiz oder Issue-Kommentar, kein Code.

## Unverändert lassen

Alles.

## Erwarteter semantischer Effekt

Keiner.

## Notwendige Tests

Keine, da keine Codeänderung.

## Abbruchkriterien

Keine.

## Commit-Grenze

Kein Commit, falls keine Datei geändert wird.

Falls Dokumentation ergänzt wird:

- nur eine Doku-Datei
- Commit:
  - `[Phase 2.7.9] Document server timeout configuration inventory`

---

# Teilstep 2.7.10 — `LocalCompiler` Timeout separat behandeln

Status: deferred

Deferred-Begründung: `LocalCompiler` verwendet `20_000` mehrfach und erhöht bei Coverage dynamisch auf `60_000`. Ob der lokale Default bewusst kürzer als `config.compilation.timeoutMs` ist, ist nicht eindeutig nachweisbar. Daher keine Änderung ohne separate Freigabe.

## Zweck

`LocalCompiler` hat eigene Zeitlogik und Coverage-Sonderfall. Nur nach Teilstep 2.7.9 anfassen.

## Dateien

- `server/services/local-compiler.ts`
- ggf. `server/config.ts`

## Exakte Stellen/Werte

Aktuell:

- `private compileTimeoutMs = 20000`
- bei Coverage:
  - `this.compileTimeoutMs = 60000`

Mögliche Zielvariante:

- Default aus `config.compilation.timeoutMs` oder neuer expliziter `config.compilation.localTimeoutMs`
- Coverage-Wert unverändert lassen oder klarer aus Config ableiten

## Wichtig

Nicht automatisch auf `60_000` ändern, bevor geklärt ist:

- war `20_000` bewusst schnellerer lokaler Timeout?
- hängt ein Test an schnellerem Fail?
- unterscheidet sich lokaler Native-Compile von Arduino-CLI-Compile?

## Unverändert lassen

- Coverage-Erkennung
- Test-Mock-Pfad
- Retry-Anzahl
- `ProcessExecutor`
- CLI-Cache-Logik

## Erwarteter semantischer Effekt

Nur dann keiner, wenn der effektive Default bei `20_000` bleibt.

Falls auf `60_000` geändert: semantischer Effekt vorhanden, daher separater PR oder ausdrücklich freigeben lassen.

## Notwendige Tests

- `npm run check`
- `tests/server/services/arduino-compiler.test.ts`
- `tests/server/services/arduino-compiler-line-numbers.test.ts`
- ggf. Integration:
  - `npm run test:integration`

## Abbruchkriterien

Abbrechen, wenn:

- Timeout-Verhalten in Tests indirekt erwartet wird
- langsame/hängende Prozesse später abgebrochen werden als bisher
- Coverage-Pfad instabil wird

## Commit-Grenze

Nur `server/services/local-compiler.ts` und ggf. `server/config.ts`.

## Commit-Message

Wenn semantikneutral:

`[Phase 2.7.10] Centralize LocalCompiler timeout defaults`

Wenn semantisch geändert, nicht ohne Freigabe committen.

---

# Teilstep 2.7.11 — `ProcessExecutor` Default Timeout separat behandeln

Status: completed

## Zweck

Generischen Prozess-Default nicht nebenbei ändern.

## Dateien

- `server/services/process-executor.ts`
- ggf. `server/config.ts`

## Exakte Stelle/Wert

Aktuell:

- `const { timeout = 20000, ... } = options;`

Mögliche zentrale Config:

- `config.timeouts.processExecutionDefaultMs = 20_000`

Keine neue Env-Variable nötig.

## Unverändert lassen

- Caller-spezifische Timeoutwerte
- Kill-Logik
- stdout/stderr handling
- command whitelist
- detached behavior

## Erwarteter semantischer Effekt

Keiner, wenn Wert `20_000` bleibt.

## Notwendige Tests

- `npm run check`
- `tests/server/services/process-controller.test.ts`
- ProcessExecutor-spezifische Tests, falls vorhanden
- `npm run test:unit`

## Abbruchkriterien

Abbrechen, wenn:

- Import von `config` Zyklus oder Bundleproblem erzeugt
- generischer Executor dadurch zu früh Config auswertet
- Tests Mocking des Executors stören

## Commit-Grenze

Nur:

- `server/config.ts`
- `server/services/process-executor.ts`

## Commit-Message

`[Phase 2.7.11] Centralize process executor default timeout`

---

# Teilstep 2.7.12 — Worker-Cache-Konfiguration separat behandeln

Status: deferred

Deferred-Begründung: Die Pfadabweichung zwischen Worker (`storage/binaries`) und `ArduinoCompiler` (`config.compilation.buildCacheDir/binaries`) ist real und fachlich nicht eindeutig. Eine Zentralisierung könnte Cache-Orte verändern; daher keine Änderung ohne separate Klärung.

## Zweck

Worker-/Build-/Cache-spezifische Werte nicht mit Runtime-Konfiguration vermischen.

## Dateien

- `server/services/workers/compile-worker.ts`
- `server/services/workers/compile-worker-utils.ts`
- ggf. `server/config.ts`

## Exakte Stellen/Werte

Aktuell:

- `CORE_CACHE_DIR = join(process.cwd(), "storage", "core-cache")`
- `CORE_CACHE_BUILD_PATH`
- `CORE_CACHE_LOCK_DIR`
- `CORE_CACHE_META_DIR`
- `CORE_METADATA_TTL_MS = 5 * 60 * 1000`
- `WORKER_BUILD_DIR`
- `BINARY_STORAGE_DIR = join(process.cwd(), "storage", "binaries")`
- `acquireCoreCacheLock(..., 120000)`
- `compile-worker-utils.ts` default `timeoutMs = 120000`
- marker freshness `60_000`

## Vor Änderung klären

- Soll `BINARY_STORAGE_DIR` wirklich unter `storage/binaries` liegen oder unter `config.compilation.buildCacheDir`?
- Warum nutzt `ArduinoCompiler` `join(config.compilation.buildCacheDir, "binaries")`, Worker aber `join(process.cwd(), "storage", "binaries")`?
- Ist das historische Drift oder absichtliche Trennung?

## Unverändert lassen

- Worker-Thread-Start
- WorkerData
- Cache-Key/Fingerprint
- Core-Lock-Verhalten
- Build-Output-Pfade
- Cleanup-LRU

## Erwarteter semantischer Effekt

Keiner nur dann, wenn Pfade effektiv identisch bleiben.

Bei Pfadänderung: semantischer Effekt wahrscheinlich, daher separater Review.

## Notwendige Tests

- `npm run check`
- `npm run build:worker`
- `tests/server/workers/compile-worker-utils.test.ts`
- `tests/server/workers/compile-worker-canary.test.ts`
- `npm run test:integration`

## Smoke-Test

Empfohlen:

- realer Compile-Smoke via vorhandener Integrationstest
- falls Docker betroffen:
  - `npm run test:docker`

## Abbruchkriterien

Abbrechen, wenn:

- Cache-Hit-Verhalten sich ändert
- Worker-Build fehlschlägt
- Pfade zwischen main thread und worker nicht eindeutig äquivalent sind
- Tests temporäre Pfade oder Cache-Orte erwarten

## Commit-Grenze

Separater Commit, nur Worker-/Cache-Dateien.

## Commit-Message

`[Phase 2.7.12] Align worker cache settings with config`

---

# Teilstep 2.7.13 — Sicherheitsrelevante Rate-Limits zuletzt zentralisieren

Status: completed

## Zweck

Rate-Limit-Konfiguration zentral bündeln, aber erst nach risikoarmen Steps.

## Dateien

- `server/config.ts`
- `server/index.ts`
- `server/services/rate-limiter.ts`

## Exakte Stellen/Werte

`server/index.ts`:

- `windowMs: 15 * 60 * 1000`
- `max: isTestMode ? 10000 : 300`

`server/services/rate-limiter.ts`:

- `maxRequests: 1`
- `windowMs: 2 * 1000`
- `blockDurationMs: 5 * 1000`
- cleanup interval `5 * 60 * 1000`
- inactive TTL `10 * 60 * 1000`

Mögliche zentrale Struktur ohne Env:

```text
config.server.apiRateLimit
config.server.simulationRateLimit
```

## Unverändert lassen

- `DISABLE_RATE_LIMIT`
- Testmodus-Bypass
- Skip-Liste:
  - `/api/examples`
  - `/api/status`
  - `/api/health`
  - `/api/config`
- Retry-After-Berechnung
- Blockierungslogik
- Defaults

## Erwarteter semantischer Effekt

Keiner, wenn Werte exakt identisch bleiben.

Aber sicherheitsrelevant, deshalb spät und separat.

## Notwendige Tests

- `npm run check`
- `tests/server/services/rate-limiter.test.ts`
- `tests/server/routes/rate-limit-skip.test.ts`
- `npm run test:security:inputs`
- `npm run test:unit`

## Build-/Sonar-Gates

- `npm run check`
- `npm run test:unit`
- Sonar-Dateianalyse:
  - `server/config.ts`
  - `server/index.ts`
  - `server/services/rate-limiter.ts`

## Smoke-Test

Empfohlen:

- `npm run dev:e2e`
- minimaler API-Smoke:
  - `/api/health`
  - `/api/status`
  - `/api/config`

## Abbruchkriterien

Abbrechen, wenn:

- Rate-Limit-Tests fehlschlagen
- Skip-Liste anders greift
- Testmodus plötzlich limitiert wird
- Produktion weniger restriktiv wird
- Security-Verhalten unklar ist

## Commit-Grenze

Separater Commit.

## Commit-Message

`[Phase 2.7.13] Centralize server rate limit settings`

---

# Empfohlene Reihenfolge

1. `2.7.1` Startup-Logging
2. `2.7.2` DockerManager Limits
3. `2.7.3` Docker PID Limit
4. `2.7.4` Arduino CLI Timeout
5. `2.7.5` Compile-Route-Cache
6. `2.7.6` Sandbox-Pool-Defaults
7. `2.7.7` Gatekeeper Queue Settings
8. `2.7.8` Gatekeeper Worker Flag
9. `2.7.9` Timeout-Analyse
10. `2.7.10` LocalCompiler Timeout
11. `2.7.11` ProcessExecutor Timeout
12. `2.7.12` Worker-Cache Settings
13. `2.7.13` Rate-Limits

---

# Minimaler erster Arbeitsblock für nächsten Agenten

Für den nächsten einfachen Agenten empfehle ich **nur**:

## Commit 1

- Teilstep `2.7.1`
- Datei:
  - `server/index.ts`
- Änderung:
  - Startup-Logging von `process.env.NODE_ENV` auf `config.nodeEnv`

## Commit 2

- Teilstep `2.7.2`
- Datei:
  - `server/services/sandbox/docker-manager.ts`
- Änderung:
  - Output-/Runtime-Limits aus `config.sandbox.resources`

## Commit 3

- Teilstep `2.7.3`
- Dateien:
  - `server/services/sandbox/execution-manager.ts`
  - `server/services/sandbox/execution-phases/start-phase.ts`
- Änderung:
  - `pidsLimit` aus zentraler Sandbox-Config

Diese Aufteilung ist besser als ein gemeinsamer erster Umsetzungsschnitt, weil jeder Commit nur eine Verantwortung ändert und bei Fehlschlag isoliert revertierbar ist.

---

# Completion Criteria

Phase 2.7 gilt als abgeschlossen, wenn:

- alle geplanten Teilsteps entweder `completed` sind oder bewusst als nicht umzusetzen dokumentiert wurden
- produktiver Server-Code keine unnötigen direkten `process.env`-Zugriffe außerhalb von `server/config.ts` mehr enthält
- verbleibende direkte Env-Zugriffe ausdrücklich begründet sind, insbesondere:
  - Worker-thread-lokale Signale
  - Test-/Coverage-Sonderfälle
  - Vite-/Build-/E2E-Sonderfälle
- keine Semantikänderungen an Timeouts, Rate-Limits, Cache-Pfaden oder Security-Limits unbeabsichtigt eingeführt wurden
- `npm run check` grün ist
- relevante Unit-/Integrationstests je Teilstep grün sind
- bei finalem Stand keine neuen SonarQube-Issues für geänderte Dateien vorliegen
- sicherheitsrelevante Rate-Limits separat geprüft und nicht mit risikoarmen Refactorings vermischt wurden
- Worker-/Gatekeeper-/Cache-Spezialfälle separat behandelt und nicht pauschal zentralisiert wurden
