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

### Docker-Betrieb (alle Docker-Varianten)

Diese Risiken gelten für alle Docker-basierten Betriebsarten (mit oder ohne Sandbox).

| Risiko | Auswirkung | Schweregrad |
| --- | --- | --- |
| Backend-Kompromittierung über Docker-Socket | Wenn das Backend selbst angegriffen wird, kann über den Docker-Socket der Host gefährdet werden | Mittel–Hoch |
| Mutable Image-/Toolchain-Tags | Ein späteres Update kann Verhalten oder Schwachstellen einführen | Mittel |

### Sandbox-isolierte Container-Umgebung

Docker-basierte Ausführung mit Prozess-Isolation (docker-sandbox mode, empfohlen für Produktion). Dies ist die sicherste Betriebsart mit der höchsten Isolation.

| Risiko | Auswirkung | Schweregrad |
| --- | --- | --- |
| Compiler-/Parser-Schwachstellen | Fehler in Toolchain oder Parser können zu DoS oder Absturz führen (isoliert in Sandbox) | Gering–Mittel |

### Containerisierte Ausführung ohne Prozess-Isolation

Docker-basierte Ausführung ohne zusätzliche Prozess-Isolation (vereinfachte Container-Variante). Bietet Container-Isolation vom Host, aber keine Prozess-Isolation zwischen Sketch-Ausführungen.

| Risiko | Auswirkung | Schweregrad |
| --- | --- | --- |
| Schreibbarer Sketch-Mount | Der ausgeführte Sketch kann andere Container-Prozesse oder Dateien beeinflussen | Hoch |
| Compiler-/Parser-Schwachstellen | Fehler in Toolchain oder Parser können andere Container-Prozesse beeinträchtigen | Mittel |
| Ressourcen- oder Verbindungs-DoS | Viele WebSockets, große Eingaben oder Warteschlangen können CPU/RAM binden | Mittel |

### Host-native Ausführung

Direkte native Ausführung ohne Container-Isolation. Dies ist die unsicherste Betriebsart; nur für isolierte Entwicklungsumgebungen empfohlen.

| Risiko | Auswirkung | Schweregrad |
| --- | --- | --- |
| Lokaler Modus ohne Authentifizierung | Jeder erreichbare Client kann Simulationen und Steuerkanäle verwenden | Kritisch |
| Schreibbarer Sketch-Mount | Der ausgeführte Sketch kann Host-Dateien direkt beschädigen oder verändern | Kritisch |
| Compiler-/Parser-Schwachstellen | Fehler in Toolchain oder Parser können den Host direkt kompromittieren | Hoch |
| Ressourcen- oder Verbindungs-DoS | Viele WebSockets, große Eingaben oder Warteschlangen können den Host lahmlegen | Hoch |

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
