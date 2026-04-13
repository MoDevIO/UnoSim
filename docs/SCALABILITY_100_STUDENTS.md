# Skalierung: 100 gleichzeitige Studierende

## Ausgangslage & Anforderung

**Anforderung:** Mindestens 100 Studierende sollen UnoSim gleichzeitig nutzen können.

**IST-Stand (vor diesem Branch):**
- Sandbox Runner Pool: **5 Runner** hardcoded → max. 5 parallele Simulationen
- Compilation Worker Pool: **4 Worker** hardcoded (arduino-cli Race-Condition auf geteiltem `temp/`)
- Docker-Ressourcen pro Container: **256 MB RAM, 0.5 CPU** → ressourcenintensiv

---

## Architektur-Analyse

### Zwei unabhängige Bottlenecks

| Subsystem | Limit | Ursache |
|-----------|-------|---------|
| `SandboxRunnerPool` | 5 Runner | Singleton hardcoded `numRunners=5` |
| `CompilationWorkerPool` | 4 Worker | Race Condition in `temp/` bei >4 parallelen arduino-cli-Prozessen |
| Docker pro Container | 256 MB, 0.5 CPU | Zu konservativ für AVR-Simulation |

### Bottleneck: Simulation > Compilation

Eine laufende `loop()`-Simulation belegt **dauerhaft** einen Runner.
→ 100 Studis = 100 gleichzeitige Runner nötig.

Compilation ist burst-artig (~5–15 s) und wird über Queue abgefedert.

---

## Implementierungsplan (TDD – dieser Branch)

### Phase 1: Quick Wins (Single Node)

| # | Aufgabe | Status |
|---|---------|--------|
| 1.1 | `SANDBOX_POOL_SIZE` Env-Variable → konfigurierbarer Pool | ✅ |
| 1.2 | Docker-Ressourcen via Env-Variablen konfigurierbar + Default 128 MB / 0.25 CPU | ✅ |
| 1.3 | `WORKER_COUNT` Env-Variable für Compilation Workers | ✅ |
| 1.4 | Separate temp-Verzeichnisse pro Worker → entfernt 4-Worker-Hardlimit | ✅ |

### Phase 2: On-Demand Runner Pool

| # | Aufgabe | Status |
|---|---------|--------|
| 2.1 | Runner on-demand erstellen statt Pre-Allokation aller Runner beim Start | ✅ |
| 2.2 | `maxRunners` (Default 100) + `minRunners` (Default 2) | ✅ |
| 2.3 | Idle-Runner nach Timeout (Default 120 s) zerstören | ✅ |
| 2.4 | Graceful Degradation: Queue-Meldung an Client statt hartem 60 s Timeout | ✅ |

---

## Konfiguration (Env-Variablen)

```bash
# Sandbox Runner Pool
SANDBOX_POOL_MIN_RUNNERS=2        # Warm-gehaltene Runner (Default: 2)
SANDBOX_POOL_MAX_RUNNERS=100      # Maximale Runner (Default: 100)
SANDBOX_POOL_IDLE_TIMEOUT_MS=120000  # Idle-Abbau nach 120s (Default: 120000)

# Docker Ressourcen pro Container
SANDBOX_MEMORY_MB=128             # RAM pro Container (Default: 128)
SANDBOX_CPU_LIMIT=0.25            # CPU-Anteil pro Container (Default: 0.25)

# Compilation Worker Pool
WORKER_COUNT=8                    # Compile-Worker (Default: auto = cpus/2, max 8)
```

---

## Rechenbeispiel: 16-Core / 64 GB Server

```
100 Runner × 128 MB  = 12.8 GB  (+~2 GB OS/Backend = ~15 GB)
100 Runner × 0.25 CPU = 25 vCPUs (Übersubskription, AVR ist idle-heavy → OK)
8 Worker × isoliertes temp/ = keine Race Conditions
Compile-Durchsatz: ~50–80 kompilierungen/min
```

→ **100 gleichzeitige Simulationen auf einem einzelnen kräftigen Server machbar.**

---

## Testabdeckung

- `tests/server/services/sandbox-runner-pool.test.ts` – env-var Konfiguration, on-demand creation, idle cleanup
- `tests/server/services/execution-manager.test.ts` – Docker-Ressourcen-Konfiguration
- `tests/server/compilation-worker-pool.env.test.ts` – WORKER_COUNT env var
- `tests/integration/worker-pool.scalability.test.ts` – Kapazitätsestimate (bestehend)

---

## Migration (Breaking Changes)

Keine. Alle Env-Variablen haben Defaults, die dem bisherigen Verhalten entsprechen (außer Pool-Größe: 5 → 2 min / 100 max).

> **Hinweis:** Der Default `SANDBOX_POOL_MIN_RUNNERS=2` ersetzt das bisherige feste 5er-Pool. In Produktionsdeployments sollte `SANDBOX_POOL_MIN_RUNNERS=5` gesetzt werden, um Warmstart-Latenz zu vermeiden.
