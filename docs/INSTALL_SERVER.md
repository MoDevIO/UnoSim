# Docker-Installation und Betrieb

Docker ist das einzige unterstützte Deployment-Profil. Der UnoSim-Server läuft
in einem Container und jede Simulation in einer kurzlebigen Docker-Sandbox.
Der Backend-Port muss hinter einem vertrauenswürdigen Gateway liegen. Dieses
Gateway ist verpflichtend; eine Anmeldung einzelner Personen davor ist eine
Option. Es gibt keinen unterstützten produktiven Betrieb ohne Gateway und
keinen host-nativen Simulations-Fallback.

## Voraussetzungen

- Linux-Docker-Host oder Docker Desktop
- Docker Engine mit Compose Plugin
- Reverse Proxy mit TLS und UnoSim-Gateway-Headern; Benutzeranmeldung ist
  optional
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
`UNOSIM_SERVER_MODE=docker`. Das Profil aktiviert die Prüfung der erforderlichen
Gateway-Identität und Docker-Simulation automatisch. Der Server prüft
Docker-Daemon, Sandbox-Image und Runner-Pool vor der Readiness-Freigabe.

Die vollständige Kapazitäts- und Timeout-Semantik steht in
[`CAPACITY_VALIDATION_PLAN.md`](CAPACITY_VALIDATION_PLAN.md). Die dortigen
Validierungsprofile sind Testprofile und keine automatischen
Produktionsvorgaben.

## Gateway-Vertrag

Das Gateway muss:

1. TLS terminieren,
2. eingehende `X-UnoSim-*`-Header entfernen und die vertrauenswürdigen Werte
   selbst setzen,
3. `X-UnoSim-Gateway-Secret`, `X-UnoSim-Subject` und `X-UnoSim-Roles` für HTTP
   und WebSocket setzen,
4. den Backend-Port gegen direkten Clientzugriff abschirmen,
5. HTTP- und WebSocket-Traffic mit derselben Identität weiterleiten.

Das Gateway kann Personen anmelden und den Subject aus ihrem Konto ableiten.
Für ein privates Netz kann es ohne Benutzeranmeldung arbeiten und den Subject
aus der direkt beobachteten Client-IP bilden, beispielsweise mit Nginx als
`ip-$remote_addr`. Verwende dafür nicht den vom Client gesendeten
`X-Forwarded-For`-Wert. Dies ist keine Authentifizierung: Alle erreichbaren
Clients erhalten Zugriff. Clients, die über dieselbe NAT-, VPN- oder Proxy-IP
ankommen, teilen ihre UnoSim-Identität und damit deren Limits.

`UNOSIM_TRUSTED_PROXY` konfiguriert Express' Proxy-Trust-Verhalten. Die aktuelle
Autorisierung vergleicht die tatsächliche Gegenstellen-IP nicht mit diesem
Wert. Deshalb muss die Netzwerktopologie den Backend-Port abschirmen. Compose
bindet ihn standardmäßig an `127.0.0.1:3000`.

Trusted Proxy ist die Adresse, die das Backend als Gegenstelle sieht. Ein
Gateway auf demselben Host, das den veröffentlichten Port `127.0.0.1:3000`
nutzt, erscheint dort als Gateway des Compose-Netzes, nicht als `127.0.0.1`.
`docker-compose.yml` legt dieses Netz deshalb fest
(`UNOSIM_DOCKER_SUBNET`, Standard `172.31.253.0/24`; `UNOSIM_DOCKER_GATEWAY`,
Standard `172.31.253.1`); für diese Topologie gilt
`UNOSIM_TRUSTED_PROXY=172.31.253.1/32`.

`UNOSIM_ALLOWED_WS_ORIGINS` akzeptiert exakte Browser-Origin-Werte aus Schema,
Host und Port. Der Standard-HTTPS-Port 443 wird ohne Port geschrieben;
alternative Ports müssen explizit eingetragen werden, zum Beispiel
`https://unosim.vbox` und `https://unosim.vbox:8443`. Wildcards oder bloße
Hostname-Suffixe sind keine Origin-Allowlist.

Der ursprüngliche Vertrag steht in
[`adr/0001-authentication-and-gateway-contract.md`](adr/0001-authentication-and-gateway-contract.md);
die aktuelle Entscheidung zur optionalen Benutzeranmeldung steht in
[`adr/0008-optional-gateway-authentication.md`](adr/0008-optional-gateway-authentication.md).

## Docker-Sandbox-Vertrag

- Ein kurzlebiger Container pro aktiver Simulation.
- Read-only Root-Filesystem, Capability-Drop, `no-new-privileges`, PID-, CPU-
  und Memory-Limits.
- Kein host-nativer Fallback bei Docker- oder Imagefehlern.
- Der Docker-Socket ist nur für den UnoSim-Server verfügbar.
- Temporäre Build-Pfade werden unter `UNOSIM_SHARED_TEMP_DIR` am identischen
  Host- und Containerpfad gemountet.
- Jeder Sandbox-Container trägt das Label `unosim.owner`: mit
  `UNOSIM_INSTANCE_ID` den Wert `instance.<id>` (Compose setzt
  `unosim-server`), sonst `<host>:<pid>`. Beim Start und am Ende eines
  geordneten Shutdowns entfernt der Server die Container dieses Owners, auch
  nach Absturz oder Redeploy mit neuem Backend-Container. Gleichzeitig laufende
  Backends auf demselben Docker-Host brauchen verschiedene IDs.
- Jede Sandbox endet spätestens nach `SANDBOX_MAX_LIFETIME_SECONDS`
  (Standard 7200 s, Wanduhrzeit inklusive Pausen), auch wenn das Backend nicht
  mehr läuft.

Auf macOS muss der Projektpfad in Docker Desktop für File Sharing freigegeben
sein.

## Relevante Runtime-Variablen

### Pflichtwerte

Diese Werte hängen von der Installation und dem vorgeschalteten Gateway ab:

| Variable | Zweck |
|---|---|
| `DOCKER_GID` | numerische Gruppe des Docker-Sockets |
| `UNOSIM_GATEWAY_SECRET` | gemeinsames Gateway-Secret, mindestens 32 Zeichen |
| `UNOSIM_TRUSTED_PROXY` | IP oder CIDR für Express-Proxy-Trust; keine Quell-IP-ACL |
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
| `WORKER_COUNT` | Anzahl paralleler Compile-Worker für `/api/compile`; höchstens 8 werden gestartet (ein höherer Wert wird beim Start als Warnung gemeldet) |
| `COMPILE_MAX_CONCURRENT` | Obergrenze gleichzeitiger Compiles im Hauptprozess (lokaler Modus und Fallback bei ausgefallenem Worker-Pool) |
| `SIMULATION_MAX_CONCURRENT` | maximale Zahl gleichzeitig aktiver Simulationen |
| `SANDBOX_START_MAX_CONCURRENT` | maximale Zahl paralleler Docker-Sandbox-Starts; Standard `8` |
| `SANDBOX_START_SLOT_TIMEOUT_MS` | maximale Wartezeit eines zugelassenen Starts auf einen Sandbox-Startplatz; Standard `30000` ms |
| `DOCKER_CONTROL_TIMEOUT_MS` | Timeout für kurze Docker-Verfügbarkeits- und Steuerbefehle wie `docker info`; Standard `2000` ms |
| `SIMULATION_ADMISSION_MAX` | maximale Zahl zugelassener aktiver und wartender Anforderungen |
| `SIMULATION_QUEUE_TIMEOUT_MS` | Wartezeit einer zugelassenen Anforderung auf eine Simulationskapazität |
| `SANDBOX_MEMORY_MB` | Memory-Limit pro Sandbox |
| `SANDBOX_CPU_LIMIT` | CPU-Limit pro Sandbox |
| `UNOSIM_GITHUB_TOKEN` | optionaler Read-only-Token nur für `api.github.com` (Ref-Auflösung der Kursinhalte); ohne Token gilt das GitHub-Limit von 60 Abfragen pro Stunde und Server-IP |
| `WS_HEARTBEAT_INTERVAL_MS` | Ping-Intervall der WebSocket-Verbindungen; eine Verbindung ohne Antwort auf den vorherigen Ping wird getrennt und gibt ihre Simulation frei; Standard `30000` ms |

Die Defaults der Anwendung stehen in `server/config.ts` (unter anderem
`SIMULATION_MAX_CONCURRENT=5`). Die Produktions-Compose-Datei setzt aktuell
`SIMULATION_MAX_CONCURRENT=200` ausdrücklich als Deployment-Override; das ist
kein neuer Anwendungdefault. Dieser Wert begrenzt globale logische Runner und
ist nicht das Limit pro Gateway-Subject. Der effektive Admission-Grenzwert pro
Identität hängt vom verwendeten Source-Stand und dessen Konfiguration ab.
Dieser Wert muss vor einem produktiven Einsatz
gegen die aktuelle Zielserver-Abnahme geprüft werden. Wirksam wird er nur
zusammen mit `SIMULATION_ADMISSION_MAX`: Ohne diesen Wert lässt die Admission
höchstens 25 laufende und wartende Simulationen zu.

Ist der Compile-Worker-Pool ausgelastet (500 wartende Compiles oder 30 s
Wartezeit), antwortet `/api/compile` mit `503` und `SYSTEM_BUSY`.

Für größere Installationen sollte vor einer manuellen Erhöhung der
Kapazitätswerte die Host-Kalibrierung ausgeführt werden:

```bash
npm run capacity:calibrate -- --expected-users 200
```

Die Ergebnisse sind host-spezifisch und hängen unter anderem von Docker,
Sandbox-CPU-/Memory-Limits und dem tatsächlichen Workload ab. `capacity.env`
ist nur ein Review-Vorschlag; fehlende Werte müssen geprüft und ausdrücklich
aufgelöst werden. Die Kalibrierung ändert keine Produktionskonfiguration
automatisch. Die technische Referenz mit Messphasen, Timeout-Grenzen und
Akzeptanzkriterien steht in
[`CAPACITY_VALIDATION_PLAN.md`](CAPACITY_VALIDATION_PLAN.md).

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
ungültig. Er ersetzt im isolierten Testprofil die Gateway-Identität und erlaubt
dort den persönlichen Tutor-Key auch über die interne HTTP-Verbindung; die
Simulationen bleiben echte Docker-Sandboxen. Er ist kein Deploymentmodus.

## Health, Readiness und Status

- `/api/health`: HTTP-Prozess erreichbar
- `/api/readiness`: Docker-Runner-Pool initialisiert und bereit
- `/api/status`: Runner, Compile-Slots, Worker, WebSockets, Admission und
  Prozessmetriken; im Docker-Profil nur mit gültiger Gateway-Identität

Eine Instanz darf erst nach erfolgreicher Readiness Traffic erhalten.

## Update und Rollback

1. Images aus dem vorgesehenen Commit bauen und taggen.
2. `npm run test:docker` und die Release-Gates ausführen.
3. Neue Instanz starten und Health/Readiness prüfen.
4. Gateway-Traffic umschalten.
5. Bei Fehlern auf das vorherige unveränderte Image-Tag zurückrollen.

Die vollständigen Gates stehen in [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md).
