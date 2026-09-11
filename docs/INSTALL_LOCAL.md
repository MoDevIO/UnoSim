# Lokale Installation und Entwicklung

Normative Anleitung für Entwickler und Lehrende, die UnoSim auf einem einzelnen Rechner starten. Für Hochschulserver und Mehrbenutzerbetrieb gilt [INSTALL_SERVER.md](INSTALL_SERVER.md).

## Unterstützte Umgebung

- macOS oder Linux (Docker Desktop bzw. Docker Engine); Windows ist nicht als Betriebsplattform dokumentiert.
- Node.js 24.20.0 gemäß .nvmrc, package.json und Dockerfiles.
- npm 11 (mit Node 24 ausgeliefert) wird empfohlen; npm ci verwendet package-lock.json.
- Für lokale Kompilierung: Arduino CLI mit installiertem arduino:avr-Core.
- Für Docker-Simulation: laufender Docker-Daemon und unosim-sandbox:latest.
- Mindestens 4 CPU-Kerne und 8 GB RAM; für Lasttests 8 Kerne und 16 GB oder mehr. Default: 256 MB pro Sandbox-Runner.
- Backend: Port 3000; Vite verwendet typischerweise Port 5173. WebSockets laufen unter /ws am Backend.

```bash
node --version
npm --version
npm run check:node-version
```

## Checkout und Dependencies

```bash
git clone https://github.com/MoDevIO/UnoSim.git
cd UnoSim
npm ci
```

Aktualisieren:

```bash
git fetch origin
git pull --ff-only
npm ci
```

## Schnellcheck und Entwicklung

```bash
npm run check
npm run test:unit
npm run dev:full
```

npm run dev:full startet Backend und Vite-Frontend mit Hot Reload. Der projektdefinierte Dev-Befehl verwendet UNOSIM_SERVER_MODE=local, UNOSIM_SIMULATION_MODE=local und UNOSIM_TRUST_MODE=local. Local-Mode ist für eine vertrauenswürdige Einzelplatzmaschine gedacht, nicht für öffentliche oder gemeinsam genutzte Instanzen. Ohne weitere Konfiguration lauscht der Server im Local-Mode ausschließlich auf `127.0.0.1`.

Nur Backend oder Frontend:

```bash
npm run dev
npm run dev:client
```

`npm run dev` startet den Backend-Dev-Server ausschließlich auf `127.0.0.1`.
`npm run dev:lan` verwendet dieselbe lokale Dev-Konfiguration einschließlich
der External-Examples-Variablen, setzt aber zusätzlich
`UNOSIM_LISTEN_HOST=0.0.0.0`. Dadurch kann ein Mobilgerät den Server über eine
lokale Netzwerkadresse erreichen. LAN-Mode bleibt ein ausdrücklich aktivierter
Local-/Dev-Modus und ist nicht für Produktion oder nicht vertrauenswürdige
Netze vorgesehen.

Für einen bewusst aktivierten LAN-Test kann der Listener separat geöffnet werden.
Der Trust-/Auth-Modus bleibt dabei `local`; eine zusätzliche WebSocket-Allowlist
kann mit exakten Origins angegeben werden:

```bash
UNOSIM_TRUST_MODE=local \
UNOSIM_LISTEN_HOST=0.0.0.0 \
UNOSIM_ALLOWED_WS_ORIGINS=http://192.168.1.50:3000 \
PORT=3000 \
npm run dev
```

`UNOSIM_LISTEN_HOST` überschreibt nur die Netzwerkadresse des Listeners. Im
Local-Mode wird eine Browser-WebSocket-Verbindung akzeptiert, wenn ihre Origin
exakt zum HTTP-`Host` der Verbindung passt; deshalb funktioniert der
gleich-originige Zugriff über die vom Startup-Dialog angezeigte LAN-URL ohne
zusätzliche Origin-Wildcard. `UNOSIM_ALLOWED_WS_ORIGINS` ist eine exakte,
komma-separierte Ergänzung für ausdrücklich erlaubte Origins. Im Gateway-Mode
bleibt der Default `0.0.0.0` bestehen.

## Docker-Simulation

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
NODE_ENV=development UNOSIM_SERVER_MODE=docker \
UNOSIM_SIMULATION_MODE=docker-sandbox UNOSIM_TRUST_MODE=local \
DISABLE_RATE_LIMIT=true ./node_modules/.bin/tsx server/index.ts --host
```

Docker-Simulation benötigt Zugriff auf den Docker-Daemon. Das Sandbox-Image startet pro Ausführung einen isolierten Container; DOCKER_HOST hat den Default unix:///var/run/docker.sock. Für den vollständigen Containerpfad ist docker-compose.yml maßgeblich.

## Production Build lokal

```bash
npm run build
NODE_ENV=production UNOSIM_TRUST_MODE=local \
UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true npm run start
```

Der Override ist nur für eine isolierte lokale Maschine zulässig. Ein Mehrbenutzerdienst muss Gateway-Mode verwenden.

## Relevante Variablen

| Name | Default | Pflicht | Bedeutung / Beispiel |
|---|---|---:|---|
| PORT | 3000 | nein | HTTP und WebSocket, z. B. PORT=3001. |
| UNOSIM_LISTEN_HOST | `127.0.0.1` bei local, `0.0.0.0` bei gateway | nein | Explizite Listener-Adresse, z. B. `0.0.0.0` für einen bewusst aktivierten LAN-Test. |
| UNOSIM_SERVER_MODE | local (Dev) | nein | local oder docker. |
| UNOSIM_SIMULATION_MODE | local | nein | local oder docker-sandbox. |
| UNOSIM_TRUST_MODE | local | nein | Einzelplatz local; Server siehe Installationsanleitung. |
| ARDUINO_FQBN | arduino:avr:uno | nein | Zielboard. |
| ARDUINO_CACHE_DIR | ./server/arduino-cache | nein | Arduino-CLI-Cache. |
| BUILD_CACHE_DIR | ./storage/cache | nein | generierter Build-Cache. |
| DOCKER_SANDBOX_IMAGE | unosim-sandbox:latest | Docker | Sandbox-Image. |
| SANDBOX_POOL_MIN_RUNNERS | 5 | nein | vorgehaltene Runner. |
| SANDBOX_POOL_MAX_RUNNERS | 5 in Dev | nein | maximale Runner. |
| SANDBOX_MEMORY_MB | 256 | nein | Speicher pro Sandbox. |
| SANDBOX_CPU_LIMIT | 0.25 | nein | CPU pro Sandbox. |
| WORKER_COUNT | CPU-abhängig | nein | Compiler-Worker. |
| DOCKER_COMPILE_CONCURRENT | 8 | nein | Docker-Compile-Konkurrenz. |
| COMPILE_MAX_CONCURRENT | CPU-abhängig | nein | Compile-Slots. |
| DISABLE_RATE_LIMIT | false | nein | nur isolierte Tests: true. |
| LOAD_TEST_CLIENT_COUNT | 50 | Loadtest | Anzahl Harness-Clients. |
| UNOSIM_EXAMPLES_SOURCE | leer | nein | Serverseitige HTTPS-Basis-URL und Default-Quelle für externe Beispiele; im Dev-Skript auf `https://raw.githubusercontent.com/ttbombadil/UnoSim-Examples` gesetzt. Browser-Overrides dürfen diesen Raw-Wert nicht setzen. |
| UNOSIM_EXAMPLES_REF | leer | nein | Aktueller fester Default-Ref; im Dev-Skript `v1.0.0`. Erforderlich, wenn `UNOSIM_EXAMPLES_SOURCE` gesetzt ist. |
| UNOSIM_EXAMPLES_REFRESH_MS | 300000 | nein | Aktuelles Provider-TTL; in der Zielarchitektur Intervall für erneute source-spezifische Channel-Prüfung. |
| UNOSIM_EXAMPLES_TIMEOUT_MS | 5000 | nein | Timeout je serverseitigem Upstream-Request. |
| UNOSIM_EXAMPLES_MAX_MANIFEST_BYTES | 262144 | nein | maximales Manifest. |
| UNOSIM_EXAMPLES_MAX_FILE_BYTES | 131072 | nein | maximale einzelne Example-Datei. |
| UNOSIM_EXAMPLES_MAX_TOTAL_BYTES | 1048576 | nein | maximale Gesamtgröße eines geladenen Snapshots. |
| UNOSIM_EXAMPLES_MAX_FILES | 100 | nein | maximale Zahl manifestierter Dateien. |
| UNOSIM_EXAMPLES_ALLOWED_HOSTS | leer | Produktion bei externer Quelle | Exakte serverseitige Host-Allowlist; im Dev-Skript `raw.githubusercontent.com`; durch Browser-Overrides nicht erweiterbar. |

### Geplante browser-spezifische Examples-Auswahl

Die Zielarchitektur ergänzt einen serverseitigen logischen Default-Channel wie
`stable`. Sein konkreter Config-Name und die Migration vom aktuellen festen
`UNOSIM_EXAMPLES_REF` sind noch offen.

Die Settings sollen künftig normale GitHub-Repository-Angaben wie
`owner/repository` oder `https://github.com/owner/repository` akzeptieren und
kanonisch als `owner/repository` speichern. Diese nicht-sensitive Präferenz
darf in `localStorage` liegen. Ohne gespeicherten Override wird der
Server-Default verwendet; `Reset to default` löscht den Browserwert. Der
Override ist weder eine Änderung an `.env` noch ein globaler Serverzustand.

Der Browser wird weiterhin ausschließlich `/api/examples` aufrufen. UnoSim
validiert Repository, Channel, Manifest und Dateien serverseitig und lädt
Inhalte nur aus einer vollständigen Commit-Revision. Die dynamische Settings-
UI und der Stable-Channel sind noch nicht implementiert. Bis dahin müssen
lokale Ref-Änderungen weiterhin im Dev-Startwert erfolgen und das Backend neu
gestartet werden. Zielvertrag:
[External-Examples-SSOT](../ssot/ssot_function_definition_ExternalExamples.md).

FORCE_DOCKER ist ein deprecated Alias für UNOSIM_SIMULATION_MODE=docker-sandbox. Neue Konfigurationen verwenden den neuen Namen. Sicherheitsvariablen stehen in [SECURITY.md](SECURITY.md).

## Tests und Fehlerbehebung

```bash
npm run check
npm run test:unit
npm run test:integration
npm run test:docker
npm run test:e2e
npm run build
npm run check:docs
```

Die vollständige Pipeline ist ./run-tests.sh. Optionales SonarQube benötigt SONAR_TOKEN und http://localhost:9000: npm run sonar.

- Docker nicht erreichbar: docker info prüfen oder Local-Mode verwenden.
- Sandbox-Image fehlt: docker build -f Dockerfile.sandbox -t unosim-sandbox:latest ..
- Port belegt: PORT=3001 setzen.
- Compile-Fehler: arduino-cli version, arduino-cli core list, arduino-cli core install arduino:avr und ARDUINO_FQBN prüfen.
- WebSocket-Fehler: Backend-Port, /ws-Proxying und im Gateway-Mode die exakte Origin-Allowlist prüfen.
- Cache-Probleme: nur generierte Inhalte in storage/cache/, server/arduino-cache/ und temporären Verzeichnissen löschen; anschließend npm ci bzw. Build wiederholen.
