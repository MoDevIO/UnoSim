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

# Einmalig vor dem ersten Start: Laufzeitverzeichnisse für den Container-User.
sudo ./scripts/prepare-runtime-dirs.sh

export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
export UNOSIM_GATEWAY_SECRET="<mindestens-32-zufaellige-Zeichen>"
export UNOSIM_TRUSTED_PROXY="<gateway-ip-oder-cidr>"
export UNOSIM_ALLOWED_WS_ORIGINS="https://classroom.example.edu"

docker compose up --build
```

Der Backend-Container läuft als unprivilegierter Benutzer `node` (UID/GID
1000), nicht als Benutzer des Hosts. Die drei eingebundenen Verzeichnisse
`server/arduino-cache`, `temp` und `storage` müssen ihm gehören.
`scripts/prepare-runtime-dirs.sh` legt sie an und übergibt sie an UID/GID 1000
(Modus `0750`, kein `chmod 777`, Backend nicht als root). Ohne diesen Schritt
legt Docker fehlende Verzeichnisse als `root:root` an, und jeder Compile endet
mit `EACCES` und `POST /api/compile 500`. Das Skript ist idempotent, repariert
auch bereits root-eigene Inhalte und verlangt `sudo`; der Ubuntu/VBox-Installer
ruft es selbst auf. Die UID des Host-Benutzers spielt keine Rolle.

Danach kann der Host-Benutzer diese Verzeichnisse nicht mehr lesen. Deshalb
stehen `server/arduino-cache`, `temp` und `storage` in der `.dockerignore`: Sie
sind Laufzeitzustand, gehören nicht in ein Image und dürfen den Build-Kontext
nicht erreichen. Sonst scheitert `docker compose up --build` mit
`permission denied`, sobald ein Dockerfile-Schritt wie `COPY . …` sie einsammelt.

`docker-compose.yml` setzt `NODE_ENV=production` und
`UNOSIM_SERVER_MODE=docker`. Das Profil aktiviert die Prüfung der erforderlichen
Gateway-Identität und Docker-Simulation automatisch. Der Server prüft
Docker-Daemon, Sandbox-Image und Runner-Pool vor der Readiness-Freigabe.

Das Backend ist danach nur unter `127.0.0.1:3000` erreichbar und erwartet die
Gateway-Header. Ein direkter Aufruf ohne Gateway wird mit `401` oder `403`
abgelehnt; das ist gewollt. Zum Prüfen dienen `/api/health` und
`/api/readiness` (siehe unten). Nutzer erreichen UnoSim ausschließlich über den
Reverse Proxy.

Für einen schnellen, durchgetesteten Aufbau auf einer einzelnen Ubuntu-VM
installiert [INSTALL_UBUNTU_VBOX.md](INSTALL_UBUNTU_VBOX.md) Docker, Nginx und
TLS per Skript.

Die vollständige Kapazitäts- und Timeout-Semantik steht in
[`CAPACITY_MODEL.md`](CAPACITY_MODEL.md). Die dortigen
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

### Beispiel: Nginx ohne Benutzeranmeldung

Diese Konfiguration entspricht der des Ubuntu/VBox-Installers. Sie leitet
HTTP und WebSocket an das Backend weiter und vergibt die Identität anhand der
Client-IP. `unosim.example.edu` und die Zertifikatspfade sind anzupassen.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name unosim.example.edu;

    ssl_certificate     /etc/nginx/tls/unosim.crt;
    ssl_certificate_key /etc/nginx/tls/unosim.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;

        # Secret in einer Datei mit Rechten 0600 halten, nicht im Site-File:
        # proxy_set_header X-UnoSim-Gateway-Secret "<UNOSIM_GATEWAY_SECRET>";
        include /etc/nginx/snippets/unosim-gateway-secret.conf;
        proxy_set_header X-UnoSim-Subject "ip-$remote_addr";
        proxy_set_header X-UnoSim-Roles "user";

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 120s;
    }
}
```

`proxy_set_header` überschreibt gleichnamige Header des Clients. Läuft Nginx auf
demselben Host wie Compose, gilt `UNOSIM_TRUSTED_PROXY=172.31.253.1/32`, und
`UNOSIM_ALLOWED_WS_ORIGINS` ist `https://unosim.example.edu`. Mit
Benutzeranmeldung setzt das Gateway `X-UnoSim-Subject` stattdessen aus dem
angemeldeten Konto; ein Beispiel mit HTTP Basic Auth steht in
[INSTALL_UBUNTU_VBOX.md](INSTALL_UBUNTU_VBOX.md#optional-anmeldung-am-gateway).

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
- Jeder Compile entfernt sein Build-Verzeichnis danach selbst; das HEX bleibt
  in den Caches unter `storage/`. Der Server entfernt minütlich, was älter als
  5 Minuten ist: Sketch-Verzeichnisse beendeter Läufe (`unosim-temp/*.cleanup`)
  und liegengebliebene Compile-Build-Verzeichnisse
  (`unosim-worker-build/worker_*/build-output/*`).
- Jeder Sandbox-Container trägt das Label `unosim.owner`: mit
  `UNOSIM_INSTANCE_ID` den Wert `instance.<id>` (Compose setzt
  `unosim-server`), sonst `<host>:<pid>`. Beim Start und am Ende eines
  geordneten Shutdowns entfernt der Server die Container dieses Owners, auch
  nach Absturz oder Redeploy mit neuem Backend-Container. Gleichzeitig laufende
  Backends auf demselben Docker-Host brauchen verschiedene IDs.
- Jede laufende Sandbox endet spätestens nach `SANDBOX_MAX_LIFETIME_SECONDS`
  (Standard 7200 s Wanduhrzeit), auch wenn das Backend nicht mehr läuft.
  `docker pause` friert auch diesen Timer ein; pausierte Läufe begrenzt
  deshalb das Backend: Ein Lauf darf insgesamt höchstens
  `SIMULATION_MAX_PAUSED_SECONDS` (Standard 600 s, stets kleiner als die harte
  Lebensdauer) pausiert sein, danach wird er beendet und gibt Runner, Admission
  und Container frei.

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
| `SIMULATION_MAX_CONCURRENT` | maximale Zahl gleichzeitig aktiver Simulationen; Standard in Compose `200` |
| `SANDBOX_START_MAX_CONCURRENT` | maximale Zahl paralleler Docker-Sandbox-Starts; Standard `8` |
| `SANDBOX_START_SLOT_TIMEOUT_MS` | maximale Wartezeit eines zugelassenen Starts auf einen Sandbox-Startplatz; Standard `30000` ms |
| `DOCKER_CONTROL_TIMEOUT_MS` | Timeout für kurze Docker-Verfügbarkeits- und Steuerbefehle wie `docker info`; Standard `2000` ms |
| `SIMULATION_ADMISSION_MAX` | maximale Zahl zugelassener aktiver und wartender Anforderungen |
| `SIMULATION_QUEUE_TIMEOUT_MS` | Wartezeit einer zugelassenen Anforderung auf eine Simulationskapazität; Standard `60000` ms (Anwendungsstandard) |
| `SANDBOX_MEMORY_MB` | Memory-Limit pro Sandbox |
| `SANDBOX_CPU_LIMIT` | CPU-Limit pro Sandbox |
| `UNOSIM_GITHUB_TOKEN` | optionaler Read-only-Token nur für `api.github.com` (Ref-Auflösung der Kursinhalte); ohne Token gilt das GitHub-Limit von 60 Abfragen pro Stunde und Server-IP |
| `UNOSIM_LOG_MAX_SIZE`, `UNOSIM_LOG_MAX_FILE` | Rotation des Backend-Logs (Docker `json-file`); Standard `10m` je Datei und `5` Dateien |
| `SIMULATION_MAX_PAUSED_SECONDS` | maximale Gesamtpausenzeit eines Simulationslaufs; danach wird er beendet und gibt seine Kapazität frei; Standard `600`, muss kleiner als `SANDBOX_MAX_LIFETIME_SECONDS` sein |
| `WS_HEARTBEAT_INTERVAL_MS` | Ping-Intervall der WebSocket-Verbindungen; eine Verbindung ohne Antwort auf den vorherigen Ping wird getrennt und gibt ihre Simulation frei; Standard `30000` ms |

Wie viele Simulationen gleichzeitig laufen, begrenzen zwei Werte gemeinsam:

- `SIMULATION_MAX_CONCURRENT` begrenzt die gleichzeitig laufenden Simulationen
  auf dem Server. Die Anwendung setzt standardmäßig `5`; `docker-compose.yml`
  verwendet `200`, sofern `.env` keinen Wert setzt.
- `SIMULATION_ADMISSION_MAX` begrenzt laufende **und** wartende Simulationen
  zusammen. Der Standard ist `25`.

Es gilt der kleinere der beiden Werte. Mit der Compose-Datei laufen ohne
weitere Einstellung also höchstens 25 Simulationen gleichzeitig. Der
Ubuntu/VBox-Installer setzt `SIMULATION_ADMISSION_MAX=40`; dieser Wert ist auf
der Referenz-VM (8 vCPU, 11 GiB RAM, kein Swap) für Klassen mit etwa 30
Lernenden gemessen (siehe [CAPACITY_MODEL.md](CAPACITY_MODEL.md)). Auf anderer
Hardware vor einer Übernahme neu messen.

Ist der Compile-Worker-Pool ausgelastet (500 wartende Compiles oder 30 s
Wartezeit), antwortet `/api/compile` mit `503` und `SYSTEM_BUSY`.

Für größere Installationen sollte vor einer manuellen Erhöhung der
Kapazitätswerte die Host-Kalibrierung ausgeführt werden. Sie läuft direkt auf
dem Host im Repository-Checkout und startet ein eigenes Test-Backend aus dem
Quellcode; dieses liefert den gebauten Client aus `dist/public` aus. Das
Server-Image `unosim-server` wird dafür nicht benötigt.

```bash
npm ci
npm run build
npm run build:sandbox
npm run capacity:calibrate -- --expected-users 200
```

`npm run build:sandbox` ist derselbe Befehl wie
`docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .` oben. Fehlt der
gebaute Client (`dist/public/index.html`), bricht die Kalibrierung vor allen
Docker- und Lastmessungen mit dem Hinweis ab, `npm run build` auszuführen. Sie
baut die Anwendung nicht selbst.

Die Ergebnisse sind host-spezifisch und hängen unter anderem von Docker,
Sandbox-CPU-/Memory-Limits und dem tatsächlichen Workload ab. `capacity.env`
ist nur ein Review-Vorschlag; fehlende Werte müssen geprüft und ausdrücklich
aufgelöst werden. Die Kalibrierung ändert keine Produktionskonfiguration
automatisch.

Übernommene `capacity.env`-Werte wirken erst, wenn sie in `.env` stehen und
`docker compose up -d` den Backend-Container neu erzeugt hat; Compose reicht
alle sieben Variablen der Datei an das Backend durch. Danach zeigt
`/api/status` unter `capacity` die tatsächlich wirksamen Werte, z. B.
`queue.timeoutMs`. Die technische Referenz mit Messphasen, Timeout-Grenzen und
Akzeptanzkriterien steht in
[`CAPACITY_MODEL.md`](CAPACITY_MODEL.md).

### Kursinhalte und Tutor

| Variable | Standard (Compose) | Zweck |
|---|---|---|
| `UNOSIM_EXAMPLES_SOURCE` | `ttbombadil/unosim-examples` | öffentliches GitHub-Repository mit Beispielen und Tutor-Inhalten; leer = nur eingebaute Beispiele |
| `UNOSIM_EXAMPLES_REF` | `main` | Branch, Tag oder Commit; der Server löst ihn zu einem Commit auf |
| `UNOSIM_EXAMPLES_ALLOWED_HOSTS` | `api.github.com,raw.githubusercontent.com` | erlaubte Ziele für ausgehende Abrufe |
| `UNOSIM_EXAMPLES_REFRESH_MS` | `300000` | Abstand zwischen zwei Prüfungen auf einen neuen Stand |
| `UNOSIM_GITHUB_TOKEN` | leer | siehe oben |
| `UNOSIM_LLM_BASE_URL` | `https://chat.kiconnect.nrw/api/v1` | OpenAI-kompatibler Endpunkt für den Tutor |
| `UNOSIM_LLM_TIMEOUT_MS` | `30000` | maximale Dauer eines Tutor-Aufrufs |
| `TUTOR_RATE_LIMIT_MAX_REQUESTS` | `20` | Tutor-Anfragen pro Identität und Fenster |
| `TUTOR_RATE_LIMIT_WINDOW_MS` | `60000` | Fenster für das Tutor-Limit |
| `TUTOR_SESSION_TTL_MS` | `3600000` | absolute Lebensdauer einer Tutor-Sitzung |
| `TUTOR_SESSION_MAX_PER_SUBJECT` | `5` | gleichzeitige Tutor-Sitzungen pro Identität |

Der Tutor unterstützt derzeit nur KI:connect.nrw. Er braucht serverseitig
keinen Schlüssel: Jede Person trägt ihren persönlichen KI:connect-Key im
Browser ein (siehe [USER_GUIDE.md](USER_GUIDE.md#der-tutor)). Ein
serverseitiger Schlüssel oder ein anderer Anbieter ist nicht vorgesehen;
`UNOSIM_LLM_BASE_URL` auf einen anderen OpenAI-kompatiblen Endpunkt zu setzen
ist weder getestet noch unterstützt. Die Verallgemeinerung ist
[Issue #243](https://github.com/MoDevIO/UnoSim/issues/243). Ist GitHub nicht erreichbar,
antwortet der Tutor ohne Kursinhalt als freier Tutor.

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

## Datensicherung

UnoSim speichert keine Nutzerdaten auf dem Server: Sketches existieren nur im Browser
und werden dort über **File → Save All Files** gesichert, Tutor-Sitzungen
liegen im Arbeitsspeicher des Backends. `storage/`, `temp/` und
`server/arduino-cache/` enthalten nur Caches und Zwischenstände, die nach einem
Verlust neu entstehen.

Zu sichern sind:

- die `.env` bzw. die Umgebungswerte, vor allem `UNOSIM_GATEWAY_SECRET`
  (vertraulich ablegen),
- die Gateway-Konfiguration samt TLS-Zertifikat und -Schlüssel,
- der eingesetzte Source-Stand (Commit oder Image-Tag) für ein Rollback.

## Update und Rollback

1. Images aus dem vorgesehenen Commit bauen und taggen.
2. `npm run test:docker` und die Release-Gates ausführen.
3. Neue Instanz starten und Health/Readiness prüfen.
4. Gateway-Traffic umschalten.
5. Bei Fehlern auf das vorherige unveränderte Image-Tag zurückrollen.

Die vollständigen Gates stehen in [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md).
