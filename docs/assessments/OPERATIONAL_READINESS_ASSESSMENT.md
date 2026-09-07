# Unabhängige technische Betriebsreife- und Sicherheitsprüfung

Stand: 2026-09-07

Bewerteter Repository-Stand: `21855bb4de75f44f31b76e648389f073a8785bda` (`main`)

Geltungsbereich: aktueller UnoSim-Stand für einen klar begrenzten Hochschul-Lehrbetrieb.
Prüfmodus: Code-, Test-, Architektur-, Dokumentations- und Betriebsevidenz; keine Produktivcode-Änderungen.

Dieses Dokument ist ein Assessment/Snapshot. Es ergänzt die normativen Betriebs- und Sicherheitsdokumente, ersetzt sie aber nicht.

## 1. Gesamturteil

**Urteil: GO WITH CONDITIONS für kontrollierten Hochschulbetrieb.**

UnoSim ist für einen begrenzten Lehrbetrieb vertretbar, wenn Gateway, Docker-Sandbox, Single-Node-Betriebsmodell und die gemessenen Kapazitätsgrenzen eingehalten werden. Das System ist kein hochverfügbares Mehrknoten-System; WebSocket-Sessions, Runner-Leases, Queues und Rate-Limit-Zustand liegen im Backend-Prozess.

### Harte Betriebsbedingungen

| Bedingung | Bewertung |
|---|---|
| Mehrbenutzerbetrieb nur hinter authentifizierendem Gateway | zwingend |
| Backend-Port nicht direkt öffentlich erreichbar, bevorzugt Loopback/private Bindung | zwingend |
| `UNOSIM_TRUST_MODE=gateway` | zwingend |
| `UNOSIM_SERVER_MODE=docker` und `UNOSIM_SIMULATION_MODE=docker-sandbox` | zwingend |
| `UNOSIM_GATEWAY_SECRET`, `UNOSIM_TRUSTED_PROXY` und exakte `UNOSIM_ALLOWED_WS_ORIGINS` | zwingend |
| Rate Limiting und Admission Control aktiv | zwingend |
| Keine HA-, Session-Fortsetzungs- oder horizontale-Scaling-Zusage | zwingend kommunizieren |
| Admission-Default: höchstens 25 laufende plus wartende Simulationsstarts je Prozess | zwingend beachten |
| 5 Runner sind die Referenz-Ausführungsparallelität; Runner-Pool und Admission-Cap nicht vermischen | zwingend beachten |
| Externes Monitoring und Alarmierung vor produktiver Lehrveranstaltung | dringend erforderlich |

### NO-GO-Szenarien

- direkter Internet- oder LAN-Zugriff auf den Backend-Port;
- Produktivbetrieb im Local-Trust- oder unsandboxed Local-Simulationsmodus;
- Hochverfügbarkeit, Rolling Updates ohne Sitzungsverlust oder horizontale Skalierung;
- Betrieb ohne Überwachung von Docker, Host-Disk/Inodes, Queues und Fehlerquoten;
- Kapazitätsversprechen für 200 gleichzeitige Simulationen.

## 2. Evidenzbasis

| Bereich | Evidenz |
|---|---|
| Normative Betriebsanforderungen | [`INSTALL_SERVER.md`](../INSTALL_SERVER.md), [`SECURITY.md`](../SECURITY.md), [`SCALABILITY.md`](../SCALABILITY.md), [`RELEASE_RUNBOOK.md`](../RELEASE_RUNBOOK.md) |
| Gateway und Identität | `server/security/access-control.ts`, ADR 0001, `tests/server/security/access-control.test.ts` |
| Limits und Admission | `server/config.ts`, `server/services/rate-limiter.ts`, `server/services/simulation-admission-controller.ts`, `server/routes/simulation.ws.ts`, `tests/server/routes/simulation-admission.test.ts` |
| Compile-Pfad | `server/routes/compiler.routes.ts`, `tests/server/routes/compiler.routes.test.ts` |
| Runner und Cleanup | `server/services/sandbox-runner-pool.ts`, `server/routes/simulation/ws-session-manager.ts`, Docker-Manager- und Lifecycle-Tests |
| Observability | `server/routes/status.routes.ts`, `server/services/server-metrics.ts` |
| Kapazität | [`SCALABILITY.md`](../SCALABILITY.md), `load-test-results/`, `tests/server/load-50-client-simulation-observability.test.ts` |
| Release-Nachweis | Commit `21855bb4`, GitHub Actions Run 34130930625, Sonar Quality Gate |

## 3. Security-Prüfung

### 3.1 Authentifizierung und vertrauenswürdige Identität

Im Gateway-Modus akzeptiert UnoSim nur ein gültiges Gateway-Secret, einen konfigurierten Trusted Proxy, ein syntaktisch gültiges `X-UnoSim-Subject` und die Rolle `user`. Der Gateway muss eingehende Identitätsheader entfernen und kontrolliert neu setzen. WebSocket-Origin-Prüfungen verwenden eine explizite Allowlist.

Für Local/Test erzeugt der Server eine signierte HttpOnly-Session-Cookie bzw. bei einer direkten WebSocket-Verbindung eine eigene Verbindungsidentität. `X-UnoSim-Subject`, `X-Test-Run-ID` und Query-Parameter sind dort keine vertrauenswürdige Nutzeridentität. Damit werden lokale/testende Clients nicht fälschlich zu einem gemeinsamen `anonymous`-Nutzer zusammengefasst.

| Prüfpunkte | Ergebnis | Restrisiko |
|---|---:|---|
| Gateway-Secret, Trusted Proxy und Rollenprüfung | positiv | Fehlkonfiguration oder Secret-Kompromittierung bleibt kritisch. |
| Identität für Limits und Reservationen | positiv | Gateway muss Header korrekt bereinigen; Local-Session ist prozesslokal signiert. |
| WebSocket-Identität beim Upgrade fixiert | positiv | Kein späterer Identitätswechsel per WS-Nachricht vorgesehen. |
| Secret-Rotation | offen | ADR beschreibt Überlappung; eine vollständige Zwei-Secret-Rotation ist nicht als laufender Mechanismus belegt. |
| Rollenmodell | bewusst minimal | Nur `user`, keine feineren Admin-/Dozentenrechte. |

**Bewertung:** tragfähig bei strikt abgeschirmtem Backend und korrekter Gateway-Konfiguration; bei direkter Erreichbarkeit nicht tragfähig.

### 3.2 Eingabe-, Rate- und Admission-Schutz

Die bestehenden Body-, Compile-, WebSocket- und Serial-Limits sowie die Zod-Schemata bleiben aktiv. Zusätzlich sind die teuren Pfade separat begrenzt:

| Schutz | Default | Semantik |
|---|---:|---|
| Compile | 10 / 60 s je vertrauenswürdiger Identität; 10 s Sperrzeit | REST `/api/compile`, `429 RATE_LIMITED`, `Retry-After` |
| Simulation-Start | 1 / 2 s je Identität; 5 s Sperrzeit | WebSocket `start_simulation`, strukturierter `RATE_LIMITED`-Fehler |
| Per-Identity-Reservation | 1 aktiver oder wartender Start | zweite Reservation: `SIMULATION_ALREADY_ACTIVE` |
| Globale Admission | 25 laufende plus wartende Starts je Backend-Prozess | sofortiger `SYSTEM_BUSY` statt zusätzlicher Runner-Wartezeit |

Die Limits sind kein Ersatz für Compiler-, Docker- oder Host-Ressourcenlimits. Die Compile-Ratebegrenzung liegt vor Parse-/Cache-/Compile-Arbeit; der Simulation-Start wird vor der Runner-Queue geprüft. `/api/status` enthält nur aggregierte Counter/Gauges und keine Nutzeridentitäten.

### 3.3 Reservation, Cleanup und bekannte Lifecycle-Evidenz

Reservationen werden synchron und tokenisiert geführt. Freigaben erfolgen bei Stop, Disconnect, WebSocket-Fehler, Compile-/Startfehler, Timeout, Runner-Fehler und Cleanup. Verzögerte oder doppelte Freigaben alter Tokens werden ignoriert. Die Freigabe wird auch für wartende, noch nicht einem Runner zugewiesene Starts ausgeführt.

Der untersuchte 12-Client-Burst-Race blieb nichtdeterministisch. Der gleiche fehlende finale `stopped`-Zustand ließ sich auf der Baseline reproduzieren; es wurde kein deterministischer Root Cause belegt und deshalb keine weitere Lifecycle-Änderung vorgenommen. Das ist eine offene Test-/Betriebsevidenz, aber kein nachgewiesener Regressionseintrag dieses Commits.

### 3.4 Transport, Browser und Header

TLS wird am Gateway terminiert; Compose bindet den Backend-Port standardmäßig an Loopback. `UNOSIM_ALLOWED_WS_ORIGINS` ist im Gateway-Modus explizit. Die vorhandenen CSP-/Header-Härtungsbefunde aus dem historischen Assessment bleiben zu prüfen: In `server/index.ts` muss weiterhin sichergestellt werden, dass ein nachträglich gesetzter `Content-Security-Policy`-Header keine gewünschte Helmet-CSP abschwächt.

### 3.5 Sandbox und Container-Isolation

Die Docker-Sandbox verwendet kein Netzwerk, read-only Root-Filesystem, `no-new-privileges`, gedroppte Capabilities, PID-/CPU-/RAM-/Swap-Limits und nur den begrenzten `/sandbox`-Schreibbereich. Prozessstarts verwenden validierte Argumentlisten ohne Shell-Interpolation.

Der Docker-Socket im Backend bleibt ein strukturelles Restrisiko: Bei Backend-Kompromittierung kann der Docker-Daemon Host-nahe Wirkung ermöglichen. Die Sandbox selbst erhält keinen Docker-Socket. Ressourcenlimits reduzieren Container-DoS, ersetzen aber kein Host-Disk-/Inode- und Docker-Monitoring.

### 3.6 Supply Chain

Lockfile, Overrides und das Release-Audit bleiben vorhanden. Mutable Base-Image-Tags sowie die Arduino-CLI-Installation über ein Remote-Script sind weiterhin nicht vollständig reproduzierbar gepinnt. Für streng reproduzierbare Releases bleiben immutable Digests, versionierte Toolchain-Artefakte und eine interne Registry offen.

## 4. Ressourcen- und Kapazitätsprüfung

### 4.1 Drei getrennte Größen

1. **Runner-Pool:** physische/konfigurierte Ausführungsparallelität; die Referenzmessung hatte 5 Runner.
2. **Concurrent-Request-Last:** Anzahl gleichzeitig eingehender Lasttest-Anfragen.
3. **Admission-Cap:** aktuell akzeptierte laufende plus wartende Starts; Default 25 je Backend-Prozess.

Die 100 erfolgreich eingegangenen Simulationsanfragen aus historischen Lasttests sind keine aktuelle Admission- oder Kapazitätszusage. Die neue Cap verhindert, dass bis zu 95 Starts hinter 5 Runnern warten.

### 4.2 Historische Messwerte und aktuelle Bewertung

| Szenario | Historisches Ergebnis | Aktuelle Bewertung |
|---|---:|---|
| 50 parallele Kompilierungen | 50/50 erfolgreich | validiert, Queue-/Latenzprofil beachten |
| 100 parallele Kompilierungen | 100/100 erfolgreich | validiert, nicht niedrige Latenz versprechen |
| 200 parallele Kompilierungen | 200/200 erfolgreich; hohe Latenz | funktional historisch validiert, nur kontrolliert einsetzen |
| 50 parallele Simulationen | 50/50 erfolgreich | historisch validiert; Cap begrenzt neue Bursts |
| 100 parallele Simulationen | 100/100 erfolgreich, Runner-Queue 95 | historischer Queue-Durchsatz, keine aktuelle Cap-Freigabe |
| 200 parallele Simulationen | 126/200; 74 Timeouts/Fehler | ausdrücklich nicht freigegeben |

Die Referenzdaten zeigen bei 50/100/200 Starts Peak-Runner-Queues von 45/95/195 und p95-Startlatenzen von ungefähr 22/45/56 Sekunden. Der Default 25 lässt bei 5 Runnern höchstens 20 wartende Starts zu, ungefähr fünf Runner-Wellen. Das ist eine konservative Fail-fast-Entscheidung, keine neue Lasttest-Freigabe.

### 4.3 Single-Node-Grenzen

Neustart oder Crash beendet laufende Sessions, Reservationen und Warteschlangen; es gibt keine persistente Job-/Session-Fortsetzung. Mehrere Backend-Instanzen sind ohne Session-Affinität und Replikation nicht freigegeben.

## 5. FMEA und Risikomatrix

Bewertung: 1 niedrig bis 5 hoch; Risiko = Schwere × Auftreten × Entdeckbarkeit. Historische Befunde werden als resolved, mitigated oder superseded markiert, nicht entfernt.

| Failure Mode | Status auf Commit 21855bb4 | Restbewertung | Verbleibende Maßnahme |
|---|---|---|---|
| Compile-/Simulationsspam eines Subjects | **mitigated** | reduziert durch getrennte Limits und `Retry-After` | Grenzwerte nur nach neuer Messung ändern |
| Burst hinter erschöpftem Runner-Pool | **mitigated** | Admission 25 weist fail-fast ab; 5 Runner bleiben Engpass | Queue-/Busy-Alerts extern anbinden |
| Zweite aktive Simulation desselben Subjects | **resolved** | atomare tokenisierte Reservation | Regressionstests beibehalten |
| Stale Reservation-/Runner-Release | **mitigated** | tokengeprüfte, idempotente Cleanup-Pfade | Burst-Flake weiter beobachten |
| 200er-Simulationslast | **superseded / open** | historische 74 Timeouts; nicht freigegeben | keine Kapazität oberhalb Messwerten behaupten |
| Docker-Daemon-Ausfall | offen, P1 | Start-/Laufzeitfehler und Recovery nicht vollständig fault-injected | P1-Fault-Tests, Readiness und Alarmierung |
| Disk-/Inode-Erschöpfung | offen, P1 | nur indirekte Fehlererkennung | Host-Monitoring, Cleanup- und Disk-full-Test |
| Container-Cleanup-Leak | offen, P1/P2 | Logs vorhanden, keine robuste externe Leckmetrik | verwaiste Container und Cleanup-Fehler messen |
| Gateway-Fehlkonfiguration/Direktzugriff | offen, P1 | Vertrauensgrenze kann gebrochen werden | Negativtests, Port- und Deployment-Checks |
| Docker-Socket-Hostrisiko | strukturell offen, P1 | Backend-Kompromittierung kann Daemon missbrauchen | dedizierter isolierter Host/VM; Architekturänderung wäre separat |
| Single-Node-/Session-Verlust | offen, P1 | kein HA und keine Sitzungsfortsetzung | Wartungsfenster, klare Kommunikation, Recovery-Runbook |
| Externes Monitoring/Alerting | offen, P1 | `/api/status` ist nur Pull-/Prozesssignal | Betreiberseitige Alert-Integration vor Go-Live |
| Fault-Injection-Abdeckung | offen, P1 | Docker down, Disk full, Restart unter Last nicht vollständig belegt | gezielte Tests vor kritischen Lehrveranstaltungen |
| CSP-Header-Overwrite | offen, P2 | historischer Hardening-Befund nicht durch diesen Commit behoben | Header-Regressionstest bzw. Korrektur |
| Secret-Rotation mit Overlap | offen, P2 | Ein-Secret-Betrieb belegt | Zwei-Secret-Verfahren gemäß ADR |
| Mutable Images/Remote Toolchain | offen, P2 | Supply-Chain-Reproduzierbarkeit begrenzt | Digests/versionierte Artefakte/interne Registry |
| Sketch-/Parser-DoS | mitigated, Restrisiko | Eingabe-, Zeit-, Output- und Sandbox-Limits aktiv | Output-Flood/Fault-Tests erweitern |
| Nichtdeterministischer 12-Client-Burst-Flake | offen, P2 | Baseline-Signatur reproduziert, kein Root Cause | nur bei wiederholbarer Signatur erneut analysieren |

### Prioritäten

| Priorität | aktuelle offene Schwerpunkte |
|---|---|
| P0 | 0 unter der dokumentierten Zielarchitektur |
| P1 | externes Monitoring/Alerting, Docker-/Disk-/Inode-Faults, Gateway-Negativtests, Single-Node-Restart-Kommunikation, Docker-Socket-Risiko |
| P2 | CSP-Hardening, Secret-Rotation, immutable Supply Chain, Cleanup-/Output-/Queue-Fault-Tests, nichtdeterministischer Burst-Flake |
| P3 | Legacy-Protokoll-/Statusbereinigung, API-Versionierungs- und Dokumentationsvereinheitlichung |

## 6. Fail-Safe und Recovery

| Bereich | aktueller Zustand | Bewertung |
|---|---|---|
| Stop/Disconnect/Timeout | Runner wird gestoppt bzw. Queue-Acquire abgebrochen; Reservation wird freigegeben | positiv, getestet |
| Compile-/Startfehler | strukturierte Fehler und Cleanup; Admission wird freigegeben | positiv |
| Stale Releases | Reservation-ID und Objektidentität verhindern Fremd-Freigaben | positiv |
| Runner-Reset/Container-Timeout | Pool-/Docker-Cleanup mit Timeouts | positiv, externe Leckmetrik fehlt |
| Geordneter Shutdown | Sessions/WSS/Runnerpool werden beendet | positiv |
| Backend-Crash | Session-/Queue-Verlust ohne Fortsetzung | akzeptabel nur mit Nicht-HA-Kommunikation |
| Docker-Ausfall | kein unsandboxed Fallback im Produktionsmodus | sicherheitsseitig positiv, Recovery offen |

## 7. Observability und Betrieb

`/api/status` liefert aggregierte Admission- und Rate-Limit-Zähler neben Runner-, Compile-, WebSocket- und Prozessmetriken. Nutzeridentitäten werden nicht ausgegeben. Die Werte sind flüchtig und bei Neustart verloren.

Weiter offen bleiben:

- keine nachgewiesene externe Alert-Integration für Docker, Queues, Fehlerquoten und Disk/Inodes;
- Prozessmetriken ersetzen keine Container-RSS- und Host-Ressourcenmessung;
- keine harte Docker-Readiness als dauerhaftes externes Signal;
- keine robuste Metrik für verwaiste Container und fehlgeschlagene Cleanup-Versuche;
- kein dokumentierter On-Call-/Alarmfluss im Repository.

Mindestens zu überwachen sind Compile-/Runner-Queue-P95, `SYSTEM_BUSY`-/Rate-Limit-Zähler, Simulation-/Compile-Fehler und Timeouts, Docker-Daemon-Health, Backend-/Container-RSS, Host-Disk/Inodes und verwaiste Container.

## 8. Hochschulszenarien

| Szenario | Bewertung |
|---|---|
| Lokale Einzelplatz-Demo | reif für Entwicklung/Test, nicht für öffentliche Produktion |
| Kleines Seminar hinter Gateway | reif mit Standardauflagen |
| Praktikum mit 50 Simulationen | historisch validiert; kontrolliert vertretbar |
| Große Übung mit 100 Simulationen | historischer Durchsatz validiert, aber Queue-Latenz; aktuelle Admission weist frühe Bursts ab |
| 200 parallele Kompilierungen | kontrolliert möglich, hohe Wartezeiten kommunizieren |
| 200 parallele Simulationen | nicht reif; 74 historische Timeouts/Fehler |
| Prüfungsbetrieb mit Verfügbarkeitsgarantie | nicht ausreichend; Single-Node ohne HA |
| Campusweit offen ohne Gateway | NO-GO |

## 9. Prüfstand und Release-Status

Für Commit `21855bb4` sind belegt:

- GitHub Actions Run [34130930625](https://github.com/MoDevIO/UnoSim/actions/runs/34130930625) vollständig grün: Lint/Unit, Arduino-Integration, Docker-Sandbox, Clean-room und Playwright E2E;
- Sonar Quality Gate grün, neue Coverage 87,1 %, 0 neue Violations;
- `npm run check`, fokussierte Rate-Limit-/Admission-/Lifecycle-Tests und `git diff --check` grün;
- vollständiger lokaler Lauf funktional, mit den dokumentierten nichtdeterministischen Baseline-Flakes außerhalb dieses Assessments unverändert.

> Das Assessment behauptet damit keine neue Kapazität oberhalb der Messwerte. Historische Lasttestdaten bleiben Evidenz für Queue-Verhalten, nicht für eine unbegrenzte oder aktuell zugelassene Zahl gleichzeitig angenommener Starts.

## 10. Offene P1-Punkte vor belastbarem Go-Live

1. Externes Monitoring und Alarmierung für Docker, Host-Disk/Inodes, Queues, Fehlerquoten, Timeouts und `SYSTEM_BUSY`/Rate-Limit-Spitzen anbinden.
2. Docker-Daemon-Ausfall, fehlendes Image, Disk-full/unwritable und Backend-Neustart unter Last als Fault-Injection-Szenarien testen und Recovery dokumentieren.
3. Gateway-Direktzugriff, Header-Spoofing und Origin-Fehlkonfiguration als negative Release-Tests automatisieren.
4. Single-Node-Sitzungsverlust ausdrücklich in Betreiber- und Lehrveranstaltungsplanung berücksichtigen; keine HA-Erwartung erzeugen.
5. Docker-Socket-Risiko durch dedizierten, isolierten Host/VM und minimale Betreiberrechte organisatorisch begrenzen.

## 11. Schlussbewertung

Die neuen getrennten Compile-/Simulationslimits, die vertrauenswürdige Identity-Semantik, die atomare Per-Subject-Reservation und die globale Admission-Grenze reduzieren die zuvor offenen Spam- und Queue-Risiken wesentlich. Sie ändern jedoch weder den Docker-Socket-Risikotreiber noch das Single-Node-Modell, die fehlende externe Alarmierung, Host-Disk-/Inode-Risiken, Fault-Injection-Lücken oder die Supply-Chain-Pinning-Lücken.

**Gesamtentscheidung: GO WITH CONDITIONS bleibt bestehen.** Ein kontrollierter Lehrbetrieb ist verantwortbar, wenn die harten Betriebsbedingungen aus diesem Snapshot sowie [`INSTALL_SERVER.md`](../INSTALL_SERVER.md) eingehalten werden und die offenen P1-Punkte vor belastbaren produktiven Veranstaltungen organisatorisch kompensiert oder technisch bearbeitet sind. Ohne Gateway-Isolierung, Docker-Sandbox und Betreiber-Monitoring bleibt der Betrieb NO-GO.
