# UnoSim auf Ubuntu Desktop im LAN

Diese Anleitung richtet eine vorhandene UnoSim-Arbeitskopie als Docker-Server
auf Ubuntu Desktop ein. Nginx stellt HTTPS und die erforderlichen UnoSim-
Gateway-Header bereit. Die Standardkonfiguration verlangt keine Anmeldung:
Sie vergibt die UnoSim-Identität anhand der von Nginx beobachteten Client-IP.

Ein Gateway bleibt im Docker-Betrieb erforderlich; eine Benutzeranmeldung am
Gateway ist optional. Die Anmeldung ist in diesem Installationsskript bewusst
nicht aktiviert. Die Standardkonfiguration ist für ein vertrauenswürdiges
privates LAN gedacht und sollte nicht ungeschützt im Internet erreichbar sein.

## Schnellablauf

1. In VirtualBox den Netzwerkadapter auf **Netzwerkbrücke** stellen und in
   Ubuntu die LAN-IPv4-Adresse mit `ip -br address show scope global` ablesen.
2. Git installieren und UnoSim nach `/opt/unosim` klonen.
3. Im Checkout `./scripts/install-ubuntu-vbox.sh --lan-ip <LAN-IP>` starten.
4. Auf dem Client `unosim.vbox` per Router-DNS oder Hosts-Datei auflösen, das
   Zertifikat `/etc/nginx/unosim-tls/unosim-lan.crt` importieren und
   `https://unosim.vbox/` öffnen.
5. Readiness mit `curl` prüfen und den Blink-Sketch am Ende dieser Anleitung
   starten.

Die Abschnitte darunter führen die Schritte im Detail aus. Das Skript richtet
den Server ein; Router-DNS, Client-Zertifikat und Client-Firewall bleiben
separate Schritte.

## Voraussetzungen

- Ubuntu Desktop mit `systemd`, `apt` und einer aktiven Netzwerkverbindung.
- Administratorrechte über `sudo`.

## Ubuntu- und VirtualBox vorbereiten

### Arbeitskopie unter `/opt/unosim` anlegen

Bei einer nackten Ubuntu-Installation fehlt möglicherweise Git. Installiere
es und klone UnoSim als normaler Benutzer nach `/opt/unosim`:

```bash
sudo apt update
sudo apt install -y git
sudo install -d -o "$USER" -g "$(id -gn)" -m 755 /opt/unosim
git clone https://github.com/MoDevIO/UnoSim.git /opt/unosim
cd /opt/unosim
```

Führe `git clone` nicht mit `sudo` aus. So gehören Arbeitskopie und spätere
`.env`-Datei dem normalen Ubuntu-Benutzer. Wenn du bereits eine passende
Arbeitskopie hast, wechsle stattdessen in deren Verzeichnis.

### LAN-Netzwerk der VM einrichten

VirtualBox verwendet häufig zunächst NAT. Eine Adresse wie `10.0.2.15` gibt
der VM normalerweise ausgehenden Netzwerkzugriff, macht den UnoSim-Server aber
nicht direkt für andere Geräte im LAN erreichbar. Schalte die VM aus und
ändere in den VM-Einstellungen unter **Netzwerk** den Adapter auf
**Netzwerkbrücke**. Wähle die physische WLAN- oder Ethernetkarte des Hosts und
aktiviere **Kabel verbunden**. Alternativ kannst du einen zweiten Adapter als
Netzwerkbrücke hinzufügen und NAT für den Internetzugriff beibehalten.

Starte Ubuntu neu und zeige die globalen IPv4-Adressen an:

```bash
ip -br address show scope global
```

Wähle die IPv4-Adresse aus dem LAN, zum Beispiel `192.168.178.82/23`, nicht
die typische NAT-Adresse `10.0.2.15` und keine Docker-Bridge-Adresse. Das
Skript verlangt die Adresse ausdrücklich, kann aber nicht erkennen, ob eine
vom Benutzer angegebene normale Schnittstelle über NAT oder eine
Netzwerkbrücke angebunden ist. Reserviere die LAN-IP anschließend im Router
für die MAC-Adresse der VM, damit sie stabil bleibt.

## Installation

Wechsle in die UnoSim-Arbeitskopie und übergib die zuvor ermittelte LAN-IP.
Beispiel mit `/opt/unosim`:

```bash
cd /opt/unosim
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

Das Skript fügt den Benutzer der Gruppe `docker` hinzu. Die Änderung wird
nach dem nächsten Ab- und Anmelden wirksam. Bis dahin verwendet das Skript
`sudo` für Docker-Befehle; du musst `newgrp` nicht installieren.

Docker zeigt beim Build viele Zwischenschritte und Paketmeldungen an; eine
lange oder farbige Ausgabe ist für sich genommen kein Fehler. Entscheidend ist,
ob der Build mit `ERROR` abbricht und das Skript einen Fehler meldet. Schlägt
der Backend-Build mit Cache fehl, wiederholt das Skript ihn einmal automatisch
mit `--no-cache`. Nach dem Start wartet es auf Readiness sowohl am Backend als
auch über Nginx, bevor es die Installation als erfolgreich meldet.

### Backend-Build nach einem Abbruch erneut ausführen

Falls auch der automatische Build ohne Cache fehlschlägt, bleibt die vom Skript
angelegte `.env` erhalten. Sie enthält das Gateway-Secret und ist für Docker
Compose erforderlich. In einem VM-Test erschien beim ersten Build ein Rollup-
Fehler mit `Unexpected character '\0'` in einer Monaco-Datei. Eine frische
`npm ci`-Installation in einem Node-Container zeigte dort keine NUL-Bytes; ein
Backend-Build ohne Cache war danach erfolgreich. Das belegt nicht sicher die
Ursache, deshalb zeigt das Skript den Buildfehler an und versucht den Cache-freien
Build einmal automatisch.

Wenn dieser erneute Versuch fehlschlägt, kannst du ihn nach Behebung der
angezeigten Ursache manuell ausführen:

```bash
cd /opt/unosim
sudo docker compose --project-directory /opt/unosim build --no-cache unosim-backend
```

Wenn der Build erfolgreich ist, verschiebe die vom fehlgeschlagenen Lauf
angelegte `.env` root-geschützt und starte das Installationsskript erneut. Es
erzeugt dann ein neues Gateway-Secret und führt die noch fehlenden Schritte
aus:

```bash
sudo mv /opt/unosim/.env /root/unosim.env.failed-attempt.$$
cd /opt/unosim
./scripts/install-ubuntu-vbox.sh --lan-ip 192.168.178.82
```

Ersetze die IP durch deine LAN-Adresse. Teile den Inhalt der alten oder neuen
`.env` niemals. Verwende diese Wiederholung nur, wenn der Abbruch beim
Backend-Build vor dem Erzeugen von Zertifikat und Nginx-Site geschah. Wenn
bereits TLS- oder Nginx-Dateien existieren, lösche oder verschiebe sie nicht;
prüfe zuerst den vorhandenen Installationszustand.

## Hostname und URLs

Damit `unosim.vbox` auf die VM-Adresse zeigt, gibt es zwei Möglichkeiten:

- **Ganzes LAN:** Lege im Router einen lokalen DNS-Eintrag
  `unosim.vbox → <LAN-IP-der-VM>` an.
- **Ein einzelner Client:** Trage auf diesem Gerät in dessen Hosts-Datei die
  Zeile `<LAN-IP-der-VM> unosim.vbox` ein. Beispiel für macOS/Linux:

  ```text
  192.168.178.82 unosim.vbox
  ```

Auf macOS kannst du die Zeile zum Beispiel so ergänzen. Führe das nur einmal
aus; wiederholte Ausführung erzeugt doppelte Einträge:

```bash
printf '192.168.178.82 unosim.vbox\n' | sudo tee -a /etc/hosts
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

Wenn du das Zertifikat auf der VM neu erzeugst, etwa nach einer Änderung des
Namens oder der LAN-IP, ist das zuvor importierte Zertifikat veraltet. Übertrage
und vertraue dann die neue `.crt`-Datei auf jedem Client erneut; entferne dort
gegebenenfalls den alten Zertifikatseintrag oder eine alte Browserausnahme.

### macOS

Nachdem du die Zertifikatsdatei auf den Mac übertragen hast:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  ~/Downloads/unosim-lan.crt
```

Teste danach auf dem Mac die TLS-Prüfung ohne `-k`:

```bash
curl --fail --show-error https://unosim.vbox/api/readiness
```

Erwartet wird `{"status":"ready"}`. Safari verwendet das macOS-System-
Schlüsselbund. Aktuelle Firefox-Versionen können installierte
System-Stammzertifikate ebenfalls automatisch vertrauen. Prüfe in **Einstellungen
→ Datenschutz & Sicherheit → Zertifikate**, ob die Option **„Firefox erlauben,
Stammzertifikaten von Drittanbietern, die Sie installieren, automatisch zu
vertrauen“** aktiviert ist. Entferne in Firefox gegebenenfalls eine alte
Sicherheitsausnahme für `unosim.vbox` und starte Firefox vollständig neu.
Wenn Firefox weiter warnt, importiere das `.crt` zusätzlich über
**Zertifikate verwalten → Zertifizierungsstellen → Importieren** und erlaube
damit das Identifizieren von Websites. Importiere niemals den privaten
Schlüssel. Mozilla beschreibt die Systemeinstellung in der
[Firefox-Hilfe](https://support.mozilla.org/en-US/kb/automatically-trust-third-party-certificates).

### Zertifikatsdatei vorübergehend per SSH übertragen (optional)

Das Installationsskript installiert oder aktiviert keinen SSH-Server. Wenn du
die Datei nicht über einen anderen sicheren Weg kopierst, kannst du SSH
vorübergehend installieren und anschließend wieder abschalten:

1. Auf der VM:

   ```bash
   sudo apt install -y openssh-server
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
   sudo systemctl disable --now ssh.socket
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
Readiness liefert. Passe den Checkout-Pfad an, falls du nicht `/opt/unosim`
verwendest:

```bash
cd /opt/unosim
sudo docker compose ps
curl -k --fail --show-error https://localhost/api/readiness
```

Erwartet wird `{"status":"ready"}`. `-k` ignoriert bei diesem VM-internen
Test nur das noch nicht importierte selbstsignierte Zertifikat. Es gehört
nicht in den normalen Browserbetrieb.

Teste danach auf dem Client Hostname, LAN-Verbindung und Proxy. Vor dem Import
des Zertifikats bestätigt `-k` nur die Erreichbarkeit:

```bash
curl -k --fail --show-error https://unosim.vbox/api/readiness
```

Nach dem Zertifikatimport muss derselbe Test ohne `-k` funktionieren:

```bash
curl --fail --show-error https://unosim.vbox/api/readiness
```

Öffne dann `https://unosim.vbox/` im Browser. Für einen sichtbaren
Simulationstest ersetze den Editorinhalt durch diesen Sketch und klicke auf
**Start**. Die eingebaute LED soll blinken; damit werden Kompilierung,
WebSocket-Verbindung und Simulation gemeinsam geprüft:

```cpp
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
```

Der Test mit `curl` prüft den Dienst und das Gateway; der Blink-Sketch prüft
zusätzlich den Browser-WebSocket und die Simulation. In der getesteten
macOS-Konfiguration funktionierten `curl`, Safari und die Simulation. Falls
Readiness und Safari funktionieren, Firefox aber nicht startet, liegt ein
separates Firefox-Problem vor; die Firefox-Zertifikatshinweise oben betreffen
nur die Vertrauensstellung des Zertifikats.

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
