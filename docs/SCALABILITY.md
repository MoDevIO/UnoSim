# Skalierbarkeit und gemessene Kapazität

Normative Kapazitätsaussage für die aktuelle Architektur. Historische Evidenz liegt unter [archive/](archive/).

## Gemessene Grenzen

Gemessen wurden ein stateful Backend, echte Docker-Sandboxen, 8 Compile-Worker, 8 Docker-Compile-Slots, 256 MB und 0,25 CPU pro Sandbox sowie ein SandboxRunnerPool mit 5 Runnern.

| Workload | Ergebnis | Status |
|---|---:|---|
| Compile, 50 Clients | 50/50 | validiert |
| Compile, 100 Clients | 100/100 | validiert |
| Compile, 200 Clients | 200/200 | validiert |
| Simulation/WebSocket/Runner, 50 Clients | 50/50 | validiert |
| Simulation/WebSocket/Runner, 100 Clients | 100/100 | validiert |
| Simulation/WebSocket/Runner, 200 Clients | 126/200; 74 Timeout/Fehler | nicht freigegeben |

200 Simulationen sind ausdrücklich kein Kapazitätsversprechen. Der gemessene Engpass sind die 5 Runner und der 60-Sekunden-Runner-Acquire-Timeout. Compile-Skalierung und Simulationskapazität sind unterschiedliche Grenzen.

## Betriebsmodell und Monitoring

Die Freigabe gilt für einen einzelnen stateful Backend-Knoten. WebSocket-Sessions, Runner-Leases und Queue-Zustand liegen im Prozess. Horizontale HA und Session-Replikation sind nicht implementiert.

/api/status liefert sandboxRunners, compileSlots, webSocketSessions, compileMetrics, compileWorkerPool und processMetrics. Diese Werte sind Laufzeitmetriken und nicht persistent. Cache- und temporäre Dateien dürfen gemäß [INSTALL_SERVER.md](INSTALL_SERVER.md) neu erzeugt werden; laufende Sessions und Nutzdaten nicht.

## Lasttests

Der reproduzierbare Real-Docker-Harness ist tests/server/load-50-client-simulation-observability.test.ts und über LOAD_TEST_CLIENT_COUNT parametrisiert. JSON-Ergebnisse unter load-test-results/ sind generiert und nicht versioniert.

Vor einer Kapazitätsänderung müssen Ressourcenprofil, Queue-/Timeout-Verhalten, Cleanup, WebSocket-Stabilität und Statusmetriken erneut gemessen werden. Eine Timeout-Erhöhung allein ist kein Kapazitätsnachweis.
