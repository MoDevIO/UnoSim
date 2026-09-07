# Serverinstallation und Hochschulbetrieb

Normative Anleitung für Hochschulserver, Lehrbetrieb, Mehrbenutzerbetrieb und produktionsnahe Installationen. UnoSim ist aktuell ein einzelner stateful Backend-Knoten; horizontale HA ist nicht implementiert. Sicherheitsdetails stehen in README_SECURITY.md, Releases in RELEASE_RUNBOOK.md.

## Plattform

Empfohlen ist Debian oder Ubuntu LTS mit systemd, mindestens 8 CPU-Kernen und 16 GB RAM. Für die gemessene Lastreserve sind 16 Kerne und 32 GB RAM sinnvoll. Node.js 24.20.0 und npm 11 werden verwendet. Benötigt werden Docker Engine mit Compose v2, Git, curl, ca-certificates, g++, xz-utils und tar. Arduino CLI und der arduino:avr-Core werden durch das Produktions-Dockerfile installiert.

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

Für Compose:

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

Der Gateway muss Cookies/Tokens validieren, eingehende X-UnoSim-Header entfernen und Secret, Subject und Rolle auf HTTP und WebSocket setzen. Origin-Allowlist-Einträge sind exakte Werte. Trusted Proxy ist konkrete IP/CIDR, niemals ein pauschales Trust-Proxy-Flag. Keine Secrets in Repository, Browser, URL oder Logs. Siehe README_SECURITY.md und ADR 0001.

## Sandbox-Vertrag

Das Sandbox-Image muss einen nicht-root Benutzer, read-only RootFS, blockierten Network-Egress und keine Host-Mounts außer dem vorgesehenen /sandbox-Arbeitsverzeichnis haben. Keine Docker-Socket-Weitergabe in die Sandbox. Der Backend-Container benötigt den Socket nur zum Starten der Sandboxen; dieser Socket ist hochprivilegiert und muss geschützt werden.

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
| UNOSIM_ALLOWED_WS_ORIGINS | localhost-Defaults | Gateway | https://classroom.example.edu | exakte WS-Allowlist. |
| UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL | false | nein | false | isolierter Entwicklungs-Override. |
| SIMULATOR_ALLOWED_PARENT_ORIGINS | localhost-Defaults | nein | https://lms.example.edu | erlaubte iframe-Eltern. |
| UNOSIM_SHARED_TEMP_DIR | keiner | Docker | /srv/unosim/temp | gemeinsamer Temp-Pfad. |
| DOCKER_HOST | unix:///var/run/docker.sock | Docker | gleicher Wert | Docker-Daemon. |
| DOCKER_SANDBOX_IMAGE | unosim-sandbox:latest | Docker | unosim-sandbox:release | Sandbox-Image. |
| SANDBOX_POOL_MIN_RUNNERS | 5 | nein | 5 | Mindestzahl Runner. |
| SANDBOX_POOL_MAX_RUNNERS | min | nein | 5 | Maximalzahl Runner. |
| SANDBOX_POOL_IDLE_TIMEOUT_MS | 120000 | nein | 300000 | Idle-Aufräumzeit. |
| SANDBOX_MEMORY_MB | 256 | nein | 256 | Sandbox-RAM. |
| SANDBOX_CPU_LIMIT | 0.25 | nein | 0.25 | Sandbox-CPU. |
| WORKER_COUNT | CPU-abhängig | nein | 8 | Compiler-Worker. |
| DOCKER_COMPILE_CONCURRENT | 8 | nein | 8 | Docker-Compile-Konkurrenz. |
| COMPILE_MAX_CONCURRENT | CPU-abhängig | nein | 8 | Compile-Slots. |
| ARDUINO_FQBN | arduino:avr:uno | nein | arduino:avr:uno | Board. |
| ARDUINO_CACHE_DIR | server/arduino-cache | nein | /srv/unosim/server/arduino-cache | Toolchain-Cache. |
| BUILD_CACHE_DIR | storage/cache | nein | /srv/unosim/storage/cache | Build-Cache. |
| BUILD_CACHE_MAX_BYTES | 2 GiB | nein | 2147483648 | Cache-Limit. |
| DISABLE_RATE_LIMIT | false | nein | false | nicht in Produktion deaktivieren. |
| DISABLE_COMPILE_CACHE | false | nein | false | nur kontrollierte Messungen. |
| ENABLE_TEST_ENDPOINTS | false | nein | false | nur Tests; nie öffentlich. |

FORCE_DOCKER ist ein deprecated Alias für UNOSIM_SIMULATION_MODE=docker-sandbox. Historische Namen nicht primär verwenden.

## Start, Logs und Monitoring

~~~bash
docker compose up -d
docker compose ps
docker compose logs -f unosim-backend
curl -fsS http://127.0.0.1:3000/api/health
~~~

Beim Boot müssen Image, Docker-Daemon, Mounts, Secrets und Origin-Allowlist verfügbar sein. Restart erfolgt mit docker compose restart unosim-backend. Einen systemd-Unit-Entwurf gibt es im Repository nicht.

/api/status zeigt sandboxRunners, compileSlots, webSocketSessions, compileMetrics, compileWorkerPool und processMetrics. Diese Werte sind flüchtige Laufzeitwerte. Persistente Nutzdaten und aktive Sessions nicht löschen. Regenerierbar sind Build-/Arduino-Caches, temporäre Dateien und generierte Load-Test-JSONs. Die freigegebene Kapazität steht in SCALABILITY.md: Compile 50/100/200 validiert, Simulation 50/100 validiert, 200 Simulationen nicht freigegeben; 5 Runner sind der Engpass.

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

Vor dem Update Health, Status, Commit und Image dokumentieren. Bei Fehlern Logs und Status sichern, den vorherigen Release-Commit und die vorherigen Images bereitstellen und docker compose up -d ausführen. Eine Datenbankmigration ist im Repository nicht festgelegt. Für Release-Gates und Rollback gilt RELEASE_RUNBOOK.md.
