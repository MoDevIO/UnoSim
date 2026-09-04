# UnoSim Security

Dieses Dokument beschreibt die aktuell implementierten Schutzmaßnahmen und die
verbleibenden Risiken. Es ergänzt [`README_ADMIN.md`](README_ADMIN.md) und ist
für Betreiber von Entwicklungs- und Produktionsinstanzen bestimmt.

## Vorhandene Maßnahmen

### Zugriff und Transport

- Im Produktionsbetrieb ist `UNOSIM_TRUST_MODE=gateway` vorgeschrieben. Ein
  authentifizierender Reverse Proxy muss den Benutzer, die Rolle und den
  vertrauenswürdigen Proxy liefern.
- `UNOSIM_GATEWAY_SECRET` wird mit mindestens 32 Zeichen verlangt und sicher
  geprüft; Proxy- und Origin-Header werden validiert.
- WebSocket-Verbindungen werden in Gateway-Mode auf eine explizite Liste
  erlaubter Origins (`UNOSIM_ALLOWED_WS_ORIGINS`) beschränkt. Fehlende oder
  unzulässige Origins werden abgewiesen.
- Der lokale Vertrauensmodus bindet standardmäßig nur an `127.0.0.1` und ist
  für Produktion gesperrt, außer bei einem ausdrücklich gesetzten
  Entwicklungs-Override.
- API-Rate-Limiting ist standardmäßig aktiv. `DISABLE_RATE_LIMIT` darf nur in
  isolierten Tests verwendet werden.

### Ausführung fremden Sketch-Codes

- Der empfohlene Produktionsmodus startet jeden Sketch in einem kurzlebigen
  Docker-Sandbox-Container.
- Die Sandbox verwendet kein Netzwerk, ein schreibgeschütztes Root-Dateisystem,
  `no-new-privileges`, keine Linux-Capabilities, begrenzte PIDs sowie CPU-,
  Speicher- und Swap-Limits.
- Schreibzugriff ist auf das jeweilige `/sandbox`-Arbeitsverzeichnis und ein
  begrenztes temporäres Dateisystem beschränkt.
- Sketch-Pfade werden auf das erlaubte Root-Verzeichnis begrenzt; Dateinamen und
  Eingaben werden validiert.
- Kompilierung und Laufzeit besitzen Zeit- und Ausgabelimits. Queue-, Worker-
  und Runner-Pools begrenzen die Parallelität.
- Prozessstarts verwenden Argumentlisten ohne Shell-Interpolation; erlaubte
  Programme und Argumente werden geprüft.

### Qualität und Betrieb

- Sicherheitsrelevante Eingaben, Docker-Verträge, Lifecycle, Pause/Resume und
  Ressourcenlimits werden durch Unit-, Integrations- und Docker-Tests geprüft.
- `./run-tests.sh` führt statische Checks, Tests, Build und SonarQube aus. Das
  Quality Gate muss grün sein und darf keine offenen Issues ausweisen.
- Logs redigieren bekannte Geheimnisfelder wie Token, Secret und Passwort.
- Compose veröffentlicht den Server standardmäßig nur auf Loopback; ein
  öffentliches Deployment muss hinter dem vorgesehenen Gateway betrieben
  werden.

## Potenzielle und verbleibende Risiken

| Risiko | Auswirkung | Gegenmaßnahme für Betreiber |
| --- | --- | --- |
| Lokaler Modus ohne Authentifizierung | Jeder erreichbare Client kann Simulationen und Steuerkanäle verwenden | Nur lokal/isoliert nutzen; Produktion im Gateway-Modus betreiben |
| Docker-Socket-Mount im Backend | Eine Kompromittierung des Backends kann den Docker-Host gefährden | Host nicht öffentlich exponieren, Least-Privilege-Host verwenden, Zugriff überwachen |
| Ressourcen- oder Verbindungs-DoS | Viele WebSockets, große Eingaben oder Warteschlangen können CPU/RAM binden | Rate-Limits aktiv lassen, Pool-/Containerlimits passend setzen, Monitoring und Proxy-Limits verwenden |
| Mutable Image-/Toolchain-Tags | Ein späteres Update kann Verhalten oder Schwachstellen einführen | Images und Arduino-CLI in Releases versionieren und regelmäßig aktualisieren; Digests sind derzeit optional/offen |
| Compiler-/Parser-Schwachstellen | Fehler in Toolchain oder Parser können zu Absturz oder Umgehung führen | Updates zeitnah prüfen, Sandbox-Modus bevorzugen, Sonar- und Sicherheitsgates ausführen |
| Schreibbarer Sketch-Mount | Der ausgeführte Sketch kann Dateien in seinem Arbeitsbereich verändern | Arbeitsverzeichnisse pro Lauf isolieren und nach Ende bereinigen; keine sensiblen Host-Pfade mounten |
| Fehlkonfigurierte Proxy-Header | Gefälschte Identitäten oder ungewollter Zugriff | Proxy-IP/CIDR exakt konfigurieren, `X-UnoSim-*`-Header am Eingang entfernen und nur vom Proxy setzen |
| Geheimnisverlust in Umgebung/Logs | Gateway-Zugang kann missbraucht werden | Secrets nicht committen oder ausgeben, Rotation vornehmen, Logs und CI-Artefakte schützen |
| Veraltete Abhängigkeiten | Bekannte Schwachstellen in Node-, WebSocket- oder Build-Paketen | `npm audit`/Dependabot bzw. vergleichbare Updates und Regressionstests regelmäßig ausführen |

## Mindestanforderungen für Produktion

1. `NODE_ENV=production`, `UNOSIM_TRUST_MODE=gateway` und ein zufälliges
   `UNOSIM_GATEWAY_SECRET` (mindestens 32 Zeichen) setzen.
2. `UNOSIM_TRUSTED_PROXY` und `UNOSIM_ALLOWED_WS_ORIGINS` exakt konfigurieren.
3. `UNOSIM_SIMULATION_MODE=docker-sandbox` verwenden und den Docker-Socket nur
   dem dafür vorgesehenen Backend zugänglich machen.
4. Den Server nicht direkt ins Internet stellen; TLS, Authentifizierung und
   Request-Limits gehören an den Reverse Proxy.
5. Vor jedem Release `./run-tests.sh` ausführen und ein grünes SonarQube-Gate
   sowie keine offenen sicherheitsrelevanten Issues bestätigen.

Sicherheitslücken bitte nicht öffentlich in Issues melden, sondern zunächst an
die für die Instanz verantwortlichen Administratoren. Bei Änderungen an den
Schutzmaßnahmen sind Tests und diese Übersicht gemeinsam zu aktualisieren.
