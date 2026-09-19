# Docker-Installation und Betrieb

Docker ist das einzige unterstützte Deployment-Profil. Der UnoSim-Server läuft
in einem Container und jede Simulation in einer kurzlebigen Docker-Sandbox.
Der Backend-Port ist ausschließlich über ein authentifizierendes Gateway
erreichbar. Es gibt keinen unterstützten produktiven Betrieb ohne Gateway und
keinen host-nativen Simulations-Fallback.

## Voraussetzungen

- Linux-Docker-Host oder Docker Desktop
- Docker Engine mit Compose Plugin
- Reverse Proxy oder Identity-Aware Gateway mit TLS und Authentifizierung
- Sandbox- und Server-Image aus demselben geprüften Source-Stand

## Images und Compose

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
docker build -t unosim-server:latest .

export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
export UNOSIM_GATEWAY_SECRET="<mindestens-32-zufaellige-Zeichen>"
export UNOSIM_TRUSTED_PROXY="<gateway-ip-oder-cidr>"
export UNOSIM_ALLOWED_WS_ORIGINS="https://classroom.example.edu"

docker compose up --build
```

`docker-compose.yml` setzt `NODE_ENV=production` und
`UNOSIM_SERVER_MODE=docker`. Das Profil leitet Gateway-Authentifizierung und
Docker-Simulation automatisch ab. Der Server prüft Docker-Daemon, Sandbox-Image
und Runner-Pool vor der Readiness-Freigabe.

## Gateway-Vertrag

Das Gateway muss:

1. TLS terminieren und Benutzer authentifizieren,
2. eingehende `X-UnoSim-*`-Header entfernen,
3. `X-UnoSim-Gateway-Secret`, `X-UnoSim-Subject` und `X-UnoSim-Roles` für HTTP
   und WebSocket setzen,
4. den Backend-Port gegen direkten Benutzerzugriff abschirmen,
5. HTTP- und WebSocket-Traffic mit derselben Identität weiterleiten.

Der vollständige Vertrag steht in
[`adr/0001-authentication-and-gateway-contract.md`](adr/0001-authentication-and-gateway-contract.md).

## Docker-Sandbox-Vertrag

- Ein kurzlebiger Container pro aktiver Simulation.
- Read-only Root-Filesystem, Capability-Drop, `no-new-privileges`, PID-, CPU-
  und Memory-Limits.
- Kein host-nativer Fallback bei Docker- oder Imagefehlern.
- Der Docker-Socket ist nur für den UnoSim-Server verfügbar.
- Temporäre Build-Pfade werden unter `UNOSIM_SHARED_TEMP_DIR` am identischen
  Host- und Containerpfad gemountet.

Auf macOS muss der Projektpfad in Docker Desktop für File Sharing freigegeben
sein.

## Relevante Runtime-Variablen

### Pflichtwerte

Diese Werte hängen von der Installation und dem vorgeschalteten Gateway ab:

| Variable | Zweck |
|---|---|
| `DOCKER_GID` | numerische Gruppe des Docker-Sockets |
| `UNOSIM_GATEWAY_SECRET` | gemeinsames Gateway-Secret, mindestens 32 Zeichen |
| `UNOSIM_TRUSTED_PROXY` | exakte Gateway-IP oder CIDR |
| `UNOSIM_ALLOWED_WS_ORIGINS` | exakte Browser-Origin-Allowlist |

`docker-compose.yml` setzt `NODE_ENV=production`,
`UNOSIM_SERVER_MODE=docker`, `DOCKER_HOST`, das Sandbox-Image und den
gemeinsamen Temp-Pfad bereits passend für den Docker-Betrieb.

### Optionale Kapazitätswerte

Die Compose-Datei enthält sinnvolle Standardwerte. Eine normale Installation
muss diese Werte nicht ändern. Für größere Installationen können sie über
`.env` angepasst werden.

| Variable | Zweck |
|---|---|
| `WORKER_COUNT` | Anzahl paralleler Compile-Worker |
| `COMPILE_MAX_CONCURRENT` | globale Obergrenze gleichzeitig laufender Compile-Vorgänge |
| `DOCKER_COMPILE_CONCURRENT` | Obergrenze paralleler Compile-Vorgänge in Docker-Sandboxen |
| `SANDBOX_POOL_MIN_RUNNERS` | vorgehaltene Runner; im Docker-Profil mindestens `1` |
| `SANDBOX_POOL_MAX_RUNNERS` | Runner-Obergrenze |
| `SANDBOX_MEMORY_MB` | Memory-Limit pro Sandbox |
| `SANDBOX_CPU_LIMIT` | CPU-Limit pro Sandbox |

Frühere Topologie- und Kompatibilitätsschalter werden beim Start abgelehnt:
`UNOSIM_SIMULATION_MODE`, `UNOSIM_TRUST_MODE`, `FORCE_DOCKER` und
`UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL`.

## Testprofil ohne Gateway

Für automatisierte Docker-Integrationstests darf ausschließlich diese
Kombination verwendet werden:

```bash
NODE_ENV=test \
UNOSIM_SERVER_MODE=docker \
UNOSIM_DOCKER_TEST_BYPASS_GATEWAY=1 \
npm run test:docker
```

Der Bypass ist außerhalb von `NODE_ENV=test` und außerhalb des Docker-Profils
ungültig. Er ändert nur die Authentifizierung; Simulationen bleiben echte
Docker-Sandboxen. Er ist kein Deploymentmodus.

## Health, Readiness und Status

- `/api/health`: HTTP-Prozess erreichbar
- `/api/readiness`: Docker-Runner-Pool initialisiert und bereit
- `/api/status`: Runner, Compile-Slots, Worker, WebSockets, Admission und
  Prozessmetriken; im Docker-Profil nur authentifiziert

Eine Instanz darf erst nach erfolgreicher Readiness Traffic erhalten.

## Update und Rollback

1. Images aus dem vorgesehenen Commit bauen und taggen.
2. `npm run test:docker` und die Release-Gates ausführen.
3. Neue Instanz starten und Health/Readiness prüfen.
4. Gateway-Traffic umschalten.
5. Bei Fehlern auf das vorherige unveränderte Image-Tag zurückrollen.

Die vollständigen Gates stehen in [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md).
