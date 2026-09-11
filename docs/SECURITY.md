# UnoSim Security

Dieses Dokument beschreibt die aktuell implementierten Schutzmaßnahmen und die
verbleibenden Risiken. Die Betriebsanleitung steht in
[`INSTALL_SERVER.md`](INSTALL_SERVER.md) und ist
für Betreiber von Entwicklungs- und Produktionsinstanzen bestimmt.

Der operative Sandbox-Vertrag ist in dieser Datei und in
[`INSTALL_SERVER.md`](INSTALL_SERVER.md) dokumentiert; die historische
Validierung liegt im Archiv.

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
  Entwicklungs-Override. `npm run dev:lan` setzt diesen Override gezielt für
  einen vertrauenswürdigen lokalen Netzwerktest; er ist kein Produktionsmodus.
- Das allgemeine API-Limit sowie separate Compile- und Simulationsstart-Limits
  sind standardmäßig aktiv. `DISABLE_RATE_LIMIT` darf nur in isolierten Tests
  verwendet werden.
- Gateway-Limits verwenden ausschließlich den nach Secret- und Rollenprüfung
  akzeptierten Subject. Local/Test-Clients werden durch serverseitig signierte
  Local-Session-Cookies getrennt; `X-UnoSim-Subject`, `X-Test-Run-ID` und
  Query-Parameter sind dort keine vertrauenswürdige Nutzeridentität.

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
- Pro Subject darf höchstens ein Simulationsstart reserviert sein. Die
  tokenisierte Reservation umfasst laufende und wartende Starts und wird bei
  Stop, Disconnect, Start-/Compilefehler, Timeout und Cleanup freigegeben.
  Eine globale, prozesslokale Admission-Grenze weist zusätzliche Starts sofort
  mit `SYSTEM_BUSY` ab, bevor sie die Runner-Queue verlängern.
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

### External-Examples-Quellen

Die aktuelle Implementierung lädt External Examples ausschließlich über die
serverseitig konfigurierte HTTPS-Quelle und einen festen Ref. Die akzeptierte
Zielarchitektur aus ADR 0005 ergänzt einen browser-spezifischen Repository-/
Channel-Override. Dieser Override ist untrusted input und darf keine
Sicherheitsgrenze konfigurieren oder lockern.

- Der Browser überträgt nur einen normalisierten GitHub-Slug und einen logischen
  Channel an UnoSim; er ruft GitHub oder Raw-GitHub niemals direkt auf.
- Raw-URLs, Hosts, Allowlists, Credentials, Timeouts und Größenlimits bleiben
  ausschließlich serverseitig kontrolliert.
- Der Server erzwingt HTTPS, exakte erlaubte GitHub-/Raw-GitHub-Hosts, das
  Verbot von IP-Literalen, DNS-/Private-Address-Prüfung, Redirect-Verbot,
  Pfadnormalisierung, Timeouts, Größenlimits und strikte Schemaprüfung.
- Produktionsinhalt wird nur aus einem vollständigen Commit-SHA geladen. Ein
  Channel-Wechsel wird erst nach vollständiger Prüfung atomar aktiviert; bei
  Fehlern ist nur LKG derselben Repository-/Channel-Auswahl zulässig.
- Override-Auflösung wird authentifiziert beziehungsweise an die lokale
  signierte Session gebunden, rate-limited und gegen unbegrenzte Source- und
  Cache-Cardinality begrenzt. Anonyme Gateway-Requests dürfen nur den Default
  verwenden.
- Repository und Channel sind nicht-sensitive Nutzerpräferenzen und dürfen im
  Browser persistent sein. Diese Ausnahme gilt nicht für Credentials,
  Tutor-API-Keys, Dialoghistorien oder andere sensible Daten.

Die dynamische Auswahl ist noch nicht implementiert. Der Fachvertrag steht in
[`../ssot/ssot_function_definition_ExternalExamples.md`](../ssot/ssot_function_definition_ExternalExamples.md),
die verbindlichen In-Memory-, Rate- und Concurrency-Limits im
[`EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md`](EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md).

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
5. Anwendungsseitige Rate Limits und Admission Control nicht deaktivieren;
   Grenzänderungen nur anhand neuer Lastmessungen vornehmen.
6. Vor jedem Release `./run-tests.sh` ausführen und ein grünes SonarQube-Gate
   sowie keine offenen sicherheitsrelevanten Issues bestätigen.

Sicherheitslücken bitte nicht öffentlich in Issues melden, sondern zunächst an
die für die Instanz verantwortlichen Administratoren. Bei Änderungen an den
Schutzmaßnahmen sind Tests und diese Übersicht gemeinsam zu aktualisieren.
