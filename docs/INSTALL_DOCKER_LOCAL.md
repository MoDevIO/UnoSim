# Vollständiger Dockerbetrieb ohne Gateway

Diese Anleitung beschreibt einen lokalen bzw. bewusst freigegebenen privaten Dockerbetrieb von UnoSim:

- das UnoSim-Backend läuft in Docker,
- Arduino-Simulationen laufen in dynamisch gestarteten Docker-Sandboxen,
- ein Auth-Gateway ist nicht erforderlich.

> [!WARNING]
> Dieser Modus verwendet `UNOSIM_TRUST_MODE=local` und besitzt **keine Benutzer-Authentifizierung**.
> Er ist nur für den eigenen Rechner oder ein vertrauenswürdiges, nicht öffentlich erreichbares internes Netz gedacht.
> Für öffentliche oder gemeinsam genutzte Installationen gilt [`INSTALL_SERVER.md`](INSTALL_SERVER.md) mit Gateway-Mode.

## 1. Ubuntu vorbereiten

Docker, Git und curl installieren:

```bash
sudo apt-get update
sudo apt-get install -y docker.io git curl
```

Je nach Ubuntu-Version heißt das Compose-Paket unterschiedlich. Aktuelle Ubuntu-Versionen können `docker-compose-v2` bereitstellen, andere `docker-compose-plugin`:

```bash
if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
  sudo apt-get install -y docker-compose-v2
else
  sudo apt-get install -y docker-compose-plugin
fi
```

Docker aktivieren und den aktuellen Benutzer zur Docker-Gruppe hinzufügen:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Danach **ab- und wieder anmelden oder den Rechner neu starten**, damit die neue Gruppenzugehörigkeit aktiv wird.

Prüfen:

```bash
id
docker info
docker compose version
```

Bei `id` muss die Gruppe `docker` erscheinen. `docker info` muss einen Server-Abschnitt anzeigen und darf nicht mit `permission denied` am Docker-Socket abbrechen.

## 2. UnoSim auschecken

```bash
sudo install -d -o "$USER" -g "$USER" /srv/unosim
git clone https://github.com/MoDevIO/UnoSim.git /srv/unosim
cd /srv/unosim
```

Optional den Checkout kontrollieren:

```bash
git status
git rev-parse --short HEAD
```

## 3. Arbeitsverzeichnisse anlegen

```bash
mkdir -p server/arduino-cache storage temp
```

Die Verzeichnisse müssen für den Containerbenutzer beschreibbar sein. Nutze auf dem Host die vorhandenen Gruppen-/ACL-Regeln; ein pauschales rekursives `chown` ist nicht erforderlich.

## 4. Docker-Images bauen

Zuerst das Sandbox-Image, anschließend das Server-Image bauen:

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
docker build -f Dockerfile -t unosim-server:latest .
```

Prüfen:

```bash
docker images | grep unosim
```

Erwartet werden mindestens:

```text
unosim-server    latest
unosim-sandbox   latest
```

Das Sandbox-Image muss auf demselben Docker-Daemon liegen, dessen Socket später in den Servercontainer eingebunden wird. Der Server startet die Sandbox-Container dynamisch über `/var/run/docker.sock`.

## 5. Server lokal auf dem Ubuntu-Rechner starten

Das Server-Image wird über `npm run start` im **Production-Modus** gestartet. Deshalb sind für den bewusst gateway-freien Local-Trust-Betrieb zwei Dinge explizit erforderlich:

1. `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true` bestätigt, dass Local-Trust absichtlich trotz `NODE_ENV=production` verwendet wird.
2. `UNOSIM_EXAMPLES_ALLOWED_HOSTS=api.github.com,raw.githubusercontent.com` erlaubt die standardmäßig konfigurierte externe Beispielsammlung auch im Production-Modus.

`NODE_ENV=development` sollte hier **nicht** gesetzt werden: Das Start-Script des Images setzt selbst `NODE_ENV=production`.

Starte den Container aus `/srv/unosim`:

```bash
docker run -d \
  --name unosim-local \
  --restart unless-stopped \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  -p 127.0.0.1:3000:3000 \
  -e PORT=3000 \
  -e UNOSIM_SERVER_MODE=docker \
  -e UNOSIM_SIMULATION_MODE=docker-sandbox \
  -e UNOSIM_TRUST_MODE=local \
  -e UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true \
  -e UNOSIM_LISTEN_HOST=0.0.0.0 \
  -e UNOSIM_EXAMPLES_ALLOWED_HOSTS=api.github.com,raw.githubusercontent.com \
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

Die Pfade für Temp und Arduino-Cache werden absichtlich mit denselben absoluten Pfaden auf Host und im Servercontainer verwendet. Die dynamisch gestarteten Sandboxen benötigen diese Übereinstimmung.

Der Dienst ist anschließend nur auf dem Ubuntu-Rechner unter folgender Adresse erreichbar:

```text
http://127.0.0.1:3000
```

Die Host-Bindung `127.0.0.1:3000:3000` verhindert Zugriffe aus dem LAN.

## 6. Zugriff aus einem privaten LAN ohne Gateway

Dieser Modus ist nur für ein **vertrauenswürdiges privates Netz** gedacht.

### 6.1 IPv4-Adresse des Ubuntu-Rechners ermitteln

```bash
ip -4 addr show scope global
```

Typischerweise erscheinen mindestens zwei Adressen:

- eine private LAN-Adresse wie `192.168.178.181`,
- eine interne Docker-Adresse wie `172.17.0.1`.

Für Browser im LAN ist die **LAN-Adresse des Ubuntu-Hosts bzw. der VM** zu verwenden, nicht die Docker-Adresse.

Im folgenden Beispiel wird `192.168.1.50` verwendet. Ersetze diese Adresse durch die tatsächliche LAN-IP.

### 6.2 Container für LAN-Zugriff neu erstellen

Falls bereits ein lokaler Container läuft:

```bash
docker rm -f unosim-local
```

Dann:

```bash
docker run -d \
  --name unosim-local \
  --restart unless-stopped \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  -p 0.0.0.0:3000:3000 \
  -e PORT=3000 \
  -e UNOSIM_SERVER_MODE=docker \
  -e UNOSIM_SIMULATION_MODE=docker-sandbox \
  -e UNOSIM_TRUST_MODE=local \
  -e UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true \
  -e UNOSIM_LISTEN_HOST=0.0.0.0 \
  -e UNOSIM_ALLOWED_WS_ORIGINS=http://192.168.1.50:3000 \
  -e UNOSIM_EXAMPLES_ALLOWED_HOSTS=api.github.com,raw.githubusercontent.com \
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

Die Browser-Origin muss exakt zur verwendeten URL passen. Bei der Beispieladresse lautet sie:

```text
http://192.168.1.50:3000
```

Diese Adresse muss sowohl in `UNOSIM_ALLOWED_WS_ORIGINS` als auch im Browser verwendet werden.

> [!NOTE]
> UnoSim kann in seiner Startausgabe zusätzlich eine Adresse aus dem Docker-Netz wie `http://172.17.0.2:3000` anzeigen. Diese Adresse gehört zum internen Container-Netz und ist für normale LAN-Clients nicht die richtige Browser-Adresse.

### 6.3 Firewall begrenzen

Falls `ufw` aktiv ist, Port 3000 auf das private Netz begrenzen. Beispiel für ein `/24`-Netz:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
```

Das Subnetz muss an das eigene Netz angepasst werden. Keine öffentliche Firewall-Regel und keine Portweiterleitung aus dem Internet einrichten.

## 7. Bereitschaft prüfen

Zuerst den Containerstatus prüfen:

```bash
docker ps --filter name=unosim-local
```

Der Status muss `Up ...` anzeigen. `Restarting (...)` bedeutet, dass UnoSim beim Start mit einem Konfigurationsfehler abbricht.

Logs prüfen:

```bash
docker logs --tail 100 unosim-local
```

Readiness prüfen:

```bash
curl -fsS http://127.0.0.1:3000/api/readiness
```

Erwartet:

```json
{"status":"ready"}
```

In den Logs sollte die aktive Konfiguration unter anderem folgende Werte zeigen:

```text
Server Mode:          docker
Simulation Mode:      docker-sandbox
Trust Mode:           local
NODE_ENV:             production
Listen Host:          0.0.0.0
Port:                 3000
```

## 8. Vollständigen Funktionstest durchführen

Ein erfolgreicher Readiness-Check bestätigt nur den Serverstart. Für einen vollständigen Installationstest zusätzlich im Browser:

1. UnoSim öffnen.
2. Ein Beispiel laden oder einen einfachen Sketch öffnen.
3. Kompilieren.
4. Simulation starten.
5. Serial-Ausgabe prüfen.
6. Pause/Resume/Stop testen.

Parallel kann auf dem Ubuntu-Host beobachtet werden, ob Sandbox-Container dynamisch erzeugt werden:

```bash
watch -n 1 docker ps
```

Beim Start einer Simulation müssen zusätzlich zum Servercontainer Sandbox-Container erscheinen. Damit ist bestätigt, dass auch der Pfad

```text
Browser -> UnoSim-Servercontainer -> Docker-Socket -> Sandbox-Container
```

funktioniert.

## 9. Stoppen und entfernen

```bash
docker stop unosim-local
docker rm unosim-local
```

Oder in einem Schritt:

```bash
docker rm -f unosim-local
```

## 10. UnoSim aktualisieren

Repository aktualisieren:

```bash
cd /srv/unosim
git pull --ff-only
```

Danach beide Images neu bauen:

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
docker build -f Dockerfile -t unosim-server:latest .
```

Anschließend den vorhandenen Servercontainer entfernen und mit der gewünschten Konfiguration aus Abschnitt 5 oder 6 neu erstellen.

## Fehlerbehebung

### Docker-Socket: `permission denied`

Prüfen:

```bash
id
stat -c '%g' /var/run/docker.sock
docker info
```

Der Benutzer muss Mitglied der Gruppe `docker` sein. Nach `usermod -aG docker "$USER"` ist eine neue Login-Sitzung oder ein Neustart erforderlich.

### Container steht auf `Restarting (1)`

Logs lesen:

```bash
docker logs --tail 100 unosim-local
```

Nicht zuerst Ports oder Netzwerk ändern: Ein Restart-Loop bedeutet normalerweise, dass der Node-Prozess bereits beim Start abbricht.

### `Production requires UNOSIM_TRUST_MODE=gateway`

Für den in dieser Anleitung beschriebenen bewusst gateway-freien Local-Trust-Betrieb fehlt:

```text
UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true
```

Das ist absichtlich ein expliziter Opt-in. Nicht für öffentliche Installationen verwenden.

### `UNOSIM_EXAMPLES_ALLOWED_HOSTS is required for external examples in production`

Die standardmäßige externe Beispielsammlung benötigt im Production-Modus eine explizite Host-Freigabe:

```text
UNOSIM_EXAMPLES_ALLOWED_HOSTS=api.github.com,raw.githubusercontent.com
```

Alternativ kann eine Installation ohne externe Beispielquelle konfiguriert werden; dann müssen `UNOSIM_EXAMPLES_SOURCE` und die dazugehörigen Einstellungen entsprechend angepasst werden.

### Sandbox-Image fehlt

Prüfen:

```bash
docker images | grep unosim-sandbox
```

Falls es fehlt:

```bash
docker build -f Dockerfile.sandbox -t unosim-sandbox:latest .
```

### Sandbox findet Dateien nicht

Sicherstellen, dass `UNOSIM_SHARED_TEMP_DIR` und der Host-/Container-Mount denselben absoluten Pfad verwenden. Entsprechendes gilt für `ARDUINO_CACHE_DIR`.

### Keine Verbindung vom Browser

Prüfen:

```bash
docker ps
docker logs --tail 100 unosim-local
curl -fsS http://127.0.0.1:3000/api/readiness
```

Bei LAN-Zugriff zusätzlich prüfen:

- richtige LAN-IP des Ubuntu-Hosts bzw. der VM,
- Port-Bindung `0.0.0.0:3000:3000`,
- exakte `UNOSIM_ALLOWED_WS_ORIGINS`,
- lokale Firewall.

### Compile-Fehler

Arduino CLI und der `arduino:avr`-Core werden bereits beim Bau des Server-Images installiert. Sie müssen nicht zusätzlich auf dem Ubuntu-Host installiert werden. Zuerst Server- und Sandbox-Logs prüfen.

## Sicherheitsgrenze dieses Modus

Der gateway-freie LAN-Modus ist bewusst unkompliziert, aber nicht für unkontrollierte Netze gedacht:

- `UNOSIM_TRUST_MODE=local` authentifiziert keine Benutzer,
- `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL=true` hebt die Production-Sperre absichtlich auf,
- `0.0.0.0:3000` macht den Dienst auf allen Host-Interfaces erreichbar,
- der Servercontainer hat Zugriff auf den Docker-Socket.

Für einen sicheren Mehrbenutzer- oder öffentlich erreichbaren Betrieb diesen Modus nicht nach außen öffnen, sondern [`INSTALL_SERVER.md`](INSTALL_SERVER.md) mit Gateway verwenden.
