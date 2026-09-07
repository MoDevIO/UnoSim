# Unabhängige technische Betriebsreife- und Sicherheitsprüfung

Stand: 2026-09-07  
Geltungsbereich: aktueller Repository-Zustand von UnoSim, bewertet als reale Lehrbetriebs-Software für einen Hochschulserver.  
Prüfmodus: ausschließlich Code-, Test-, Architektur-, Dokumentations- und Betriebsevidenz; keine Produktivcode-Änderungen.

## 1. Gesamturteil

**Urteil: GO WITH CONDITIONS für kontrollierten Hochschulbetrieb.**

UnoSim ist in der aktuellen Form für einen realen, aber klar begrenzten Lehrbetrieb technisch vertretbar, wenn die dokumentierte Produktionsarchitektur strikt eingehalten wird. Das System ist **kein hochverfügbares Mehrknoten-System**, sondern ein einzelner zustandsbehafteter Backend-Prozess mit Docker-Sandboxing und Gateway-Authentifizierung.

### Harte Betriebsbedingungen

| Bedingung | Bewertung |
|---|---|
| Öffentliche oder campusweite Nutzung nur hinter Gateway | zwingend |
| Backend-Port nicht direkt erreichbar, bevorzugt Loopback-Bindung | zwingend |
| `UNOSIM_TRUST_MODE=gateway` | zwingend |
| `UNOSIM_SERVER_MODE=docker` und `UNOSIM_SIMULATION_MODE=docker-sandbox` | zwingend |
| `UNOSIM_GATEWAY_SECRET` und `UNOSIM_TRUSTED_PROXY` korrekt gesetzt | zwingend |
| Exakte WebSocket-Origin-Allowlist über `UNOSIM_ALLOWED_WS_ORIGINS` | zwingend |
| Keine HA-Zusage, keine Sitzungsfortsetzung nach Backend-Neustart | zwingend kommunizieren |
| Freigegebene Kapazität: bis 200 parallele Kompilierungen, bis 100 parallele Simulationen | zwingend |
| 200 parallele Simulationen | **nicht freigegeben** |
| Externes Monitoring und Alarmierung vor Produktivstart | dringend erforderlich |

### NO-GO-Szenarien

UnoSim ist in der aktuellen Form **nicht produktionsreif** für:

- direkten Internet- oder LAN-Zugriff auf den Backend-Port,
- Produktivbetrieb im lokalen Trust- oder lokalen Simulationsmodus,
- Hochverfügbarkeit, Rolling Updates ohne Sitzungsverlust oder horizontale Skalierung,
- 200 gleichzeitige Simulationsstarts als zugesicherte Lehrbetriebskapazität,
- Betrieb ohne aktive Überwachung von Docker, Disk, Queue-Längen und Fehlerquoten.

## 2. Evidenzbasis

| Bereich | Evidenz |
|---|---|
| Produktionsbetrieb | `docs/INSTALL_SERVER.md`, `docker-compose.yml`, `Dockerfile`, `Dockerfile.sandbox` |
| Architektur | `docs/ARCHITECTURE.md`, `server/index.ts`, `server/routes.ts` |
| Security | `docs/SECURITY.md`, `docs/adr/0001-authentication-and-gateway-contract.md`, `server/security/access-control.ts` |
| Kapazität | `docs/SCALABILITY.md`, `load-test-results/latest-summary.txt`, Simulationsergebnisdateien unter `load-test-results/` |
| Laufzeitkontrollen | `server/config.ts`, `server/services/sandbox-runner-pool.ts`, `server/services/sandbox/execution-manager.ts`, `server/services/sandbox/docker-manager.ts` |
| Observability | `server/routes/status.routes.ts`, `server/services/server-metrics.ts` |
| Tests | `tests/server/security/access-control.test.ts`, `tests/integration/docker-security-contract.test.ts`, `tests/server/services/sandbox-runner-pool.test.ts`, `tests/server/load-50-client-simulation-observability.test.ts` und weitere spezialisierte Tests |

## 3. Security-Prüfung

### 3.1 Authentifizierung und Vertrauensgrenze

Die Sicherheitsarchitektur ist für einen Gateway-Betrieb ausgelegt. `parseTrustConfig` und die Middleware in `server/security/access-control.ts` erzwingen im Gateway-Modus ein gemeinsames Gateway-Secret, einen expliziten vertrauenswürdigen Proxy und eingeschränkte Rollen. Die ADR `docs/adr/0001-authentication-and-gateway-contract.md` beschreibt zusätzlich, dass der Gateway eingehende `X-UnoSim-*`-Header entfernen und kontrolliert neu setzen muss.

| Prüfpunkte | Ergebnis | Restrisiko |
|---|---:|---|
| Gateway-Modus mit Secret | positiv | Sicherheit hängt an korrekter Gateway-Konfiguration und Geheimnisverwaltung. |
| Trusted-Proxy-Prüfung per IP/CIDR | positiv | Falsche Proxy-IP/CIDR kann legitime Nutzer blockieren oder Spoofing erleichtern. |
| Header-basierte Identität | bedingt positiv | Nur sicher, wenn Backend nicht direkt erreichbar ist und der Gateway Header zuverlässig strippt. |
| WebSocket-Identität beim Upgrade fixiert | positiv | Kein späterer Identitätswechsel per WS-Nachricht erkennbar. |
| Rollenmodell | bewusst minimal | Nur Rolle `user`; keine differenzierten Admin-/Dozentenrechte. |
| Secret-Rotation | unvollständig | ADR nennt kurze Zwei-Secret-Überlappung; aktuelle Evidenz zeigt primär Ein-Secret-Betrieb. |

**Bewertung:** tragfähig bei korrekter Gateway-Isolierung; kritisch bei direkter Backend-Erreichbarkeit.

### 3.2 Transport-, Browser- und Header-Schutz

`docs/INSTALL_SERVER.md` verlangt TLS-Terminierung im Gateway und verbirgt den Backend-Port. `docker-compose.yml` bindet standardmäßig an `127.0.0.1:3000`. WebSocket-Origin-Prüfungen sind über `UNOSIM_ALLOWED_WS_ORIGINS` vorgesehen.

Auffällig ist in `server/index.ts`, dass Helmet-CSP konfiguriert wird, danach aber ein eigenes `Content-Security-Policy`-Header nur für `frame-ancestors` gesetzt wird. Dadurch kann die vollständige Helmet-CSP effektiv überschrieben werden. Das ist kein unmittelbarer Betriebsblocker, aber ein klarer Security-Hardening-Befund.

| Prüfpunkte | Ergebnis | Restrisiko |
|---|---:|---|
| TLS | ausgelagert an Gateway | App selbst erzwingt TLS nicht. |
| Backend-Bindung | positiv dokumentiert und Compose-Default loopback | Betreiber können `UNOSIM_BIND_ADDRESS` unsicher überschreiben. |
| WebSocket-Origin-Allowlist | positiv | Nicht-Browser-Clients werden dadurch nicht aufgehalten; Auth-Gateway bleibt entscheidend. |
| CSP | verbesserungsbedürftig | Mögliche CSP-Abschwächung durch Header-Overwrite. |

### 3.3 Eingabevalidierung, Ratenbegrenzung und Missbrauchsschutz

Die wichtigsten Nutzerpfade sind begrenzt: REST-Body-Limit 1 MiB, Compile-Code-Limit 128 KiB, WebSocket-Payload-Limit 256 KiB, Serial-Input-Limit 4 KiB und strikte Zod-Schemata in `shared/schema.ts` und `shared/input-limits.ts`. `/api/compile`, `/api/sketches` und `/api/status` werden über `requireUser` geschützt.

Die Ratenbegrenzung ist vorhanden, aber kein vollständiger Kapazitätsschutz: Kompilier- und Runner-Warteschlangen können bei legitimen parallelen Kursstarts sehr groß werden. Die Sketch-CRUD-Schemata enthalten nach aktueller Evidenz weniger explizite Feldlängen als die Compile- und WS-Protokolle.

| Prüfpunkte | Ergebnis | Restrisiko |
|---|---:|---|
| Compile-Request-Schema | positiv | Compiler-/Parser-DoS durch komplexen Code bleibt möglich. |
| WebSocket-Nachrichtenschema | positiv | Debug-Logging kann Rohpayloads enthalten, falls aktiviert. |
| Serial Input | positiv begrenzt | Laufende Simulationen können dennoch Ausgaben und CPU erzeugen. |
| Sketch CRUD | nachbesserungswürdig | Feldgrößen sollten explizit begrenzt werden. |
| Rate Limiting | vorhanden | Kein Ersatz für Queue-, Docker- und Host-Ressourcenlimits. |

### 3.4 Sandbox und Container-Isolation

Die Docker-Sandbox ist der zentrale Sicherheitsbaustein. Laut `docs/SECURITY.md`, `Dockerfile.sandbox`, `server/services/sandbox/execution-manager.ts` und Docker-Command-Tests werden dynamische Sketches in Containern mit deaktiviertem Netzwerk, read-only Root-Filesystem, `no-new-privileges`, `cap-drop ALL`, PID-/CPU-/RAM-/Swap-Limits und begrenztem `tmpfs` ausgeführt.

Das Modell reduziert das Risiko untrusted C++-Code erheblich. Der größte verbleibende technische Risikotreiber ist der Docker-Socket im Backend-Container. Ein kompromittierter Backend-Prozess hätte über den Docker-Daemon potenziell Host-nahe Macht.

| Prüfpunkte | Ergebnis | Restrisiko |
|---|---:|---|
| Netzwerk im Sandbox-Container deaktiviert | positiv | Kernel-/Runtime-Schwachstellen bleiben außerhalb der App-Kontrolle. |
| Read-only Root FS und beschreibbarer Arbeitsbereich | positiv | Fehlerhafte Mounts oder Docker-Bugs bleiben relevant. |
| Capabilities gedroppt, no-new-privileges | positiv | Docker-Daemon-Rechte des Backends bleiben kritisch. |
| Ressourcenlimits pro Container | positiv | Hostweite Docker-/Disk-/Inode-Erschöpfung muss extern überwacht werden. |
| Docker-Socket im Backend | bewusstes Restrisiko | Host-Kompromittierung bei Backend-Kompromiss möglich. |

### 3.5 Supply Chain und Image-Reproduzierbarkeit

Die Node-Abhängigkeiten sind per Lockfile und Overrides kontrolliert; Release-Gates enthalten `npm audit --omit=dev`. Gleichzeitig verwenden `Dockerfile` und `Dockerfile.sandbox` mutable Bestandteile: `debian:stable-slim`, `node:24.20.0-slim` als Tag und Arduino-CLI-Installation über ein Remote-Script von GitHub `master`.

**Bewertung:** für Hochschulbetrieb akzeptabel, wenn Images intern gebaut, geprüft und versioniert werden; für streng reproduzierbare Deployments nachbesserungsbedürftig.

## 4. Ressourcen- und Kapazitätsprüfung

### 4.1 Architekturbezogene Grenzen

UnoSim arbeitet als einzelner zustandsbehafteter Backend-Prozess. WebSocket-Sessions, Runner-Leases, Compile-Queues und Caches liegen im Prozess. Dadurch sind die operativen Grenzen klar:

- kein horizontaler Betrieb ohne externe Sitzungs-/Queue-Architektur,
- kein automatisches Failover ohne Sitzungsverlust,
- Neustart beendet laufende Simulationen und verwirft Warteschlangen,
- Kapazität hängt stark an Docker-Daemon, CPU, Disk-I/O und Runner-Konfiguration.

### 4.2 Gemessene Kapazität

| Szenario | Evidenz | Ergebnis | Freigabe |
|---|---|---:|---:|
| 50 parallele Kompilierungen | `docs/SCALABILITY.md` | bestanden | ja |
| 100 parallele Kompilierungen | `docs/SCALABILITY.md` | bestanden | ja |
| 200 parallele Kompilierungen | `load-test-results/latest-summary.txt` | 200/200 erfolgreich, 0 Fehler | ja, mit Latenzhinweis |
| 50 parallele Simulationen | `load-test-results/50-client-simulation-observability-2026-09-06T18-48-06-824Z.json` | 50/50 erfolgreich | ja |
| 100 parallele Simulationen | `load-test-results/100-client-simulation-observability-2026-09-06T18-59-18-062Z.json` | 100/100 erfolgreich | ja |
| 200 parallele Simulationen | `load-test-results/200-client-simulation-observability-2026-09-06T20-44-23-966Z.json` | 126/200 erfolgreich, 74 Timeouts/Fehler | nein |

Der 200-Client-Compile-Test ist funktional erfolgreich, aber mit hoher Wartelatenz: durchschnittliche Latenz 88,9 s, P95 157,1 s, Peak-Compile-Queue 192 und durchschnittliche Queue-Wartezeit 82,3 s. Das ist für kontrollierte Übungen noch erklärbar, aber nicht als niedrige Latenz zu verkaufen.

Die Simulationstests zeigen den Engpass eindeutig: standardmäßig 5 Runner, bei 100 Clients Peak-Runner-Queue 95, bei 200 Clients Peak-Runner-Queue 195 und 74 Timeouts/Fehler. Damit ist die aktuelle valide Simulationskapazität **100 parallele Clients**, nicht 200.

### 4.3 Plausible Lehrbetriebsszenarien

| Szenario | Einschätzung |
|---|---|
| Seminar mit 20–30 Studierenden | sehr wahrscheinlich stabil, sofern Gateway und Docker gesund sind |
| Praktikum mit 50 parallelen Simulationen | validiert und vertretbar |
| Vorlesungsübung mit 100 parallelen Simulationen | validiert, aber mit Runner-Queue-Latenz; Monitoring erforderlich |
| 200 parallele Kompilierungen | validiert, aber hohe Wartezeiten; didaktisch kommunizieren |
| 200 parallele Simulationen | nicht freigegeben; bekannte Timeouts |
| mehrere Kurse gleichzeitig ohne Zeitfenstersteuerung | Risiko erhöht; Betriebskonzept nötig |
| unbegrenzte öffentliche Nutzung | nicht geeignet |

## 5. FMEA: Failure Mode and Effects Analysis

| Failure Mode | Ursache | Effekt im Lehrbetrieb | Erkennung heute | Schwere | Auftreten | Entdeckbarkeit | Risiko | Empfohlene Maßnahme |
|---|---|---|---|---:|---:|---:|---:|---|
| Docker-Daemon nicht verfügbar beim Start | Docker gestoppt, Socket fehlt, Rechteproblem | Simulationen und Docker-Compile-Pfade fehlschlagen; Backend kann dennoch teilweise starten | Logs, Docker-Checks, `/api/status` indirekt | 5 | 3 | 3 | 45 | Readiness an Docker koppeln, Start-Gate und Alert ergänzen |
| Docker-Daemon fällt während Last aus | Hostproblem, Daemon-Neustart | laufende Simulationen brechen ab; Cleanup unsicher | Fehlermeldungen, Disconnects, Queue-/Timeout-Metriken | 5 | 2 | 3 | 30 | Fault-Test, Alert auf Docker-Health, klare Wiederanlaufprozedur |
| Backend-Neustart | Deployment, Crash, Host-Neustart | alle WS-Sessions, Runner-Leases und Queues verloren | Prozess-/Service-Monitoring extern nötig | 4 | 3 | 2 | 24 | Wartungsfenster, Nutzerhinweis, systemd/Compose-Restart, keine HA-Zusage |
| Kompilierungs-Worker stirbt | Worker-Fehler oder Ressourcendruck | aktive Aufgabe schlägt fehl; keine automatische Worker-Neustartersetzung | Pool-Stats, Fehlerlogs | 3 | 2 | 3 | 18 | Worker-Autorestart und Alarm auf `failedTasks`/Workerzahl ergänzen |
| Alle Compile-Worker sterben | systemischer Fehler, Build-Artefakt fehlt | Compile-Queue wird abgewiesen; Kompilieren nicht möglich | Fehlerlogs, `/api/status` Pool-Stats | 4 | 2 | 3 | 24 | Readiness abhängig von Workerpool, automatischer Wiederaufbau |
| Runner-Pool erschöpft | mehr Simulationen als Runnerkapazität | Warteschlange, hohe Startlatenz, nach 60 s Timeouts | `/api/status` `sandboxRunners.queued`, Testdaten | 4 | 4 | 2 | 32 | Betriebsgrenze 100, Queue-Alerts, Kursfenster oder Runner-Kapazität neu validieren |
| Disk voll oder Inodes erschöpft | Temp-/Cache-Wachstum, Containerreste, Logs | Compile/Simulation fehlschlagen; Cleanup kann versagen | heute nur indirekt über Fehler | 5 | 3 | 4 | 60 | Host-Disk-/Inode-Monitoring, Cleanup-Job, Disk-Full-Test |
| Container-Cleanup schlägt fehl | Docker hängt, Prozess bleibt, `docker rm` Timeout | Ressourcenleck, spätere Kapazitätsprobleme | Debug-/Warnlogs, Docker CLI extern | 4 | 3 | 4 | 48 | Metrik für verwaiste Container, regelmäßige Garbage Collection |
| Gateway falsch konfiguriert | Header nicht gestrippt, falscher Proxy, Port offen | Auth-Bypass- oder Spoofing-Risiko | schwer ohne expliziten Test | 5 | 2 | 4 | 40 | Deployment-Checkliste, negative Integrationstests, Port-Scan im Release |
| Gateway-Secret kompromittiert | Secret-Leak, Log/Config-Fehler | unautorisierter Zugriff über Gateway-Vertrauensgrenze | kaum automatisch | 5 | 2 | 4 | 40 | Rotation mit Zwei-Secret-Overlap, Secret-Management, Log-Prüfung |
| Output-Flood aus Sketch | bösartiger/fehlerhafter Sketch | Speicher-/Netzlast, Nutzer-UI langsam | Docker-Manager Output-Budget, Telemetrie | 3 | 3 | 2 | 18 | Output-Flood-E2E-Test, niedrigere Budgets prüfen |
| Compiler-/Parser-DoS | sehr komplexer C++-Code | lange Compilezeiten, Queue-Verstopfung | Compile-Metriken und Timeouts | 4 | 3 | 2 | 24 | Queue-Alerts, Aufgabenprofile begrenzen, Missbrauchsregeln |
| Mutable Base Images / Remote Script | Upstream-Änderung | nicht reproduzierbare oder kompromittierte Builds | Build-Logs, Audit nur begrenzt | 4 | 2 | 4 | 32 | Images und Arduino-CLI-Version pinnen, interne Registry verwenden |
| Dokumentationsinkonsistenz | README älter als Betriebsdoku | Fehlbetrieb durch Betreiber | manuelle Review | 3 | 3 | 3 | 27 | README an Produktionsanforderungen angleichen |

Skala: 1 niedrig bis 5 hoch. Risiko = Schwere × Auftreten × Entdeckbarkeit.

## 6. Fail-Safe- und Recovery-Bewertung

| Bereich | Aktueller Zustand | Bewertung |
|---|---|---|
| Simulation stoppen | `WsSessionManager.safeReleaseRunner` stoppt Runner und gibt ihn an den Pool zurück | positiv |
| Disconnect während Queue-Wartezeit | Queue-Acquire kann über AbortController abgebrochen werden | positiv |
| Runner-Reset | Pool setzt Runner mit Timeout zurück und ersetzt problematische Runner | positiv |
| Container-Timeouts | Docker-Manager beendet Prozesse bei Timeout und Output-Budget | positiv |
| Cleanup | `docker rm -f` und lokale Retry-/Rename-Strategien vorhanden | positiv, aber ohne externe Leck-Metrik |
| Backend-Shutdown | `shutdownServices` stoppt Simulationen, schließt WSS und fährt Runnerpool herunter | positiv für geordneten Shutdown |
| Backend-Crash | keine Sitzungs-/Queue-Persistenz | akzeptabel nur mit klarer Nicht-HA-Kommunikation |
| Worker-Ausfall | aktive Aufgabe wird abgewiesen; keine automatische Wiederherstellung | nachbesserungswürdig |
| Docker-Ausfall | Fallback in Produktion wird verweigert, aber Wiederherstellung ist operativ | sicherheitsseitig positiv, betrieblich nachbesserungswürdig |

Die wichtigste Fail-Safe-Eigenschaft ist, dass im Docker-Produktionsmodus kein stiller Rückfall auf unsandboxed lokale Ausführung erfolgen soll. Das ist sicherheitsseitig richtig. Operativ muss dies durch klare Fehlermeldungen, Readiness und Alerting ergänzt werden.

## 7. Observability und Betrieb

### 7.1 Vorhandene Signale

`/api/status` liefert bereits nützliche Statusdaten: Server-/Simulationsmodus, Compile-Slots, Compile-Worker-Pool, Sandbox-Runner, WebSocket-Sessions, Compile-Metriken und Prozessmetriken. `server/services/server-metrics.ts` enthält Alert-Schwellen für Compile-Queue-Wartezeit, Compile-Dauer, Runner-Queue, Prozessspeicher und CPU.

### 7.2 Lücken

| Lücke | Auswirkung |
|---|---|
| Keine externe Alert-Integration erkennbar | Probleme werden nicht aktiv an Betreiber gemeldet. |
| Prozessspeicher misst primär Node-Heap relativ zu Host-RAM | Container-RSS, Docker-Sandbox-RAM und Hostdruck werden unterschätzt. |
| Keine Disk-/Inode-Metriken | Temp-, Cache- und Containerreste können unbemerkt eskalieren. |
| Keine Docker-Daemon-Health-Metrik im Status als harte Readiness | Ausfall kann erst durch Nutzerfehler sichtbar werden. |
| Keine Metrik für verwaiste Container/fehlgeschlagene Cleanup-Versuche | Langsame Ressourcenlecks schwer erkennbar. |
| Kein dokumentierter On-Call-/Runbook-Alarmfluss | Reaktionszeit im Lehrbetrieb unklar. |

### 7.3 Empfohlene Mindestalarme

| Signal | Warning | Critical |
|---|---:|---:|
| Compile Queue Wait P95 | > 30 s für 5 min | > 60 s für 5 min |
| Compile Timeouts | > 0 in 10 min | wiederholt oder steigend |
| Runner Queue | > 0 für 2 min | > Runner-Kapazität oder Acquire-Timeouts |
| WebSocket Disconnect Spike | deutlicher Anstieg gegenüber Basislinie | laufende Übung betroffen |
| Docker-Daemon-Health | einzelner Check fehlschlägt | mehrere Checks oder Simulationen unmöglich |
| Backend RSS/Container-Memory | > 80 % | > 90 % |
| Host Disk/Inodes | > 80 % | > 90 % |
| Verwaiste Container | > 0 älter als 10–15 min | ansteigend oder nicht löschbar |
| Fehlerquote Compile/Simulation | > 2–5 % | > 10 % oder systemisch |

## 8. Hochschulszenarien

| Szenario | Betriebsreife | Begründung |
|---|---|---|
| Lokale Einzelplatz-Demo | reif | Local Mode ist dokumentiert, aber nicht für Produktivbetrieb gedacht. |
| Kleines Seminar hinter Gateway | reif mit Standardauflagen | Sicherheits- und Lastmodell passen. |
| Praktikum mit 50 gleichzeitigen Simulationen | reif | Lastdaten zeigen 50/50 erfolgreiche Simulationen. |
| Große Übung mit 100 gleichzeitigen Simulationen | bedingt reif | 100/100 erfolgreich, aber Queue-Latenz und Monitoring relevant. |
| 200 gleichzeitige reine Kompilierungen | bedingt reif | funktional erfolgreich, aber P95-Latenz ca. 157 s. |
| 200 gleichzeitige Simulationen | nicht reif | gemessene 74 Timeouts/Fehler. |
| Prüfungsbetrieb mit Verfügbarkeitsgarantie | nicht ausreichend | Kein HA, keine persistente Job-/Session-Fortsetzung. |
| Campusweit offen ohne Gateway | NO-GO | Vertrauensgrenze würde verletzt. |

## 9. Prüfstand und Testabdeckung

### 9.1 Positiv abgedeckt

| Bereich | Evidenz |
|---|---|
| Access-Control und Gateway-Vertrag | `tests/server/security/access-control.test.ts` |
| Eingabelimits und WS-Schemata | `tests/shared/input-limits.test.ts`, `tests/shared/websocket-direction-schemas.test.ts` |
| Docker-Sandbox-Vertrag | `tests/integration/docker-security-contract.test.ts`, `tests/server/services/docker-command-builder.test.ts` |
| Pfadsicherheit | `tests/server/security/safe-paths.test.ts` |
| Runner-Pool-Verhalten | `tests/server/services/sandbox-runner-pool.test.ts` |
| Docker-Manager und Semaphore | `tests/server/services/sandbox/docker-manager.test.ts`, `tests/server/services/sandbox/docker-compile-semaphore.test.ts` |
| E2E- und Load-Grundlagen | Playwright-Suites, `tests/server/load-50-client-simulation-observability.test.ts`, Load-Ergebnisdateien |

### 9.2 Fehlende oder vor Go-Live zu priorisierende Tests

| Test | Priorität | Ziel |
|---|---:|---|
| Docker-Daemon-Ausfall beim Start | P1 | Readiness und sichere Fehlerantworten validieren |
| Docker-Daemon-Ausfall während aktiver Simulationen | P1 | Cleanup, Nutzerfehlerbild und Recovery validieren |
| Fehlendes oder falsches Sandbox-Image | P1 | Kein lokaler Fallback, klare Diagnose |
| Disk-full/temp unwritable/build-cache korrupt | P1 | Fail-safe statt Hängen/Leck |
| Backend-Neustart unter Compile-/Simulation-Last | P1 | Erwarteten Sitzungsverlust und Cleanup dokumentieren |
| Compile-Worker-Crash | P2 | Ausfallbild und fehlenden Autorestart absichern |
| Gateway-Spoofing-/Direktzugriff-Negativtest | P1 | Produktions-Vertrauensgrenze regressionssicher machen |
| Output-Flood und Serial-Input-Flood Ende-zu-Ende | P2 | Budgets und UI-Verhalten validieren |
| Runner-Queue-Sättigung bis Acquire-Timeout | P2 | Fehlerbilder bei Überlast reproduzierbar machen |
| CSP-Regressionstest | P2 | Security-Header vollständig erhalten |

## 10. Risikomatrix

### 10.1 Risikoübersicht

| Priorität | Anzahl | Risiken |
|---|---:|---|
| P0 | 0 unter korrekter Zielarchitektur | Kein unmittelbarer Blocker, wenn Gateway, Loopback und Docker-Sandbox strikt eingehalten werden. |
| P1 | 6 | Monitoring/Alerting, Docker-Daemon-Faults, Disk-Full, Gateway-Negativtests, Backend-Restart-Verhalten, Dokumentationskonsistenz für Produktion |
| P2 | 6 | Worker-Autorestart, CSP-Header-Hardening, Secret-Rotation mit Overlap, explizite Sketch-Feldlimits, immutable Images/Arduino-CLI-Pinning, Output-/Queue-Flood-Tests |
| P3 | 3 | Legacy-`lastCompiledCode`-Fallback entfernen, API-Versionierungsdoku vereinheitlichen, Status-/Readiness-Semantik schärfen |

### 10.2 Top-Restrisiken

| Rang | Risiko | Einordnung | Sofortmaßnahme vor Go-Live |
|---:|---|---|---|
| 1 | Docker-Socket im Backend kann bei Backend-Kompromiss Host-nahe Wirkung haben | strukturell | Host isolieren, minimale Hostrechte, nur dedizierter Server/VM, Docker-Socket-Risiko akzeptieren oder Architektur ändern |
| 2 | Single stateful backend verliert Sessions/Jobs bei Neustart | betrieblich | Keine HA-Zusage, Wartungsfenster, Restart-Kommunikation, Recovery-Runbook |
| 3 | 200 Simulationen sind empirisch nicht stabil | kapazitiv | Freigabe auf 100 Simulationen begrenzen, Kursplanung entsprechend steuern |
| 4 | Fehlendes externes Monitoring für Docker/Disk/Queues | betrieblich | Prometheus/Check-Script/Alerting vor Produktivstart anbinden |
| 5 | Gateway-Fehlkonfiguration kann Vertrauensmodell brechen | sicherheitskritisch | Deployment-Checkliste, Negativtests, Backend nur loopback/private erreichbar |

## 11. Konkrete Empfehlungen

### Vor Produktivstart zwingend

1. Produktion nur gemäß `docs/INSTALL_SERVER.md` mit Gateway, TLS, Loopback/private Backend-Bindung und Docker-Sandbox starten.
2. Freigabegrenzen dokumentieren: 200 Compile-Clients, 100 Simulations-Clients; 200 Simulationen explizit ausschließen.
3. Externes Monitoring für `/api/status`, Docker-Daemon, Host-Disk/Inodes, Containerreste und Fehlerquoten einrichten.
4. Fault-Injection-Minimum testen: Docker down, Disk full/unwritable, Backend restart under load, missing sandbox image, gateway spoof/direct access.
5. README und Betreiberkommunikation an die gehärtete Produktionsrealität anpassen, damit Docker/Gateway nicht als optional missverstanden werden.

### Kurzfristig empfohlen

1. CSP-Header-Verhalten in `server/index.ts` korrigieren oder testen, damit Helmet-CSP nicht abgeschwächt wird.
2. Secret-Rotation mit kurzer Zwei-Secret-Überlappung gemäß ADR umsetzen.
3. Compile-Worker-Autorestart ergänzen und Workerzahl in Readiness/Status bewerten.
4. Sketch-CRUD-Feldlängen explizit begrenzen.
5. Docker- und Arduino-CLI-Versionen pinnen; Sandbox-Image über interne Registry ausrollen.

### Mittelfristig

1. Persistente Job-/Session-Architektur nur bei echtem HA-Bedarf planen; aktuell wäre das ein Architekturprojekt.
2. Runner-Kapazität nur nach erneuten Messungen erhöhen; 5 Runner sind aktuell der belegte Engpass.
3. Runbook für Lehrveranstaltungen erstellen: Vorab-Check, Lastfenster, Eskalation, Neustart, Cleanup, Rollback.

## 12. Schlussbewertung

UnoSim zeigt für ein Hochschul-Lehrsystem eine solide Sicherheitsbasis: Gateway-Vertrauensmodell, explizite Produktionsmodi, strikte Eingabelimits, Docker-Sandboxing und belastbare Tests für zentrale Sicherheitsverträge. Gleichzeitig ist die Betriebsreife an klare Grenzen gebunden: Single-Node-Zustand, Docker-Socket-Restrisiko, fehlende externe Alarmierung und empirisch nicht bestandene 200er-Simulationslast.

**Freigabeempfehlung:** Einsatz im kontrollierten Lehrbetrieb ist verantwortbar, wenn die harten Betriebsbedingungen eingehalten und die P1-Maßnahmen vor dem ersten produktiven Kursbetrieb umgesetzt oder organisatorisch kompensiert werden. Ohne Gateway-Isolierung, Docker-Sandbox und Monitoring ist der Produktivbetrieb nicht freizugeben.
