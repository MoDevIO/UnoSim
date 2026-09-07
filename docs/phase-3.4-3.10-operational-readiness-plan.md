# Phase 3.4–3.10: Operational-Readiness-Plan

Status: active
Zielrolle: operational-readiness-plan  
Datum: 2026-09-07
Grundlage: `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md`, Abschnitt 10, Maßnahmen 3.4 bis 3.10.

> Verbindliche Korrektur: Es gibt laut Projektanalyse keine Phase 4. Die noch offenen betrieblichen Maßnahmen gehören zu Phase 3.4 bis 3.10. Dieser Plan ersetzt den irrtümlichen Phase-4-Plan als aktive Roadmap.

## Aktueller Verifikationsstand

| Kennzahl | Stand |
| --- | ---: |
| Gesamtfortschritt | ca. 75 % (gewichtete Schätzung) |
| `verified-done` | 16 |
| `partial` | 12 |
| `open` | 2 |
| Aktive Maßnahme | 3.7 Release-Gate |
| Verbleibende atomare Fachinkremente | ca. 12–18 |
| Letzte Verifikation | 2026-09-07 |

**Verifikationsregel:** Statusangaben im aktiven Plan müssen anhand des aktuellen Repository-Zustands verifiziert werden. Historische Abschlussmeldungen bleiben erhalten, gelten aber nicht automatisch als heutiger Ist-Zustand.

Die Einstufung basiert auf Git-Historie, aktuellem Code, Tests, Coverage-Artefakten und vorhandenen Dokumenten. Die bekannten untracked Load-/Cache-Artefakte wurden nicht verändert.

## Verifizierte Statusmatrix 1.1–3.10

| Nr. | Maßnahme | Status | Aktuelle Evidenz | Offene Restarbeit |
|---|---|---|---|---|
| 1.1 | Historische Analyse markieren | `verified-done` | Archivdatei ist als historisch/archived gekennzeichnet. | Keine. |
| 1.2 | README-Begriffe aktualisieren | `partial` | README enthält weiterhin ältere Compiler-Begriffe. | Aktuelle Compiler-/Worker-Begriffe vollständig angleichen. |
| 1.3 | Docker-Namen vereinheitlichen | `partial` | Dokumentation enthält weiterhin uneinheitliche historische Image-Namen. | Namen in README/Admin-Doku konsolidieren. |
| 1.4 | „Warm containers“ präzisieren | `partial` | Admin-Doku beschreibt den Runner-Pool teilweise missverständlich. | Terminologie an tatsächliches Pool-Verhalten anpassen. |
| 1.5 | Hook-Namenskonvention | `partial` | Gemischte camelCase-/kebab-case-Hooknamen bestehen fort. | Konvention dokumentieren und bei neuen Änderungen anwenden. |
| 1.6 | Deprecated Status-Aliase | `verified-done` | `pool`/`compile` bleiben kompatibel und sind dokumentiert. | Sunset erst über 3.10/Major-Release. |
| 1.7 | Legacy-`IOPinRecord`-Felder | `verified-done` | Deprecation-Plan und Zielmodell sind dokumentiert. | Migration/Sunset später entscheiden. |
| 1.8 | WebSocket-Typen schärfen | `verified-done` | Richtungsbezogene Nachrichten-Schemas und Typen existieren. | Keine unmittelbare Restarbeit. |
| 1.9 | Architektur-Datenfluss | `verified-done` | `docs/ARCHITECTURE.md` enthält Komponenten- und Datenflussbeschreibung. | Bei Architekturänderungen nachführen. |
| 1.10 | Coverage-Ziele dokumentieren | `verified-done` | Hotspots und Zielwerte sind in Plan-/Testdokumenten festgehalten. | Bei neuen Reports aktualisieren. |
| 2.1 | Compile-/Run-Hooks zerlegen | `verified-done` | Compile-, Simulation-, UI-Feedback- und Lifecycle-Hooks extrahiert. | Keine unmittelbare Restarbeit. |
| 2.2 | Page auf Composition Root reduzieren | `open` | `useArduinoSimulatorPage.tsx` bleibt breit und enthält Fachlogik. | Nach Phase 3 erneut bewerten; kein aktiver Phase-3-Schritt. |
| 2.3 | ViewModels gruppieren | `open` | Vollständige fachliche ViewModel-Gruppierung fehlt. | Nach Phase 3 strukturell neu bewerten. |
| 2.4 | WebSocket modularisieren | `partial` | Router, Session-Manager und Output-Buffer existieren; Orchestrator bleibt groß. | Weitere Zerlegung nur nach ausreichender Characterization-Abdeckung. |
| 2.5 | Compiler aufteilen | `partial` | Cache-/Worker-Module existieren; `arduino-compiler.ts` bündelt weiterhin Verantwortungen. | Compiler-/Filesystem-/CLI-Grenzen schrittweise trennen. |
| 2.6 | ExecutionManager zerlegen | `partial` | Laufzeitphasenmodule existieren; zentraler Manager bleibt umfangreich. | Weitere Extraktionen nur bei konkretem Wartbarkeitsbedarf. |
| 2.7 | Konfiguration zentralisieren | `partial` | `server/config.ts` vorhanden, direkte Env-/Hardcode-Reste dokumentiert. | Restliche Zugriffe inventarisieren und schrittweise bündeln. |
| 2.8 | Wrapper-Hooks bereinigen | `verified-done` | Phase-2-Dokumentation und Git-Historie weisen Abschluss aus. | Keine aktive Restarbeit. |
| 2.9 | Characterization Tests | `verified-done` | Compile-/Run- und Simulation-Lifecycle-Charakterisierungstests vorhanden. | Abdeckung bei weiteren Refactorings erweitern. |
| 2.10 | Parser extrahieren | `verified-done` | Spezialisierte Parsermodule vorhanden; `code-parser.ts` stark reduziert. | Keine unmittelbare Restarbeit. |
| 3.1 | Architektur-Dokumentation | `verified-done` | `docs/ARCHITECTURE.md` ist aktuelle Architekturquelle. | Bei Änderungen synchronisieren. |
| 3.2 | SSOT-Bereinigung | `verified-done` | Normative, historische und Planungsquellen sind getrennt. | Driftkontrolle fortführen. |
| 3.3 | Deprecation-/Legacy-Plan | `verified-done` | Plan und Implementierungsreport klassifizieren Legacy-Flächen. | Sunset-Entscheidungen verbleiben bei 3.10/Major-Release. |
| 3.4 | Lasttest 50/100/200 | `verified-done` | Compile bis 200; Simulation bis 100; 200 mit 74 Runner-Timeouts; Grenze dokumentiert. | Keine Arbeit, solange keine höhere Simulationsfreigabe gefordert wird. |
| 3.5 | Sandbox-Vertrag | `partial` | Vertragsmatrix, Docker-/Security-Tests und Escape-Prüfungen teilweise vorhanden. | Netzwerk-, RootFS- und wiederholbare Escape-Gates vervollständigen. |
| 3.6 | Coverage-Hotspots | `verified-done` | WS 61,90 % Lines; Cache-Manager 100 % Lines; Local Compiler 84,45 % Lines; `server/routes.ts` 75,23 % Lines / 74,10 % Statements / 46,42 % Branches; `useSimulatorFileSystem.ts` 94,64 % Lines; `output-panel.tsx` 68,96 % Lines; `examples-menu.tsx` 69,23 % Lines; `useArduinoSimulatorPage.tsx` 68,18 % Lines; `execution-manager.ts` 74,58 % Lines. | Keine weitere Phase-3.6-Arbeit. Unter 80 % verbleiben überwiegend Orchestrierungs-, defensive und seltene Infrastruktur-Branches; keine künstliche Exhaustivabdeckung vorgesehen. |
| 3.7 | Release-Gate | `partial` | `run-tests.sh`, Einzelgates, Build und SonarQube vorhanden. | Pflicht-/Opt-in-Gates, Security-Audit, Artefakte und Abbruchregeln verbindlich machen. |
| 3.8 | Skalierbarkeit/HA | `verified-done` | ADR 0003 akzeptiert Single-Stateful-Node bis zur gemessenen Grenze. | Keine HA-Implementierung in dieser Roadmap. |
| 3.9 | Observability | `partial` | Status-/WS-/Compile-/Runner-Metriken implementiert und getestet. | Schwellenwerte, Operator-Runbooks und Alert-Tests ergänzen. |
| 3.10 | API-/WebSocket-Versionierung | `partial` | iframe-API 1.4.0 und Versionierungsansätze vorhanden. | REST-/WS-Kompatibilitäts- und Migrationstests vervollständigen. |

---

## Scope / Non-Scope

### Scope

Dieser Plan bildet ausschließlich diese Maßnahmen aus `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md` ab:

| Maßnahme | Titel |
| --- | --- |
| 3.4 | Lasttest 50/100/200 |
| 3.5 | Sandbox-Vertrag |
| 3.6 | Coverage-Hotspots |
| 3.7 | Release-Gate |
| 3.8 | Skalierbarkeit / HA-Entscheidung |
| 3.9 | Observability |
| 3.10 | API-/WebSocket-Versionierung |

### Non-Scope

- Keine neue Phase 4.
- Keine Produktivcode-Änderungen durch diesen Plan.
- Keine erneute Planung bereits abgeschlossener Arbeiten aus 3.1 bis 3.3.
- Keine Entfernung von Legacy-/Kompatibilitätsflächen ohne eigene Major-Release-/Sunset-Freigabe.
- Keine HA-Implementierung ohne vorherige dokumentierte Entscheidung.
- Keine neuen Kapazitätsversprechen ohne reproduzierbare Lasttest-Evidenz.

---

## Quellenbasis

| Quelle | Status | Relevanz |
| --- | --- | --- |
| `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md` | planning | Maßgebliche Quelle für Maßnahmen 3.4 bis 3.10. |
| `docs/SCALABILITY_100_STUDENTS.md` | planning | Aktive Quelle für Ist-Grenzen, 100-/200-Client-Messszenarien und echte Multi-WS-/Docker-Testlücken. |
| `docs/TESTING_STANDARDS.md` | current | Timing-Toleranzen, Coverage-Hotspots, Heavy-Test-Regeln. |
| `docs/ARCHITECTURE.md` | current | Architektur-Ist, Status-/Telemetry-Flächen, Deployment- und Versionierungsziele. |
| `docs/EXTERNAL_API.md` | current | iframe-postMessage-API, Version `1.4.0`, Simulation-State-Kompatibilität. |
| `README_SECURITY.md` | current | Sicherheitskontrollen, Restrisiken, Produktionsmindestanforderungen. |
| `README_ADMIN.md` | current | Betriebsmodi, Docker-/Gateway-Konfiguration und Admin-Gates. |
| `docs/PHASE_3.5_SANDBOX_CONTRACT_REPORT.md` | implementation | Sandbox-Vertragsmatrix, Lückenprüfung und Phase-3.5-Gates. |
| `docs/adr/0001-authentication-and-gateway-contract.md` | accepted | Verbindlicher Gateway-/Auth-Vertrag für öffentliche Deployments. |
| `docs/phase-3.3-deprecation-legacy-plan.md` | completed | Abgeschlossene Deprecation-Klassifikation; nur als Input für 3.10/Sunset, nicht erneut zu planen. |
| `docs/phase-3.3-implementation-report.md` | completed | Abschlussnachweis für 3.3 und Liste künftiger Sunset-Kandidaten. |
| `package.json`, `run-tests.sh`, `vitest.config.ts` | current code reality | Existierende Scripts, Testprojekte und Release-/Load-Gates. |
| `playwright.scalability.config.ts`, `e2e/scalability-many-clients.spec.ts` | current test reality | Aktueller iframe-/WebSocket-Scalability-Test ohne reale Docker-Compile-/Run-Last. |
| `docker-compose.yml`, `Dockerfile.sandbox`, `sonar-project.properties` | current infra reality | Sandbox-, Ressourcen- und SonarQube-Konfiguration. |

---

## Ist-vs.-Ziel-Matrix

| Maßnahme | Ist | Ziel | Status |
| --- | --- | --- | --- |
| 3.4 Lasttest 50/100/200 | Reale Docker-Messläufe liegen vor: Compile 50/100/200 PASS; Simulation/WebSocket/Runner 50/100 PASS; Simulation 200 FAIL wegen 5er-SandboxRunnerPool + 60-s-Acquire-Timeout. | Reproduzierbare Lasttests mit Hostmetriken, klarer Hardwarebasis, Pass/Fail-Kriterien und Messartefakten. | Abgeschlossen mit dokumentierter Kapazitätsgrenze. |
| 3.5 Sandbox-Vertrag | Docker-/Integration-/Security-Tests und Heavy-Test-Mechanik existieren; Produktionsanforderungen sind dokumentiert. | Sandbox-Vertrag regelmäßig durch Docker-/Integration-/Security-Gates, Penetrationstests und Container-Escape-Versuche verifizieren. | Teilweise erfüllt, offen. |
| 3.6 Coverage-Hotspots | Mehrere behavior-orientierte Inkremente decken reale WebSocket- und Cache-Pfade ab. Aktuell: `simulation.ws.ts` 61,90 % Lines, `cache-manager.ts` 52,30 %, `local-compiler.ts` 14,86 %, `routes.ts` 28,57 %. | Coverage-Bericht: alle Hotspots >60 %, kritische Hotspots >80 %; Abweichungen nur mit dokumentierter Begründung. | Teilweise erfüllt, **aktuell aktiv**. |
| 3.7 Release-Gate | `./run-tests.sh`, Einzel-Scripts und SonarQube sind vorhanden. | Verbindliches Release-Gate mit Pflichtschritten, Security-Audit, Artefakten und Abbruchregeln. | Teilweise erfüllt, offen. |
| 3.8 Skalierbarkeit / HA-Entscheidung | Phase-3.4-Messdaten bestätigen Compile bis 200 und Simulation bis 100; Simulation 200 ist unter aktuellem 5-Runner-Profil nicht stabil. | Single-Stateful-Node bewusst bestätigen oder HA-Zielarchitektur per Entscheidung/ADR abgrenzen. | Entschieden über ADR 0003. |
| 3.9 Observability | `/api/status`, WS-Events und Serial-/Telemetry-Zähler existieren. | Strukturierte Metriken für Queues, Runner, Compile-Slots, WS-Sessions und Timeouts mit Schwellenwerten sowie Alert-Tests bei Grenzwertüberschreitungen. | Teilweise erfüllt, offen. |
| 3.10 API-/WebSocket-Versionierung | iframe-API ist mit `1.4.0` versioniert; REST-/WS-Versionierung ist noch nicht vollständig verbindlich operationalisiert. | REST-, WebSocket- und externe API-Versionierung inklusive Kompatibilitäts- und Migrationstests definieren. | Teilweise erfüllt, offen. |

---

## Bereits erledigte Punkte aus 3.1–3.3

Diese Arbeiten sind abgeschlossen und werden hier nicht erneut geplant:

| Maßnahme | Ergebnis |
| --- | --- |
| 3.1 Architektur-Dokumentation | `docs/ARCHITECTURE.md` existiert als aktuelle Architekturquelle. |
| 3.2 SSOT-Bereinigung | Normative, historische und Planungsquellen sind weitgehend getrennt; archivierte Skalierungs-SSOT verweist auf `docs/SCALABILITY_100_STUDENTS.md`. |
| 3.3 Deprecation-Plan | `docs/phase-3.3-deprecation-legacy-plan.md` und `docs/phase-3.3-implementation-report.md` klassifizieren Legacy-/Kompatibilitätsflächen final. |

Phase 3.4 bis 3.10 darf diese Ergebnisse nur referenzieren, nicht als offene Arbeit neu formulieren.

---

## Teilweise erfüllte Punkte und verbleibende Lücken

| Maßnahme | Bereits teilweise erfüllt | Wirklich offen |
| --- | --- | --- |
| 3.4 | Load-Scripts, Vitest-Load-Projekt, Playwright-Scalability-Test, bekannte Engpassanalyse. Reale Docker-Messläufe und Artefakte für Compile 50/100/200 sowie Simulation 50/100/200 liegen vor. | Keine offene Phase-3.4-Arbeit; Folgearbeit nur, wenn höhere Simulationsparallelität als 100 Clients gefordert wird. |
| 3.5 | Docker-Security-Contract-Test, Docker-Sandbox-Image, Heavy-Test-Mechanik, Security-/Admin-Doku und `docs/PHASE_3.5_SANDBOX_CONTRACT_REPORT.md` als Vertragsmatrix. | Additive Real-Docker-Prüfungen für Netzwerkverbot, read-only RootFS und Container-/Host-Escape-Versuche; danach Phase-3.5-Gates ausführen. |
| 3.6 | Alle relevanten Client-/Sandbox-Hotspots liegen über 60 % Lines; zentrale Pfade sind behavior-orientiert getestet und Coverage-/Sonar-Gates sind grün. | Abgeschlossen. Restliche <80-%-Branches sind als nicht-kritische Orchestrierungs-/Defensivpfade begründet; neue Abdeckung nur bei fachlicher Änderung. |
| 3.7 | Einzelgates und `./run-tests.sh` existieren; SonarQube-Projekt ist konfiguriert. | Release-Runbook mit Pflicht-/Opt-in-Gates, Security-Audit, Artefakten, Abbruchkriterien und Verantwortlichkeit. |
| 3.8 | Single-Stateful-Node ist transparent dokumentiert; ADR 0003 akzeptiert dieses Modell für die gemessene Kapazitätsgrenze. | Keine HA-Implementierung in Phase 3.8; höhere Parallelität benötigt separate Architektur-/Kapazitätsphase. |
| 3.9 | Status- und Telemetriequellen existieren. | Monitoring-Vertrag: Metrikliste, Schwellenwerte, Alert-/Runbook-Aktionen und Alert-Tests, die Grenzwertüberschreitungen melden. |
| 3.10 | iframe-API-Version `1.4.0` existiert; Phase-3.3-Sunset-Inventar liegt vor. | REST-/WS-Versionierung, Compatibility-Policy und Migrationstests für alte/neue Protokollvarianten. |

---

## Risiko-/Abhängigkeitsmatrix

| Risiko | Betroffene Maßnahme | Abhängigkeiten | Gegenmaßnahme |
| --- | --- | --- | --- |
| Kapazitätsaussagen sind nicht reproduzierbar | 3.4, 3.8 | Docker-RAM, CPU, Browser-Limits, Pool-Limits, SonarQube im selben Docker-Daemon | Hostprofil und Messartefakte verpflichtend machen. |
| Reale Docker-Last wird durch Mock-Tests überschätzt | 3.4, 3.5 | WS-Testclient, Docker-Sandbox-Image, Cleanup, Timeouts | Opt-in Real-Docker-Multi-Client-Test ergänzen. |
| Sandbox-Security driftet durch spätere Änderungen | 3.5, 3.7 | Dockerfile.sandbox, Docker-Run-Flags, Gateway-Konfiguration | Sandbox-Vertragsgate inklusive Penetrationstest und Container-Escape-Versuchen in Release-Prozess aufnehmen. |
| Coverage-Ziele erzwingen riskante Teständerungen | 3.6 | Hotspot-Komplexität, bestehende Refactoring-Pläne | Zielwerte `alle Hotspots >60 %` und `kritische >80 %` erhalten; Abweichungen nur dokumentiert begründen. |
| Release wird trotz roter Teilgates freigegeben | 3.7 | `./run-tests.sh`, SonarQube, Docker-Verfügbarkeit | Klare Abbruchkriterien und Artefaktpflicht definieren. |
| HA-Erwartung widerspricht Stateful-WS-/Runner-Architektur | 3.8 | WebSocket-Sessions, RunnerPool, Docker-Socket, In-Memory-State | ADR: Single Node explizit akzeptieren oder HA als separate Folgephase planen. |
| Monitoring zeigt Metriken, aber keine Operator-Handlung | 3.9 | `/api/status`, Logs, WS-Telemetrie | Schwellwerte, Runbook-Aktionen und Alert-Tests für Grenzwertüberschreitungen definieren. |
| API-/WS-Änderungen brechen externe Clients | 3.10 | iframe-API, historische Statuswerte, `/api/status` Aliasse, Legacy-Felder | Versionierung, Parallelbetrieb und Migrationstests vor Sunset. |

---

## Empfohlene Reihenfolge

1. **3.7 Release-Gate** verbindlich machen, weil alle weiteren Maßnahmen darüber freigegeben werden; Phase 3.6 ist fachlich abgeschlossen.
3. **3.5 Sandbox-Vertrag** als regelmäßiges Sicherheits-/Docker-Gate operationalisieren.
4. **3.9 Observability** mit Schwellenwerten, Runbooks und Alert-Tests vervollständigen.
5. **3.10 API-/WebSocket-Versionierung** mit Kompatibilitäts- und Migrationstests festlegen.
6. **3.4/3.8** nur bei neuem Kapazitätsziel erneut ausführen; die bestehende Single-Node-Grenze ist bereits entschieden.

Die strukturellen Restabweichungen 2.2–2.7 bleiben dokumentiert, sind aber nach aktueller Priorisierung keine unmittelbaren Phase-3-Arbeitsschritte.

---

## Teilsteps

### Teilstep 3.4 — Lasttest 50/100/200

| Feld | Inhalt |
| --- | --- |
| Ziel | Reproduzierbare Lasttests für 50, 100 und 200 Clients mit Hostmetriken, WebSocket-Latenz, Health-/Status-Latenz, Sandbox-Cleanup und dokumentierter Kapazitätsaussage etablieren. |
| Betroffene Dateien/Dokumente | `docs/SCALABILITY_100_STUDENTS.md`, `docs/TESTING_STANDARDS.md`, `package.json`, `vitest.config.ts`, `playwright.scalability.config.ts`, `e2e/scalability-many-clients.spec.ts`, `tests/server/load-suite.test.ts`, `tests/server/services/scalability-stress.test.ts`, `tests/integration/concurrent-50-clients.test.ts`, ggf. `tests/utils/ws-test-client.ts`. |
| Notwendige Code-/Infra-/Teständerungen | Messprofil und Pass/Fail-Kriterien dokumentieren; vorhandene `test:load:*`-Skripte gegen reale Anforderungen prüfen; bei Bedarf opt-in Real-WS-/Real-Docker-Harness ergänzen; Messartefakte in `test-results/` erzeugen. |
| Voraussetzungen | Docker-Daemon verfügbar; `unosim-sandbox:latest` gebaut; definierte Hostklasse; keine parallele Last auf demselben Docker-Daemon; 3.7-Gate-Grundregeln bekannt. |
| Relevante Tests/Gates | `npm run test:load:50`, `npm run test:load:100`, `npm run test:load:200`, `CLIENT_COUNT=40 npx playwright test --config=playwright.scalability.config.ts`, später opt-in Real-Docker-Multi-Client-Gate. |
| Abbruchkriterien | Hostmetriken fehlen; Test nutzt Mocks, obwohl reale Kapazität behauptet wird; Container/Prozesse bleiben zurück; 50-Client-Basis ist nicht stabil. |
| Commit-Grenze | Erst Dokumentation/Messprofil; danach Test-Utility; danach einzelne Lastprofile 50, 100, 200. |
| Empfohlene Commit-Message | `docs(phase-3.4): define load test baseline` |

### Teilstep 3.5 — Sandbox-Vertrag

| Feld | Inhalt |
| --- | --- |
| Ziel | Den Sandbox-Vertrag regelmäßig durch Docker-, Integrations- und Security-Tests verifizieren: Isolation, Ressourcenlimits, Netzwerkverbot, read-only Verhalten, Cleanup, Timeout, Gateway-Sicherheitsannahmen, Penetrationstests und Container-Escape-Versuche. |
| Betroffene Dateien/Dokumente | `README_SECURITY.md`, `README_ADMIN.md`, `docs/adr/0001-authentication-and-gateway-contract.md`, `docs/TESTING_STANDARDS.md`, `Dockerfile.sandbox`, `docker-compose.yml`, `tests/integration/docker-security-contract.test.ts`, `tests/core/sandbox-stress.test.ts`, Docker-/Sandbox-Lifecycle-Tests. |
| Notwendige Code-/Infra-/Teständerungen | Sandbox-Testmatrix dokumentieren; bestehende Docker-/Security-Tests dem Vertrag zuordnen; Penetrationstest- und Container-Escape-Prüfungen als kontrollierte opt-in Tests oder manuelle Audit-Schritte abbilden; keine Security-Defaults lockern. |
| Voraussetzungen | Docker-Sandbox-Image verfügbar; Gateway-/Trust-Konfiguration eindeutig; 3.7 definiert, ob das Gate Pflicht oder opt-in ist. |
| Relevante Tests/Gates | `npm run test:security:inputs`, `npm run test:docker`, Penetrationstest: Container-Escape-Versuche, `RUN_HEAVY_TESTS=1 ./run-tests.sh`, `./check-leaks.sh --cleanup`, `npm audit --omit=dev`, SonarQube Security-Prüfung. |
| Abbruchkriterien | Ein Test benötigt echte Secrets; Test öffnet unsichere öffentliche Bindings; Test widerspricht ADR 0001; Cleanup ist nicht zuverlässig. |
| Commit-Grenze | Vertrag/Matrix separat; zusätzliche Tests einzeln nach Vertragsaspekt; Infrastrukturänderungen nie mit Doku-only vermischen. |
| Empfohlene Commit-Message | `docs(phase-3.5): define sandbox contract gate` |

### Teilstep 3.6 — Coverage-Hotspots

| Feld | Inhalt |
| --- | --- |
| Ziel | Kritische, aktuell schwächer getestete Bereiche gezielt absichern, besonders WebSocket-Lifecycle, Compiler, Sandbox-Ausführung und Page/ViewModel-Komposition. Zielwerte bleiben: alle Hotspots >60 %, kritische Hotspots >80 %. |
| Betroffene Dateien/Dokumente | `docs/TESTING_STANDARDS.md`, `coverage/coverage-summary.json`, `tests/**`, Hotspot-Dateien aus Projektanalyse und aktuellem Coverage-Report. |
| Notwendige Code-/Infra-/Teständerungen | Zuerst aktuelle Hotspot-Liste aus Coverage-Report validieren; dann kleine behavior-orientierte Tests ergänzen; keine Refactoring-Arbeit ohne Characterization-Test. Falls `alle Hotspots >60 %` oder `kritische >80 %` in einem Teilstep nicht erreichbar sind, muss die Abweichung mit Risiko, Grund und Folgeplan dokumentiert werden. |
| Voraussetzungen | Aktueller Coverage-Lauf; keine Vermischung mit Feature- oder Refactoring-Commits; stabile Testdaten. |
| Relevante Tests/Gates | `npm run test:coverage`, Coverage-Bericht mit `alle Hotspots >60 %` und `kritische >80 %`, `npm run test:unit`, relevante Integrationstests, `npm run check`, SonarQube Coverage-Import. |
| Abbruchkriterien | Tests prüfen Implementierungsdetails statt Verhalten; Snapshot-/Timing-Flakiness steigt; Coverage-Ziel erzwingt riskante Produktionsänderung. |
| Commit-Grenze | Pro Hotspot oder Fachfluss ein Test-Commit; Produktivänderungen nur, wenn Test einen echten Bug belegt. |
| Empfohlene Commit-Message | `test(phase-3.6): cover critical operational hotspot` |

### Teilstep 3.7 — Release-Gate

| Feld | Inhalt |
| --- | --- |
| Ziel | Ein verbindliches Release-Gate definieren: Typecheck, Unit, relevante Integration, Docker, E2E, Build, SonarQube und Security-Audit mit klaren Abbruchregeln. |
| Betroffene Dateien/Dokumente | `README_ADMIN.md`, `docs/TESTING_STANDARDS.md`, ggf. neues Release-Runbook, `run-tests.sh`, `package.json`, `sonar-project.properties`, CI-Konfiguration falls vorhanden. |
| Notwendige Code-/Infra-/Teständerungen | Release-Runbook erstellen; existierende Scripts einordnen; nur additive Script-Klarstellungen, wenn ein dokumentierter Schritt nicht ausführbar ist. |
| Voraussetzungen | SonarQube-Projekt `unosim`; Docker-Verfügbarkeit für Docker-/E2E-Gates; klare Unterscheidung Pflichtgate vs. Heavy-/Load-Gate. |
| Relevante Tests/Gates | `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:docker`, `npm run test:e2e`, `npm run build`, `npm run sonar`, `npm audit`, `./run-tests.sh`. |
| Abbruchkriterien | Ein Pflichtgate ist nicht reproduzierbar; erforderliche Secrets sind undokumentiert; SonarQube Quality Gate ist rot; Security-Audit meldet nicht akzeptierte kritische Befunde. |
| Commit-Grenze | Release-Gate-Dokumentation separat; Script- oder CI-Anpassungen separat. |
| Empfohlene Commit-Message | `docs(phase-3.7): define release gate` |

### Teilstep 3.8 — Skalierbarkeit / HA-Entscheidung

| Feld | Inhalt |
| --- | --- |
| Ziel | Horizontal skalierbarkeit bewusst entscheiden: Single Stateful Node als akzeptiertes Betriebsmodell dokumentieren oder HA-Zielarchitektur als separate Folgearbeit entwerfen. |
| Betroffene Dateien/Dokumente | `docs/SCALABILITY_100_STUDENTS.md`, `docs/ARCHITECTURE.md`, `README_ADMIN.md`, neues ADR unter `docs/adr/`, `docker-compose.yml` nur falls Entscheidung eine dokumentierte Konfigurationsklarstellung benötigt. |
| Notwendige Code-/Infra-/Teständerungen | Entscheidung/ADR erstellen; keine HA-Implementierung in diesem Teilstep; Folgeplan nur bei expliziter HA-Entscheidung. |
| Voraussetzungen | Belastbare Erkenntnisse aus 3.4; Metrik-/Monitoring-Grundlage aus 3.9 zumindest inventarisiert; bekannte Stateful-Komponenten bewertet. |
| Relevante Tests/Gates | `npm run check:docs`; bei jeder Infra-Änderung zusätzlich `npm run check`, `npm run test:docker`, ggf. Playwright-Scalability. |
| Abbruchkriterien | Entscheidung basiert auf Zielbild statt Messdaten; Stateful-WS-/RunnerPool-Realität wird ignoriert; HA wird implizit versprochen, aber nicht getestet. |
| Commit-Grenze | ADR plus minimale Doku-Verweise; keine gleichzeitige Produktivarchitekturänderung. |
| Empfohlene Commit-Message | `docs(phase-3.8): decide scalability and ha model` |

### Teilstep 3.9 — Observability

| Feld | Inhalt |
| --- | --- |
| Ziel | Strukturierte Metriken für Queues, Runner, Compile-Slots, WebSocket-Sessions, Timeouts und Serial-/Telemetry-Drops definieren und betreibbar machen; Alert-Tests müssen Grenzwertüberschreitungen melden. |
| Betroffene Dateien/Dokumente | `docs/ARCHITECTURE.md`, `README_ADMIN.md`, `ssot/ssot_function_description_serial_output.md`, `server/routes/status.routes.ts`, `server/routes/simulation.ws.ts`, Status-/Telemetry-Tests. |
| Notwendige Code-/Infra-/Teständerungen | Metrikinventar, Schwellenwerte und Betreiberreaktionen dokumentieren; Alert-Tests für Grenzwertüberschreitungen abbilden; fehlende Metrikexports oder Tests nur additiv ergänzen. |
| Voraussetzungen | Aktuelle `/api/status`- und WS-Telemetrie inventarisiert; keine API-Feldänderung ohne 3.10-Versionierung. |
| Relevante Tests/Gates | Status-Route-Tests, Telemetry-Heartbeat-Integration, WebSocket-State-Tests, Alert-Tests für Grenzwertüberschreitungen, `npm run check`, `npm run test:unit`, ggf. `npm run test:integration`. |
| Abbruchkriterien | Neue Metriken ändern bestehende öffentliche Felder inkompatibel; Schwellenwerte sind nicht messbar; Logs enthalten sensible Daten. |
| Commit-Grenze | Observability-Konzept separat; jede Metrik/Test-Ergänzung einzeln. |
| Empfohlene Commit-Message | `docs(phase-3.9): define observability contract` |

### Teilstep 3.10 — API-/WebSocket-Versionierung

| Feld | Inhalt |
| --- | --- |
| Ziel | Externe API und WebSocket-Protokoll versionieren: REST-/Status-API, WS-Nachrichten und iframe-postMessage-Vertrag mit Migration und Parallelbetrieb absichern. |
| Betroffene Dateien/Dokumente | `docs/EXTERNAL_API.md`, `docs/ARCHITECTURE.md`, `client/src/types/external-api.ts`, `shared/schema.ts`, `server/routes/status.routes.ts`, `server/routes/simulation.ws.ts`, WebSocket-/External-API-Tests. |
| Notwendige Code-/Infra-/Teständerungen | Versionierungs- und Deprecation-Policy definieren; alte und neue Protokollvarianten parallel testbar machen; keine Entfernung historischer Werte ohne Sunset-Freigabe. |
| Voraussetzungen | Phase 3.3 abgeschlossen; Consumer-/Compatibility-Inventar aus Phase 3.3 liegt vor; 3.7-Gate definiert. |
| Relevante Tests/Gates | `npm run check`, `npm run test:unit`, relevante WS-/Schema-/External-API-Tests, `npm run test:e2e`, Doku-Check. |
| Abbruchkriterien | Entfernt oder ändert öffentliche Felder ohne Versionierung; setzt Sunset-Fristen ohne Consumer-Evidenz; widerspricht API-Version `1.4.0`. |
| Commit-Grenze | Policy zuerst; Schema-/Code-Ergänzungen separat; spätere Sunset-/Removal-Commits nur in Major-Release-Arbeit. |
| Empfohlene Commit-Message | `docs(phase-3.10): define api websocket versioning` |

---

## Standard-Gates

### Für Dokumentations-only-Teilsteps

- `npm run check:docs`
- `git diff --check`
- SonarQube-Analyse der geänderten Dokumentationsdateien, soweit verfügbar

### Für Code-/Test-/Infra-Teilsteps

- `npm run check`
- `npm run test:unit`
- relevante Integrationstests je Teilstep
- `npm run check:docs`, wenn Dokumentation geändert wurde
- SonarQube-Analyse der geänderten Dateien

### Für Release-nahe Teilsteps

- `npm run test:integration`
- `npm run test:docker`
- `npm run test:e2e`
- `npm run build`
- `npm run sonar`
- `npm audit`
- `./run-tests.sh`

### Für Last-/Heavy-Teilsteps

- `npm run test:load:50`
- `npm run test:load:100`
- `npm run test:load:200`
- `RUN_HEAVY_TESTS=1 ./run-tests.sh`
- Playwright-Scalability gegen laufenden Docker-Stack mit dokumentiertem `CLIENT_COUNT`

---

## Completion Criteria

Phase 3.4 bis 3.10 gelten nur dann als abgeschlossen, wenn alle folgenden Kriterien erfüllt oder ausdrücklich begründet deferred sind:

1. 3.4 liefert reproduzierbare 50/100/200-Lasttestprofile mit Hostmetriken und Pass/Fail-Kriterien.
2. 3.5 verifiziert den Sandbox-Vertrag regelmäßig über dokumentierte Docker-/Integration-/Security-Gates inklusive Penetrationstest und Container-Escape-Versuchen.
3. 3.6 hat aktuelle Coverage-Hotspots geprüft; alle Hotspots erreichen >60 % und kritische Hotspots >80 %, oder jede Abweichung ist explizit begründet.
4. 3.7 definiert ein verbindliches Release-Gate inklusive Security-Audit und SonarQube.
5. 3.8 dokumentiert die Skalierbarkeits-/HA-Entscheidung ohne implizite HA-Versprechen.
6. 3.9 definiert Metriken, Quellen, Schwellenwerte, Betreiberreaktionen und Alert-Tests, die Grenzwertüberschreitungen melden.
7. 3.10 definiert API-/WebSocket-Versionierung mit Parallelbetrieb, Migrationstests und Sunset-Regeln.
8. Bereits erledigte 3.1–3.3-Arbeiten bleiben abgeschlossen und werden nicht als offene Arbeit reaktiviert.
9. Alle neuen oder geänderten Dokumente bestehen `npm run check:docs`.
10. Bei jeder Code-/Infra-/Teständerung sind die zum Teilstep gehörenden Standard-Gates grün.
11. SonarQube-Analyse der geänderten Dateien wurde durchgeführt; vor Release ist das Quality Gate für `unosim` grün.

---

## Aktuelle Arbeitsgrenze

Dieser Plan ist eine Dokumentations- und Planungsänderung. Der nächste Umsetzungsschritt ist Teilstep 3.7 oder 3.4, nicht eine neue Phase 4.
