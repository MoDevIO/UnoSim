# Serverinstallation und Hochschulbetrieb

Normative Anleitung für Hochschulserver, Lehrbetrieb, Mehrbenutzerbetrieb und produktionsnahe Installationen. UnoSim ist aktuell ein einzelner stateful Backend-Knoten; horizontale HA ist nicht implementiert. Sicherheitsdetails stehen in [SECURITY.md](SECURITY.md), Releases in [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md).

## Plattform

Empfohlen ist Debian oder Ubuntu LTS mit systemd, mindestens 8 CPU-Kernen und 16 GB RAM. 16 Kerne und 32 GB RAM sind eine Referenzempfehlung für die gemessenen Lastprofile, keine Kapazitätsgarantie; die freigegebenen Grenzen stehen in [SCALABILITY.md](SCALABILITY.md). Node.js 24.20.0 und npm 11 werden verwendet. Benötigt werden Docker Engine mit Compose v2, Git, curl, ca-certificates, g++, xz-utils und tar. Arduino CLI und der arduino:avr-Core werden durch das Produktions-Dockerfile installiert.

Der Gateway-Host muss TLS terminieren, HTTP und WebSocket-Upgrades weiterleiten und den Backend-Port aus dem öffentlichen Netz abschirmen. Backend-Port ist 3000, öffentlich ist typischerweise nur 443 am Gateway.

## Repository, Release und Images

~~~bash
sudo install -d -o unosim -g unosim /srv/unosim
sudo -u unosim git clone https://github.com/MoDevIO/UnoSim.git /srv/unosim
cd /srv/unosim
npm ci
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
npm run build
~~~

Für Compose müssen die drei im Compose-File verpflichtenden Werte UNOSIM_GATEWAY_SECRET, UNOSIM_TRUSTED_PROXY und UNOSIM_ALLOWED_WS_ORIGINS im Environment oder Secret-Store gesetzt sein. Danach:

~~~bash
docker compose build
docker compose up -d
~~~

Eine .env.example-Datei ist nicht Bestandteil des Repositories. Variablen aus server/config.ts und docker-compose.yml im Secret-/Environment-Management setzen.

## Komponenten

- Gateway/Reverse Proxy: TLS, Authentifizierung, Header-Bereinigung, Origin- und Routing-Grenze.
- UnoSim Backend: Express/HTTP und WebSocket /ws, API, Session-Zustand und Status.
- Frontend: Vite-Build wird als statische Ausgabe vom Backend ausgeliefert.
- Compiler Worker Pool: Node-Worker für parallele Arduino-Kompilierung.
- Compile Slots: begrenzen gleichzeitig laufende Compilerprozesse.
- Docker Sandbox: kurzlebiger isolierter Container pro Simulation.
- SandboxRunnerPool: Runner-Leases, Queue und Cleanup.

WebSocket-Sessions, Runner-Leases und Queue-Zustand liegen im Backend-Prozess. Keine mehreren Backend-Instanzen betreiben, solange Session-Affinität und Replikation nicht ausdrücklich entworfen und getestet wurden.

## Gateway und Security

Gateway-Mode ist für jeden erreichbaren Mehrbenutzerdienst Pflicht:

~~~bash
export NODE_ENV=production
export UNOSIM_SERVER_MODE=docker
export UNOSIM_SIMULATION_MODE=docker-sandbox
export UNOSIM_TRUST_MODE=gateway
export UNOSIM_GATEWAY_SECRET='<mindestens 32 zufällige Zeichen>'
export UNOSIM_TRUSTED_PROXY='10.0.0.10/32'
export UNOSIM_ALLOWED_WS_ORIGINS='https://classroom.example.edu'
export DOCKER_SANDBOX_IMAGE=unosim-sandbox:latest
~~~

Der Gateway muss Cookies/Tokens validieren, eingehende X-UnoSim-Header entfernen und X-UnoSim-Gateway-Secret, X-UnoSim-Subject sowie X-UnoSim-Roles auf HTTP und WebSocket setzen. Origin-Allowlist-Einträge sind exakte Werte. Trusted Proxy ist konkrete IP/CIDR, niemals ein pauschales Trust-Proxy-Flag. Keine Secrets in Repository, Browser, URL oder Logs. Siehe SECURITY.md und ADR 0001.

## Sandbox-Vertrag

Das Dockerfile.sandbox stellt den nicht-root Benutzer sandboxuser sowie /sandbox bereit. Die sicherheitskritischen Laufzeitoptionen werden vom Backend beim docker run gesetzt: --network none, --read-only, --security-opt no-new-privileges, --cap-drop ALL, --pids-limit 50, CPU-/RAM-/Swap-Limits und nur der schreibbare /sandbox-Mount. Keine Docker-Socket-Weitergabe in die Sandbox. Der Backend-Container benötigt den Socket nur zum Starten der Sandboxen; dieser Socket ist hochprivilegiert und kann bei einer Backend-Kompromittierung den Docker-Host gefährden.

## Compose und Referenzressourcen

docker-compose.yml ist der bestehende Deployment-Mechanismus. Es definiert Backend-Port, Docker-Socket, Cache-/Temp-Mounts, Gateway-Trust, Origin-Allowlist und Worker-/Pool-Defaults. Der gemessene Referenzbetrieb nutzt 8 Worker, 8 Compile-Konkurrenz, 256 MB und 0,25 CPU pro Sandbox.

## Umgebungsvariablen

| Name | Default | Pflicht | Beispiel | Bedeutung |
|---|---|---:|---|---|
| NODE_ENV | development | prod | production | Laufzeitprofil. |
| PORT | 3000 | nein | 3000 | HTTP/WebSocket-Port. |
| UNOSIM_SERVER_MODE | local (Dev), docker (Prod) | prod | docker | Backend-Ausführung. |
| UNOSIM_SIMULATION_MODE | local | prod | docker-sandbox | Sketch-Ausführung. |
| UNOSIM_TRUST_MODE | local | prod | gateway | Vertrauensgrenze. |
| UNOSIM_GATEWAY_SECRET | keiner | Gateway | Secret-Store | Gateway-Secret. |
| UNOSIM_TRUSTED_PROXY | keiner | Gateway | 10.0.0.10/32 | Proxy-Hop. |
| UNOSIM_ALLOWED_WS_ORIGINS | local: localhost-Defaults; gateway: leer | Gateway | https://classroom.example.edu | exakte WS-Allowlist; in Compose verpflichtend. |
| UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL | false | nein | false | isolierter Entwicklungs-Override. |
| SIMULATOR_ALLOWED_PARENT_ORIGINS | localhost-Defaults | nein | https://lms.example.edu | erlaubte iframe-Eltern. |
| UNOSIM_SHARED_TEMP_DIR | keiner | Docker | /srv/unosim/temp | gemeinsamer Temp-Pfad. |
| DOCKER_HOST | unix:///var/run/docker.sock | Docker | gleicher Wert | Docker-Daemon. |
| DOCKER_SANDBOX_IMAGE | unosim-sandbox:latest | Docker | unosim-sandbox:release | Sandbox-Image. |
| SANDBOX_POOL_MIN_RUNNERS | 5 | nein | 5 | Mindestzahl Runner. |
| SANDBOX_POOL_MAX_RUNNERS | min (Compose: 200) | nein | 5 | Maximalzahl Runner; Compose setzt 200, die Messfreigabe basiert dennoch auf 5 Runnern. |
| SANDBOX_POOL_IDLE_TIMEOUT_MS | 120000 | nein | 300000 | Idle-Aufräumzeit. |
| SANDBOX_MEMORY_MB | 256 | nein | 256 | Sandbox-RAM. |
| SANDBOX_CPU_LIMIT | 0.25 | nein | 0.25 | Sandbox-CPU. |
| WORKER_COUNT | CPU-abhängig | nein | 8 | Compiler-Worker. |
| DOCKER_COMPILE_CONCURRENT | 8 | nein | 8 | Docker-Compile-Konkurrenz. |
| COMPILE_MAX_CONCURRENT | CPU-abhängig | nein | 8 | Compile-Slots. |
| ARDUINO_FQBN | arduino:avr:uno | nein | arduino:avr:uno | Board. |
| ARDUINO_CACHE_DIR | server/arduino-cache (Container: /app/server/arduino-cache) | nein | /srv/unosim/server/arduino-cache | Toolchain-Cache. |
| BUILD_CACHE_DIR | storage/cache | nein | /srv/unosim/storage/cache | Build-Cache. |
| BUILD_CACHE_MAX_BYTES | 2 GiB | nein | 2147483648 | Cache-Limit. |
| COMPILE_RATE_LIMIT_MAX_REQUESTS | 10 | nein | 10 | Compile-Anfragen je vertrauenswürdiger Identität und Zeitfenster. |
| COMPILE_RATE_LIMIT_WINDOW_MS | 60000 | nein | 60000 | Zeitfenster des separaten Compile-Limits. |
| COMPILE_RATE_LIMIT_BLOCK_DURATION_MS | 10000 | nein | 10000 | Sperrdauer nach Überschreiten des Compile-Limits. |
| SIMULATION_START_RATE_LIMIT_MAX_REQUESTS | 1 | nein | 1 | Simulationsstarts je vertrauenswürdiger Identität und Zeitfenster. |
| SIMULATION_START_RATE_LIMIT_WINDOW_MS | 2000 | nein | 2000 | Zeitfenster des separaten Start-Limits. |
| SIMULATION_START_RATE_LIMIT_BLOCK_DURATION_MS | 5000 | nein | 5000 | Sperrdauer nach Überschreiten des Start-Limits. |
| SIMULATION_ADMISSION_MAX | 25 | nein | 25 | Prozessweite Obergrenze für laufende plus auf einen Runner wartende Starts; weitere Starts werden sofort mit `SYSTEM_BUSY` abgewiesen. |
| DISABLE_RATE_LIMIT | false | nein | false | nicht in Produktion deaktivieren. |
| DISABLE_COMPILE_CACHE | false | nein | false | nur kontrollierte Messungen. |
| DISABLE_COMPILE_GATEKEEPER | false | nein | false | nur kontrollierte Tests; in Produktion false. |
| ENABLE_TEST_ENDPOINTS | false | nein | false | nur Tests; nie öffentlich. |
| ALLOW_EMBED_ORIGINS | localhost-Defaults | nein | https://lms.example.edu | deprecated Alias; primär SIMULATOR_ALLOWED_PARENT_ORIGINS verwenden. |

FORCE_DOCKER ist ein deprecated Alias für UNOSIM_SIMULATION_MODE=docker-sandbox. Historische Namen nicht primär verwenden.

## Start, Logs und Monitoring

~~~bash
docker compose up -d
docker compose ps
docker compose logs -f unosim-backend
curl -fsS http://127.0.0.1:3000/api/health
~~~

Beim Boot müssen Image, Docker-Daemon, Mounts, Secrets und Origin-Allowlist verfügbar sein. Restart erfolgt mit docker compose restart unosim-backend. Einen systemd-Unit-Entwurf gibt es im Repository nicht.

/api/status zeigt sandboxRunners, compileSlots, webSocketSessions, compileMetrics, compileWorkerPool, processMetrics sowie aggregierte Admission- und Rate-Limit-Zähler. Nutzeridentitäten werden dort nicht ausgegeben. Im Gateway-Mode muss der Aufruf über den authentifizierten Gateway mit den erforderlichen Identitäts-Headern erfolgen; der anonyme Health-Aufruf ist dafür nicht ausreichend. Diese Werte sind flüchtige Laufzeitwerte: Sessions, Limits, Queues und Runner-Leases gehen bei einem Neustart verloren. Persistente Nutzdaten sind von der Installation abhängig und dürfen nicht als Cache behandelt werden. Regenerierbar sind Build-/Arduino-Caches, temporäre Dateien und generierte Load-Test-JSONs; laufende Jobs vorher beenden. Die freigegebene Kapazität steht in [SCALABILITY.md](SCALABILITY.md): Compile 50/100/200 validiert, Simulation 50/100 validiert, 200 Simulationen nicht freigegeben; 5 Runner waren der Engpass der Referenzmessung.

Die anwendungsseitigen Limits verwenden im Gateway-Modus ausschließlich den nach Gateway-Secret- und Rollenprüfung übernommenen `X-UnoSim-Subject`. Im Local-Modus wird stattdessen eine zufällige, serverseitig signierte HttpOnly-Cookie-Session verwendet; ungeprüfte Identity-Header oder Test-IDs sind keine Rate-Limit-Identität. Direkte Local/Test-WebSocket-Clients ohne vorherige HTTP-Session erhalten eine eigene, nur für ihre Verbindung erzeugte Identität.

`SIMULATION_ADMISSION_MAX=25` ist bewusst nicht aus der Zahl 100 erfolgreich eingegangener Lasttest-Requests abgeleitet. Bei der Referenzmessung mit 5 Runnern begrenzt der Default den Zustand auf höchstens 5 laufende und 20 wartende Starts. Runner-Pool-Größe, validierte Request-Last und Admission-Cap sind unabhängige Größen. Änderungen dieser Werte benötigen eine neue Messung; ein höherer Wert ist keine Kapazitätsfreigabe.

## Production Checklist

- Gateway und Authentifizierung aktiv; Backend-Port nicht öffentlich erreichbar.
- Trusted Proxy und Origin-Allowlist exakt gesetzt.
- Gateway-Secret gesetzt und außerhalb des Repositories verwaltet.
- Rate Limiting aktiv (`DISABLE_RATE_LIMIT=false`).
- Admission Control aktiv und passend zum gemessenen Runner-Durchsatz gesetzt (Default 25).
- Test-Endpunkte deaktiviert (`ENABLE_TEST_ENDPOINTS=false`).
- Sandbox-Image vorhanden und auf den geprüften Release-Stand festgelegt.
- Docker-Sandbox verwendet die dokumentierten Laufzeitoptionen und keine Host-Mounts außer `/sandbox`.
- `/api/health` erfolgreich; `/api/status` mit plausiblen Runner-, Queue- und Prozesswerten geprüft.
- Release-Gate aus [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) erfolgreich abgeschlossen.

## Update und Rollback

~~~bash
git fetch origin
git pull --ff-only
npm ci
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
npm run build
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:3000/api/health
~~~

Vor dem Update Health, den über den Gateway authentifiziert abgefragten Status, den Git-Commit und die Image-IDs dokumentieren. Nach dem Update erneut Health und Status über den vorgesehenen Zugang prüfen. Ein Rollback ist nur reproduzierbar, wenn der vorherige Release-Commit und die dazugehörigen Images noch verfügbar oder aus einer vertrauenswürdigen Registry erneut beziehbar sind: dann diesen Commit auschecken, die passenden Images verwenden und docker compose up -d ausführen. Das Repository stellt keinen automatischen Rollback-Mechanismus bereit. Eine Datenbankmigration ist im Repository nicht festgelegt. Für Release-Gates und Rollback gilt [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md).
