# Historische Skalierbarkeit und gemessene Kapazität

Dieses Dokument bewahrt die Messung aus Phase 3.4 vor dem aktuellen
Kapazitätsmodell. Es ist keine normative Aussage über die heutigen
Produktionsgrenzen. Das aktuelle Modell, die aktuellen Defaults und die Dell-
Referenzmessungen stehen in
[CAPACITY_VALIDATION_PLAN.md](CAPACITY_VALIDATION_PLAN.md).

## Gemessene Grenzen

Gemessen wurden ein stateful Backend, echte Docker-Sandboxen, 8 Compile-Worker,
8 Sandbox-Start-Slots, 256 MB und 0,25 CPU pro Sandbox sowie ein logischer
SandboxRunnerPool mit 5 Runnern. Diese Messung entstand vor Einführung des
heutigen Admission- und Startup-Modells. Sie beschreibt historische
Queue-/Durchsatzdaten und ist nicht mit der aktuellen physischen
Sandbox-Kapazität gleichzusetzen.

| Workload | Ergebnis | Status |
|---|---:|---|
| Compile, 50 Clients | 50/50 | validiert |
| Compile, 100 Clients | 100/100 | validiert |
| Compile, 200 Clients | 200/200 | validiert |
| Simulation/WebSocket/Runner, 50 Clients | 50/50 | validiert |
| Simulation/WebSocket/Runner, 100 Clients | 100/100 | validiert |
| Simulation/WebSocket/Runner, 200 Clients | 126/200; 74 Timeout/Fehler | nicht freigegeben |

200 Simulationen waren in diesem historischen Profil ausdrücklich kein
Kapazitätsversprechen. Der gemessene Engpass waren die 5 logischen Runner und
der 60-Sekunden-Runner-Acquire-Timeout. Compile-Skalierung,
Sandbox-Startdruck, Simulationskapazität und Admission sind unterschiedliche
Grenzen.

## Admission Control

Die damalige globale Admission-Grenze war 25 laufende plus wartende
Simulationsstarts pro Backend-Prozess. Sie war eine Fail-fast-Grenze vor dem
damaligen Runner-Pool und dessen 500er-Notfallqueue. Bei voller Admission-
Grenze wurde ein Start sofort als `SYSTEM_BUSY` abgewiesen. Für aktuelle
Defaults und test-only Profile siehe die zentrale Kapazitätsdokumentation.

Der Default basiert auf dem Queue- und Latenzverlauf der realen
Docker-Messungen mit 5 Runnern:

| Eingehende Starts | Peak Runner-Queue | p95 Startlatenz | Ergebnis |
|---:|---:|---:|---|
| 50 | 45 | ca. 22 s | 50/50 |
| 100 | 95 | ca. 45 s | 100/100 |
| 200 | 195 | ca. 56 s | 126/200; 74 Timeouts/Fehler |

Mit 25 Admissions sind bei dieser Referenzkonfiguration höchstens 5 Starts
laufend und 20 wartend. Das entspricht fünf Runner-Wellen; aus den gemessenen
Compile-/Startzeiten ergibt sich eine erwartete reguläre Wartezeit in der
Größenordnung 10–12 Sekunden. Das ist eine konservative Betriebsentscheidung,
keine neue Lasttest-Freigabe. Insbesondere sind die drei Größen getrennt zu
behandeln:

- physische Runner-Pool-Größe: Ausführungsparallelität,
- Concurrent-Request-Last: Anzahl gleichzeitig eingehender Testanfragen,
- Admission-Cap: Anzahl aktuell akzeptierter laufender plus wartender Starts.

`SIMULATION_ADMISSION_MAX` darf nur nach erneuter Messung von Queue-Tiefe,
Startlatenz, Timeouts und Hostressourcen geändert werden. Eine größere Cap oder
ein größer konfigurierter Runner-Pool belegt für sich keine höhere Kapazität.

## Betriebsmodell und Monitoring

Die Freigabe gilt für einen einzelnen stateful Backend-Knoten. WebSocket-Sessions, Runner-Leases und Queue-Zustand liegen im Prozess. Horizontale HA und Session-Replikation sind nicht implementiert.

/api/status liefert sandboxRunners, compileSlots, webSocketSessions, compileMetrics, compileWorkerPool, processMetrics sowie aggregierte Admission- und Rate-Limit-Werte. Identitäten werden nicht ausgegeben. Diese Werte sind Laufzeitmetriken und nicht persistent. Cache- und temporäre Dateien dürfen gemäß [INSTALL_SERVER.md](INSTALL_SERVER.md) neu erzeugt werden; laufende Sessions und Nutzdaten nicht.

## Lasttests

Der reproduzierbare Real-Docker-Harness ist
`tests/server/load-50-client-simulation-observability.test.ts` und über
`LOAD_TEST_CLIENT_COUNT` parametrisiert. Messergebnisse sind generierte
Testartefakte und gehören nicht in den Repository-Tree.

Vor einer Kapazitätsänderung müssen Ressourcenprofil, Queue-/Timeout-Verhalten, Cleanup, WebSocket-Stabilität und Statusmetriken erneut gemessen werden. Eine Timeout-Erhöhung allein ist kein Kapazitätsnachweis.
