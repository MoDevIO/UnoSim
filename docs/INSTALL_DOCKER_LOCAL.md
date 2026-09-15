# Vollständiger Dockerbetrieb ohne Gateway

Diese Anleitung beschreibt einen lokalen Einzelplatzbetrieb: Das UnoSim-
Backend und die Arduino-Sandboxen laufen in Docker. Ein Auth-Gateway ist nicht
erforderlich.

> Dieser Modus verwendet `UNOSIM_TRUST_MODE=local`. Er ist nur für den eigenen
> Rechner oder ein abgeschottetes internes Netz geeignet. Für öffentliche oder
> gemeinsam genutzte Installationen gilt weiterhin [`INSTALL_SERVER.md`](INSTALL_SERVER.md)
> mit Gateway-Mode.

## 1. Ubuntu vorbereiten

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git curl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Einmal ab- und wieder anmelden, danach prüfen:

```bash
docker info
docker compose version
```

## 2. UnoSim auschecken

```bash
sudo install -d -o "$USER" -g "$USER" /srv/unosim
git clone https://github.com/MoDevIO/UnoSim.git /srv/unosim
cd /srv/unosim
```

## 3. Arbeitsverzeichnisse anlegen

```bash
mkdir -p server/arduino-cache storage temp
```

Die Verzeichnisse müssen für den Containerbenutzer beschreibbar sein. Nutze
auf dem Host die vorhandenen Gruppen-/ACL-Regeln; ein pauschales rekursives
`chown` ist nicht erforderlich.

## 4. Images bauen

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
docker build -f Dockerfile -t unosim-server:latest .
```

Das Sandbox-Image bleibt auf demselben Docker-Daemon, dessen Socket der
Servercontainer später verwendet.

## 5. Servercontainer starten

Starte den Container aus dem Repository-Verzeichnis. Die Pfade für Temp und
Arduino-Cache werden absichtlich identisch auf Host und im Container gemountet;
das ist für die dynamisch gestarteten Sandboxen erforderlich.

```bash
docker run -d \
  --name unosim-local \
  --restart unless-stopped \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=development \
  -e PORT=3000 \
  -e UNOSIM_SERVER_MODE=docker \
  -e UNOSIM_SIMULATION_MODE=docker-sandbox \
  -e UNOSIM_TRUST_MODE=local \
  -e UNOSIM_LISTEN_HOST=0.0.0.0 \
  -e DOCKER_HOST=unix:///var/run/docker.sock \
  -e DOCKER_SANDBOX_IMAGE=unosim-sandbox:latest \
  -e ARDUINO_CACHE_DIR=/srv/unosim/server/arduino-cache \
  -e UNOSIM_SHARED_TEMP_DIR=/srv/unosim/temp \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/server/arduino-cache:/srv/unosim/server/arduino-cache" \
  -v "$PWD/temp:/srv/unosim/temp" \
  -v "$PWD/storage:/app/storage" \
  unosim-server:latest
```

Der Dienst ist anschließend unter <http://localhost:3000> erreichbar. Der
Port ist absichtlich nur an `127.0.0.1` gebunden. Für einen ausdrücklich
gewünschten LAN-Test muss das Port-Mapping bewusst angepasst und eine exakte
`UNOSIM_ALLOWED_WS_ORIGINS`-Liste gesetzt werden.

## 6. Bereitschaft und Logs prüfen

```bash
curl -fsS http://127.0.0.1:3000/api/readiness
docker ps --filter name=unosim-local
docker logs -f unosim-local
```

Im Browser anschließend ein Beispiel laden, kompilieren und die Simulation
starten. Dabei sollten Serial-Ausgabe sowie Pause/Resume/Stop funktionieren.

## 7. Stoppen, aktualisieren und entfernen

```bash
docker stop unosim-local
docker rm unosim-local
```

Nach einem Update:

```bash
cd /srv/unosim
git pull --ff-only
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
docker build -f Dockerfile -t unosim-server:latest .
```

## Fehlerbehebung

- `permission denied` für den Docker-Socket: `stat -c '%g' /var/run/docker.sock`
  prüfen und den Wert von `--group-add` verwenden.
- Sandbox-Image fehlt: Schritt 4 erneut ausführen.
- Sandbox findet Dateien nicht: sicherstellen, dass `UNOSIM_SHARED_TEMP_DIR`
  und der Host-/Container-Mount denselben absoluten Pfad verwenden.
- Keine Verbindung: `docker logs unosim-local`, Port 3000 und
  `/api/readiness` prüfen.
- Compile-Fehler: Die Arduino CLI und der `arduino:avr`-Core sind bereits im
  Server-Image enthalten; zunächst Container-Logs prüfen.

Für den sicheren Mehrbenutzerbetrieb diesen Modus nicht nach außen öffnen,
sondern die Gateway-Anleitung in [`INSTALL_SERVER.md`](INSTALL_SERVER.md)
verwenden.
