# UnoSim auf Ubuntu Desktop im LAN

Diese Anleitung richtet eine vorhandene UnoSim-Arbeitskopie als Docker-Server
auf Ubuntu Desktop ein. Nginx stellt HTTPS und die erforderlichen UnoSim-
Gateway-Header bereit. Die Standardkonfiguration verlangt keine Anmeldung:
Sie vergibt die UnoSim-Identität anhand der von Nginx beobachteten Client-IP.

Ein Gateway bleibt im Docker-Betrieb erforderlich; eine Benutzeranmeldung am
Gateway ist optional. Die Anmeldung ist in diesem Installationsskript bewusst
nicht aktiviert. Die Standardkonfiguration ist für ein vertrauenswürdiges
privates LAN gedacht und sollte nicht ungeschützt im Internet erreichbar sein.

## Voraussetzungen

- Ubuntu Desktop mit `systemd`, `apt` und einer aktiven Netzwerkverbindung.
- Eine UnoSim-Arbeitskopie, die diese Anleitung und
  `scripts/install-ubuntu-vbox.sh` enthält.
- Eine IPv4-Adresse, die der VM an ihrer LAN-Netzwerkkarte zugewiesen ist.
  Wähle sie explizit aus der Ausgabe von `ip -br address`; das Skript wählt
  keine Adresse selbst aus.
- Administratorrechte über `sudo`.

Die VM muss für Geräte im LAN erreichbar sein, üblicherweise über eine
gebrückte VirtualBox-Netzwerkkarte. Reserviere die gewählte IPv4-Adresse im
Router für die MAC-Adresse dieser VM, damit sich die Adresse nach einem
Neustart nicht ändert.

## Installation

Wechsle in die UnoSim-Arbeitskopie und übergib ihre LAN-Adresse:

```bash
cd ~/UnoSim
chmod +x scripts/install-ubuntu-vbox.sh
./scripts/install-ubuntu-vbox.sh --lan-ip 192.168.178.82
```

Ersetze `192.168.178.82` durch die IPv4-Adresse deiner VM. Das Skript prüft,
dass sie auf diesem Rechner konfiguriert ist. Es installiert Docker Engine,
Compose v2, Buildx, Nginx, OpenSSL und curl, erzeugt die lokalen
Konfigurationsdateien, baut die Sandbox und startet den UnoSim-Backenddienst.
Wenn bereits eine `.env`-Datei, eine UnoSim-Nginx-Site, das Gateway-Secret-
Snippet oder ein TLS-Ziel existiert, bricht das Skript ab, damit nichts
überschrieben wird. Zeigt `sites-enabled/default` auf
`sites-available/default`, deaktiviert das Skript nur diesen Symlink; die
Konfigurationsdatei selbst bleibt erhalten. Ein nicht-standardmäßiger Symlink
an dieser Stelle führt zum Abbruch.

Das Skript bindet das Backend an `127.0.0.1:3000`. LAN-Clients erreichen es
über Nginx auf TCP-Port 443. Der alternative HTTPS-Port 8443 bleibt ebenfalls
aktiv.

## Hostname und URLs

Damit `unosim.vbox` auf die VM-Adresse zeigt, gibt es zwei Möglichkeiten:

- **Ganzes LAN:** Lege im Router einen lokalen DNS-Eintrag
  `unosim.vbox → <LAN-IP-der-VM>` an.
- **Ein einzelner Client:** Trage auf diesem Gerät in dessen Hosts-Datei die
  Zeile `<LAN-IP-der-VM> unosim.vbox` ein. Beispiel für macOS/Linux:

  ```text
  192.168.178.82 unosim.vbox
  ```

Öffne danach eine der Adressen:

- `https://unosim.vbox/` — HTTPS-Standardport 443
- `https://unosim.vbox:8443/` — alternativer HTTPS-Port

Das Skript konfiguriert beide Ports sowohl auf Loopback als auch auf der
angegebenen LAN-Adresse. Die IP-URL ist ebenfalls möglich, wenn das Zertifikat
auf dem Client importiert wurde:
`https://192.168.178.82/` oder `https://192.168.178.82:8443/`.

## Zertifikat auf dem Client vertrauen

Das Skript erzeugt ein selbstsigniertes Zertifikat mit den Namen
`unosim.vbox`, `localhost`, `127.0.0.1` und der angegebenen LAN-IP. Die Datei
liegt auf der VM unter:

```text
/etc/nginx/unosim-tls/unosim-lan.crt
```

Importiere dieses Zertifikat auf jedem Client, der UnoSim ohne Browserwarnung
verwenden soll. Importiere nur das Zertifikat (`.crt`), niemals den privaten
Schlüssel (`.key`).

### macOS

Nachdem du die Zertifikatsdatei auf den Mac übertragen hast:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ~/Downloads/unosim-lan.crt
```

Starte den Browser neu. Firefox kann eine eigene Zertifikatsverwaltung
verwenden: Öffne die Einstellungen für Datenschutz und Sicherheit, dann
Zertifikate anzeigen und das Zertifikat unter „Zertifizierungsstellen“ für das
Identifizieren von Websites freigeben.

### Zertifikatsdatei vorübergehend per SSH übertragen (optional)

Das Installationsskript installiert oder aktiviert keinen SSH-Server. Wenn du
die Datei nicht über einen anderen sicheren Weg kopierst, kannst du SSH
vorübergehend installieren und anschließend wieder abschalten:

1. Auf der VM:

   ```bash
   sudo apt install openssh-server
   sudo systemctl enable --now ssh.socket
   sudo install -o "$USER" -g "$(id -gn)" -m 644 \
     /etc/nginx/unosim-tls/unosim-lan.crt "$HOME/unosim-lan.crt"
   ```

2. Auf dem Client (Beispiel macOS):

   ```bash
   scp user@192.168.178.82:/home/user/unosim-lan.crt \
     ~/Downloads/unosim-lan.crt
   ```

   Ersetze `user`, die IP-Adresse und den Pfad durch deine Werte.

3. Sobald die Übertragung beendet ist, auf der VM:

   ```bash
   sudo systemctl disable --now ssh.socket ssh.service
   rm "$HOME/unosim-lan.crt"
   ```

   Danach kannst du das Zertifikat wie oben beschrieben auf dem Client
   importieren. Falls ein Passwortdialog für den SSH-Schlüssel oder das
   Benutzerkonto erscheint, ist das die SSH-Anmeldung, nicht UnoSim.

## Optional: Anmeldung am Gateway

Die Installation lässt Nginx ohne Benutzeranmeldung laufen. Wenn du vor den
Zugriff eine Passwortabfrage setzen möchtest, kannst du Nginx nachträglich um
HTTP Basic Auth ergänzen. Das erfordert weiterhin HTTPS:

```bash
sudo apt install apache2-utils
if sudo test -e /etc/nginx/unosim.htpasswd; then
  sudo htpasswd -B /etc/nginx/unosim.htpasswd vbox
else
  sudo htpasswd -cB /etc/nginx/unosim.htpasswd vbox
fi
sudo chmod 600 /etc/nginx/unosim.htpasswd
```

Füge innerhalb des `server`-Blocks in
`/etc/nginx/sites-available/unosim` folgende Direktiven ein:

```nginx
auth_basic "UnoSim";
auth_basic_user_file /etc/nginx/unosim.htpasswd;
```

Prüfe und lade die Konfiguration neu:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

HTTP Basic Auth begrenzt den Zugriff auf Konten mit Passwort. Die von der
Standardkonfiguration gesetzte UnoSim-Identität bleibt trotzdem die Client-IP;
Anmeldungen von derselben IP teilen weiterhin ihre Limits. Wenn du auch eine
eigene UnoSim-Identität pro Konto brauchst, muss der Proxy-Subject aus der
authentifizierten Identität abgeleitet und auf das erlaubte Subject-Format
beschränkt werden.

## Firewall und Funktion prüfen

Das Skript verändert keine UFW- oder sonstige Firewall-Regeln. Prüfe, ob auf
der VM eine Firewall aktiv ist:

```bash
sudo ufw status verbose
```

Wenn UFW aktiv ist, erlaube HTTPS im privaten Netz. Port 8443 ist optional:

```bash
sudo ufw allow from <LAN-CIDR> to any port 443 proto tcp
sudo ufw allow from <LAN-CIDR> to any port 8443 proto tcp
```

Ersetze `<LAN-CIDR>` durch das lokale Netz, zum Beispiel
`192.168.178.0/23`. Wenn eine andere Firewall aktiv ist, richte dort
entsprechende LAN-Regeln ein.

Prüfe auf der VM, ob Compose den Backenddienst gestartet hat und Nginx
Readiness liefert:

```bash
cd ~/UnoSim
sudo docker compose ps
curl -k https://127.0.0.1/api/readiness
```

`-k` umgeht hier nur die noch nicht importierte selbstsignierte Zertifikats-
Signatur. Es ist keine empfohlene Option für den normalen Browserbetrieb.
Rufe danach im Client `https://unosim.vbox/` auf, importiere bei Bedarf das
Zertifikat und starte eine Simulation. Teste zum Beispiel eine Skizze mit
`Serial.begin(115200)` und einer wiederholten `Serial.println`-Ausgabe; damit
prüfst du auch die WebSocket-Verbindung.

Wenn Docker nach der Aufnahme in die Gruppe `docker` noch `permission denied`
meldet, melde dich einmal ab und wieder an. Bis dahin kannst du Docker-Befehle
mit `sudo` ausführen. Die Mitgliedschaft in der Gruppe `docker` verleiht
weitreichende Rechte auf dem Host.

## Identität und Limits

Das Gateway-Secret, die Rolle `user`, der Subject und die genaue
WebSocket-Origin-Allowlist bleiben für den Docker-Betrieb erforderlich. Nginx
setzt diese Header auch dann selbst, wenn es keinen Browser-Benutzer anmeldet.
`UNOSIM_TRUSTED_PROXY` konfiguriert Express-Proxy-Trust und ist keine
Quell-IP-Zugriffsliste der Gateway-Autorisierung. Die Loopback-Bindung des
Backends hält den direkten LAN-Zugriff auf den Backend-Port geschlossen.

In der IP-Variante setzt Nginx den Subject aus der direkt beobachteten
Quell-IP (`$remote_addr`), nicht aus dem vom Client gesendeten
`X-Forwarded-For`-Header. Geräte, die mit derselben Quell-IP ankommen, teilen
deshalb ihre UnoSim-Identität, Rate-Limits und Simulationszulassungen. Das kann
bei NAT, VPN oder einem vorgeschalteten Proxy mehrere Personen betreffen. Die
genaue Zahl gleichzeitig zugelassener Simulationen pro Identität ergibt sich
aus dem verwendeten UnoSim-Quellstand
und dessen Konfiguration; die Dokumentation garantiert dafür keinen einzelnen
festen Wert.

Das Skript trägt diese exakten HTTPS-Origins in `.env` ein (für `<LAN-IP>` wird
die beim Aufruf angegebene Adresse eingesetzt):

```text
https://unosim.vbox
https://unosim.vbox:8443
https://<LAN-IP>
https://<LAN-IP>:8443
https://localhost
https://localhost:8443
https://127.0.0.1
https://127.0.0.1:8443
```

Weitere Details stehen in [docs/INSTALL_SERVER.md](docs/INSTALL_SERVER.md),
[docs/SECURITY.md](docs/SECURITY.md) und
[ADR 0008](docs/adr/0008-optional-gateway-authentication.md).
