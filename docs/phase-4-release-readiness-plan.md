# Phase 4: Release-Readiness- und Betriebsreife-Plan

Status: superseded / historical  
Zielrolle: historical-correction-note  
Datum: 2026-09-06  
Ersetzt durch: `docs/phase-3.4-3.10-operational-readiness-plan.md`

> **Korrektur:** Laut `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md` gibt es keine Phase 4.
> Die noch offenen betrieblichen Maßnahmen gehören zu **Phase 3.4 bis 3.10**.
> Dieses Dokument ist nicht mehr als aktive Roadmap zu verwenden.

Die folgenden Inhalte bleiben nur als historischer Zwischenstand erhalten. Der
verbindliche Plan ist `docs/phase-3.4-3.10-operational-readiness-plan.md`.

---

# Historischer Inhalt

Status: superseded  
Zielrolle: historical-release-readiness-draft  
Datum: 2026-09-06  
Grundlage: bestehende Roadmap-, Analyse-, Architektur-, SSOT-, Security-, Test- und Deferred-Dokumentation.  
Verbindlichkeit: Keine; ersetzt durch `docs/phase-3.4-3.10-operational-readiness-plan.md`.

---

## Scope / Non-Scope

### Scope

Phase 4 umfasst die Betriebs- und Release-Reife der bestehenden UnoSim-Architektur. Der Scope ergibt sich aus den bereits dokumentierten offenen Punkten der Projektanalyse, Skalierungsplanung, Security-/Admin-Dokumentation, Teststandards und den Deferred-/Sunset-Entscheidungen aus Phase 3.3.

Verbindliche Themenfelder:

1. Release- und Quality-Gates reproduzierbar definieren und ausfuehrbar machen.
2. Load-/Scalability-Tests fuer 50/100/200 Clients belastbar einordnen und als separate Gates fuehren.
3. Sandbox-/Security-Vertrag regelmaessig und opt-in produktionsnah pruefen.
4. Observability/Monitoring fuer Queues, Runner, Compile-Slots, WebSocket-Sessions, Timeouts und Serial-Drops konkretisieren.
5. HA-/Deployment-Entscheidung dokumentieren: aktueller Single-Stateful-Node bleibt verbindlicher Ist-Zustand, HA nur als Architekturentscheidung/Option.
6. REST-/WebSocket-/iframe-API-Versionierung und Sunset-Mechanik fuer bestehende Kompatibilitaetsflaechen vorbereiten.
7. Major-Release-/Sunset-Readiness fuer Phase-3.3-Deferred-Punkte herstellen, ohne sie in Phase 4 ungeprueft zu entfernen.

### Non-Scope

- Keine Produktivcode-Aenderungen durch diesen Plan.
- Keine sofortige Entfernung oeffentlicher Aliasse oder Legacy-Vertraege.
- Keine neue Laufzeitarchitektur wie Browser-WASM-Simulation, SharedWorker-Multiplexing, Cloud-Burst oder HA-Cluster ohne eigene ADR/Phase.
- Kein v2.0.0-Release als automatisches Ziel. Phase 4 bereitet Major-Release-Entscheidungen vor; ein tatsaechlicher Major-Release braucht separate Freigabe.
- Keine Wiederholung abgeschlossener Phase-2-, Phase-3.1-, Phase-3.2- oder Phase-3.3-Arbeiten als offene Tasks.
- Keine Aenderung an Tests, CI, Docker, Security oder API-Vertraegen ohne dedizierten Teilstep und gruene Gates.

---

## Quellenbasis

| Quelle | Status laut Quelle | Relevanz fuer Phase 4 |
| --- | --- | --- |
| `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md` | `planning` | Hauptquelle fuer Phase-3-hochbedeutende Betriebsaufgaben: Lasttest, Sandbox-Vertrag, Coverage, Release-Gate, HA-Entscheidung, Observability, Versionierung. |
| `docs/ARCHITECTURE.md` | `current` | Normativer Ist-Architekturueberblick: Single Backend, REST, WebSocket, SandboxRunnerPool, Metriken ueber `/api/status`, API-Versionierungsziel. |
| `docs/SCALABILITY_100_STUDENTS.md` | `planning` | Aktive Kapazitaetsquelle: aktuelle Single-Stateful-Node-Grenze, Engpaesse, Quick-Wins, echte Multi-WS-/Docker-Testanforderungen, 200-Client-Zielbilder. |
| `docs/TESTING_STANDARDS.md` | `current` | Timing-Toleranzen, Coverage-Hotspots, Heavy-Test-Regeln und Mindestgates. |
| `docs/EXTERNAL_API.md` | `current` | Normativer iframe-postMessage-Vertrag, API-Version `1.4.0`, aktuelle und historische Simulation-Statuswerte. |
| `docs/adr/0001-authentication-and-gateway-contract.md` | `accepted` | Verbindlicher Auth-/Gateway-Vertrag fuer oeffentliche Deployments. |
| `README_SECURITY.md` | `current` | Implementierte Schutzmassnahmen, Restrisiken und Produktionsmindestanforderungen. |
| `README_ADMIN.md` | `current` | Betriebsmodi, Env-Variablen, Gateway-Hinweise und Admin-Gates. |
| `docs/phase-3.3-deprecation-legacy-plan.md` | `completed` | Inventar und Sunset-/Deferred-Matrix fuer 13 Legacy-/Kompatibilitaetsflaechen. |
| `docs/phase-3.3-implementation-report.md` | `completed` | Abschlussentscheidungen Phase 3.3; offene Phase-4-/Major-Release-Kandidaten. |
| `docs/archive/plans/phase-2-deferred.md` | `deferred-work-index` | Noch offene Config-/Worker-/Timeout-/Cache-Klaerungen aus Phase 2.7. |
| `ssot/ssot_agent_policy.md` | `current` | Workflow-, Evidence-, Git- und Test-Governance. |
| `ssot/ssot_io-registry.md` | `current` | Fachlicher Hybrid-I/O-Registry-Vertrag; wichtig fuer Legacy-Feld-Sunset. |
| `ssot/ssot_function_description_serial_output.md` | `current` | Serial-Output-, Batching- und Telemetrie-Vertrag; wichtig fuer Observability und API-Kompatibilitaet. |
| `package.json`, `run-tests.sh`, `vitest.config.ts`, `playwright.scalability.config.ts`, `e2e/scalability-many-clients.spec.ts` | Code/Test-Realitaet | Bestehende Gates, Lasttest-Skripte, Heavy-Test-Schalter und aktuelle Testtopologie. |
| `docker-compose.yml`, `Dockerfile`, `Dockerfile.sandbox`, `sonar-project.properties` | Code/Infra-Realitaet | Produktionsmodus, Sandbox-Image, Ressourcengrenzen, SonarQube-Projekt `unosim`. |

---

## Ist-vs.-Ziel-Matrix

| Thema | Ist | Ziel fuer Phase 4 | Entscheidung |
| --- | --- | --- | --- |
| Release-/Quality-Gates | `./run-tests.sh`, `npm run check`, Unit/Integration/Docker/E2E/Build/Sonar existieren; SonarQube-Projekt `unosim` ist konfiguriert. | Ein verbindlicher Release-Gate-Runbook mit Pflicht-/Opt-in-Gates, Artefakten, Abbruchregeln und Quality-Gate-Kriterien. | Offen in Phase 4. |
| Load-/Scalability-Tests | Load-Projekt und Skripte `test:load:50/100/200` existieren; Playwright-Scalability-Test prueft viele iframes/WS-Verbindungen; echte Docker-Last ist nicht Standardgate. | Reproduzierbare Lasttestprofile inklusive Hostvoraussetzungen, Metriken, Pass/Fail-Kriterien und Cleanup. | Offen in Phase 4. |
| Sandbox-/Security-Tests | Docker- und Security-Tests existieren; Heavy Tests sind opt-in; Produktionsmindestanforderungen dokumentiert. | Dediziertes Sandbox-Security-Gate mit regelmaessigem opt-in Lauf und dokumentierter Evidenz. | Offen in Phase 4. |
| Observability/Monitoring | `/api/status` und WS-Events liefern Runner-, Compile-, Session- und Serial-Metriken; Debug-/Telemetry-SSOT vorhanden. | Monitoring-Konzept mit Metriknamen, Schwellenwerten, Log-/Alert-Regeln und Betreiber-Checkliste. | Offen in Phase 4. |
| HA-/Deployment | Aktueller Betrieb ist ein einzelner zustandsbehafteter Backend-Knoten; Compose bindet lokal/gateway-orientiert. | Explizite ADR: Single-Stateful-Node als v1.x Betriebsmodell oder HA-Zielarchitektur als Folgephase. | Offen in Phase 4. |
| API-/WebSocket-Versionierung | iframe-API hat Version `1.4.0`; Architektur nennt REST `/api/v1/status` und WS-Handshake-Versionierung als Ziel, aber Ist-REST nutzt `/api/status`. | Versionierungs- und Deprecation-Policy fuer REST, WS und iframe-API mit Testmatrix. | Offen in Phase 4. |
| Major-Release-/Sunset | Phase 3.3 klassifiziert Legacy-/Compatibility-Flaechen; mehrere Aliasse bleiben aus Kompatibilitaetsgruenden. | Sunset-Readiness herstellen: Consumer-Inventur, Telemetrie/Monitoring, Migrationsdocs und Major-Release-Checkliste. | Offen in Phase 4, Entfernung erst spaeter. |
| Phase-2-Deferred Config | `server/config.ts` ist zentrale Quelle; einzelne Worker-/Timeout-/Cache-Faelle bleiben deferred. | Risiken erfassen und entscheiden, ob Teil von Release-Readiness oder separater Refactoring-Phase. | Phase 4 bewertet, implementiert nicht automatisch. |

---

## bereits erledigte Punkte

| Bereich | Erledigt | Evidenz |
| --- | --- | --- |
| Basisqualitaet | TypeScript, Unit-, Integration-, Docker-, E2E-, Build- und SonarQube-Gates existieren. | `package.json`, `run-tests.sh`, `sonar-project.properties`. |
| Testtaxonomie | Vitest-Projekte fuer Unit, Toolchain, Docker und Load sind getrennt. | `vitest.config.ts`. |
| Heavy-Test-Mechanik | Ressourcenintensive Tests sind ueber `RUN_HEAVY_TESTS=1` opt-in. | `docs/TESTING_STANDARDS.md`, `run-tests.sh`. |
| Gateway-Security | Authentifizierender Gateway-Vertrag ist akzeptiert und dokumentiert. | `docs/adr/0001-authentication-and-gateway-contract.md`, `README_SECURITY.md`. |
| Produktionsmindestanforderungen | Gateway-Mode, Secret, Trusted Proxy, WS-Origin-Allowlist und Docker-Sandbox sind dokumentiert. | `README_SECURITY.md`, `README_ADMIN.md`, `docker-compose.yml`. |
| Single-Node-Transparenz | Aktueller verbindlicher Betrieb ist als einzelner zustandsbehafteter Backend-Knoten beschrieben. | `docs/SCALABILITY_100_STUDENTS.md`, `README_ADMIN.md`. |
| Skalierungs-Quick-Wins | Pool-/Polling-/Ressourcenoptimierungen sind laut Kapazitaetsdokument bereits umgesetzt bzw. konfiguriert. | `docs/SCALABILITY_100_STUDENTS.md`, `docker-compose.yml`. |
| API-Basisvertrag | iframe-postMessage-API ist versioniert und dokumentiert. | `docs/EXTERNAL_API.md`. |
| Deprecation-Inventar | 13 Legacy-/Kompatibilitaetsflaechen sind final klassifiziert. | `docs/phase-3.3-deprecation-legacy-plan.md`, `docs/phase-3.3-implementation-report.md`. |
| I/O-Registry-Migration | Moderne Runtime-Felder werden gesetzt; Legacy-Felder bleiben Fallback. | Phase-3.3-Bericht und I/O-Registry-Tests. |
| Serial-/Telemetry-Vertrag | Serial-Output-Batching, Drop-Zaehlung und Telemetrie sind fachlich beschrieben. | `ssot/ssot_function_description_serial_output.md`. |

---

## offene Phase-4-Themen

| ID | Thema | Ergebnisartefakt | Offen, weil |
| --- | --- | --- | --- |
| P4-01 | Release-Gate-Runbook | `docs/release-readiness-runbook.md` oder Abschnitt in `README_ADMIN.md` | Die vorhandenen Gates existieren, aber Freigabe-, Artefakt- und Abbruchregeln sind noch nicht als Release-Prozess gebuendelt. |
| P4-02 | Lasttest-Baseline | Aktualisierte Skalierungsdoku plus Messartefakte in `test-results/` | Lastskripte existieren, aber reproduzierbare Hardware-/Hostprofile und Pass/Fail-Kriterien fuer 50/100/200 fehlen. |
| P4-03 | Echte Multi-WS-/Docker-Last | Test-Utility/opt-in Gate fuer reale WS + Docker-Container | `SCALABILITY_100_STUDENTS.md` benennt diese Luecke ausdruecklich. |
| P4-04 | Sandbox-Security-Gate | Security-Testmatrix und regelmaessiger opt-in Lauf | README_SECURITY beschreibt Schutzmassnahmen, aber der Release-Gate-Zuschnitt muss operationalisiert werden. |
| P4-05 | Observability-Konzept | Monitoring-/Alerting-Dokument und ggf. Status-Metrik-Kontrakt | Metriken existieren, aber Schwellenwerte, Operator-Aktionen und Alert-Regeln fehlen. |
| P4-06 | Deployment-/HA-ADR | ADR fuer Single-Stateful-Node vs. HA-Zielbild | Dokumente sagen aktuell Single Node; Phase 4 muss entscheiden, ob das fuer Release reicht. |
| P4-07 | API-/WS-Versionierung | Versionierungs-/Sunset-Policy mit Testmatrix | iframe-API ist versioniert, REST/WS-Versionierung ist noch Zielbild bzw. uneinheitlich. |
| P4-08 | Major-Release-Sunset-Readiness | Consumer-Inventur, Migrationshinweise, Entfernungsvoraussetzungen | Phase-3.3-Deferred-Punkte duerfen erst nach Nachweis/Sunset entfernt werden. |
| P4-09 | Phase-2-Deferred-Bewertung | Entscheidungsliste zu Timeout/Gatekeeper/Cache/Worker-Konfiguration | Einige Config-Fragen sind deferred und koennen Release-Risiken sein. |
| P4-10 | Doku-Konsistenz Release | Aktualisierte README/Admin/Architecture/Testing-Referenzen | Einzelne Dokumente enthalten historische Begriffe oder abweichende Annahmen. |

---

## Risiko-/Abhaengigkeitsmatrix

| Risiko | Abhaengigkeiten | Impact | Wahrscheinlichkeit | Gegenmassnahme in Phase 4 |
| --- | --- | --- | --- | --- |
| Release ohne reproduzierbares Gate | `run-tests.sh`, SonarQube, Docker, Playwright | Hoch | Mittel | P4-01 vor allen produktionsnahen Freigaben abschliessen. |
| Lasttestaussagen ohne definierte Hardware | Docker Desktop RAM, Pool-Limits, Browser-Slots, Hostmetriken | Hoch | Hoch | P4-02 mit Hostprofilen und Messprotokoll zuerst etablieren. |
| Multi-Client-Isolation unter realer Docker-Last ungeprueft | WS-Testclient, Docker-Daemon, Sandbox-Image, Cleanup | Hoch | Mittel | P4-03 als opt-in Gate, nicht als Standard-Unit-Gate. |
| Sandbox-Sicherheitsannahmen driften | Dockerfile.sandbox, Docker-Run-Flags, Compose, Gateway | Hoch | Mittel | P4-04 mit Testmatrix und Security-Runbook. |
| Produktionsprobleme nicht diagnostizierbar | `/api/status`, Telemetrie, Logs, Operator-Zugriff | Mittel-Hoch | Mittel | P4-05 definiert Metriken, Schwellen und Reaktionspfade. |
| HA-Erwartung widerspricht Ist-Architektur | Stateful Sessions, RunnerPool, Docker-Socket, WebSockets | Hoch | Mittel | P4-06: Single-Node als bewusstes Release-Modell oder HA-ADR fuer Folgephase. |
| API-Sunset bricht externe Integrationen | iframe-API, WS-Schema, `/api/status`, Legacy-Statuswerte | Hoch | Mittel | P4-07/P4-08: Versionierung, Consumer-Inventur, Parallelbetrieb, Major-Release-Checkliste. |
| Phase-2-Deferred-Konfiguration blockiert Betrieb | Worker-Timeouts, Gatekeeper-Disable, Cache-Pfade, `FORCE_DOCKER` | Mittel | Mittel | P4-09 entscheidet Release-relevant vs. Refactoring-Folgephase. |
| Doku widerspricht Code | README, Admin, Architecture, Scalability, SSOT | Mittel | Hoch | P4-10 als abschliessendes Doku-Konsistenzgate. |

---

## empfohlene Reihenfolge

1. **P4-01 Release-Gate-Runbook**: Ohne verbindliches Gate keine Release-Readiness.
2. **P4-02 Lasttest-Baseline**: Erst definieren, was 50/100/200 belastbar bedeutet.
3. **P4-03 Echte Multi-WS-/Docker-Last**: Testluecke aus Skalierungsdoku schliessen.
4. **P4-04 Sandbox-Security-Gate**: Security-Vertrag operationalisieren.
5. **P4-05 Observability-Konzept**: Metriken und Schwellen fuer Betrieb festlegen.
6. **P4-06 Deployment-/HA-ADR**: Release-Betriebsmodell explizit entscheiden.
7. **P4-07 API-/WS-Versionierung**: Versionierungsmechanik festlegen, bevor Sunsets vorbereitet werden.
8. **P4-08 Major-Release-Sunset-Readiness**: Phase-3.3-Deferred-Punkte in Migrationsplan ueberfuehren.
9. **P4-09 Phase-2-Deferred-Bewertung**: Offene Config-/Worker-/Cache-Fragen in Release-Risiken oder Folgephase einsortieren.
10. **P4-10 Abschluss-Doku und Release-Readiness-Review**: Alle Artefakte konsolidieren und Completion Criteria pruefen.

---

## Teilsteps

### Teilstep P4-01 — Release-Gate-Runbook verbindlich machen

| Feld | Inhalt |
| --- | --- |
| Ziel | Einen reproduzierbaren Release-Prozess definieren: Pflichtgates, optionale gates, Artefakte, Verantwortlichkeiten, Abbruchregeln und SonarQube-Qualitaetskriterien. |
| Betroffene Dateien/Dokumente | `README_ADMIN.md`, `docs/TESTING_STANDARDS.md`, ggf. neues `docs/release-readiness-runbook.md`, `run-tests.sh`, `package.json`, `sonar-project.properties`. |
| Notwendige Code-/Infra-/Testaenderungen | Primaer Dokumentation. Code/CI nur, wenn ein dokumentiertes Gate noch nicht aufrufbar ist. Keine Veraenderung der Gate-Semantik ohne separaten Commit. |
| Voraussetzungen | Aktuelle Pipeline-Gates bekannt; SonarQube-Projektkey `unosim`; Docker-Verfuegbarkeit fuer Docker/E2E-Gates geklaert. |
| Relevante Tests/Gates | `npm run check:docs`, `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run test:docker`, `npm run test:e2e`, `npm run build`, `./run-tests.sh`, SonarQube Quality Gate. |
| Abbruchkriterien | Ein Pflichtgate ist lokal/CI nicht eindeutig ausfuehrbar, benoetigt undokumentierte Secrets oder widerspricht bestehender Testtaxonomie. |
| Commit-Grenze | Nur Release-Gate-Dokumentation und ggf. rein additive Script-/README-Klarstellungen. |
| Empfohlene Commit-Message | `docs(phase-4): define release readiness gate runbook` |

### Teilstep P4-02 — Lasttest-Baseline und Messprofil festlegen

| Feld | Inhalt |
| --- | --- |
| Ziel | Definieren, unter welchen Host-, Docker-, Browser- und Konfigurationsbedingungen `test:load:50`, `test:load:100`, `test:load:200` und Playwright-Scalability gueltige Aussagen liefern. |
| Betroffene Dateien/Dokumente | `docs/SCALABILITY_100_STUDENTS.md`, `docs/TESTING_STANDARDS.md`, `playwright.scalability.config.ts`, `e2e/scalability-many-clients.spec.ts`, `tests/server/load-suite.test.ts`, `tests/server/services/scalability-stress.test.ts`, `tests/integration/concurrent-50-clients.test.ts`. |
| Notwendige Code-/Infra-/Testaenderungen | Zunaechst Dokumentation und Messschema. Testaenderungen nur, wenn Pass/Fail-Kriterien oder Artefakte fehlen. |
| Voraussetzungen | P4-01 abgeschlossen; definierter Testhost; Docker-Sandbox-Image vorhanden; keine parallele SonarQube-/Laststoerung auf demselben Docker-Daemon, sofern Messung dadurch verfaelscht wird. |
| Relevante Tests/Gates | `npm run test:load:50`, `npm run test:load:100`, `npm run test:load:200`, `CLIENT_COUNT=40 npx playwright test --config=playwright.scalability.config.ts`, optional hoehere `CLIENT_COUNT`-Werte. |
| Abbruchkriterien | Hostmetriken fehlen, Docker-Daemon ist instabil, Test misst nur Mock-Last obwohl eine reale Lastaussage behauptet wird. |
| Commit-Grenze | Ein Commit fuer Dokumentation/Messprofil; separater Commit fuer jede Test-Harness-Aenderung. |
| Empfohlene Commit-Message | `docs(phase-4): define scalability measurement baseline` |

### Teilstep P4-03 — Echte Multi-WS-/Docker-Last als opt-in Gate etablieren

| Feld | Inhalt |
| --- | --- |
| Ziel | Die in `SCALABILITY_100_STUDENTS.md` benannte Luecke schliessen: echte WebSocket-Clients mit realer Docker-Sandbox-Ausfuehrung pruefen, inklusive Isolation, Health unter Last und Cleanup. |
| Betroffene Dateien/Dokumente | `tests/utils/ws-test-client.ts` falls neu, `tests/integration/` oder `tests/server/`, `vitest.config.ts`, `package.json`, `docs/SCALABILITY_100_STUDENTS.md`, `docs/TESTING_STANDARDS.md`. |
| Notwendige Code-/Infra-/Testaenderungen | Reusable WS-Testclient, opt-in Testprofil, Messpunkte fuer Connect-Latenz/First-Output/Timeouts/Cleanup; keine Aufnahme ins schnelle Standardgate. |
| Voraussetzungen | P4-02 abgeschlossen; Docker laeuft; `unosim-sandbox:latest` gebaut; klare Ressourcenlimits fuer Testhost. |
| Relevante Tests/Gates | Neues opt-in Gate, bestehende `npm run test:docker`, `RUN_HEAVY_TESTS=1 ./run-tests.sh`, `./check-leaks.sh --cleanup`. |
| Abbruchkriterien | Test ist nicht deterministisch genug, laesst Container/Prozesse zurueck, oder vermischt Mock- und Real-Docker-Aussagen. |
| Commit-Grenze | Test-Utility separat; opt-in Test separat; Doku-Aktualisierung separat oder im Test-Commit, wenn unmittelbar zugehoerig. |
| Empfohlene Commit-Message | `test(phase-4): add opt-in real websocket docker load gate` |

### Teilstep P4-04 — Sandbox-/Security-Gate operationalisieren

| Feld | Inhalt |
| --- | --- |
| Ziel | Produktionsrelevante Sandbox- und Gateway-Sicherheitsannahmen regelmaessig pruefbar machen. |
| Betroffene Dateien/Dokumente | `README_SECURITY.md`, `README_ADMIN.md`, `docs/adr/0001-authentication-and-gateway-contract.md`, `Dockerfile.sandbox`, `docker-compose.yml`, `tests/integration/docker-security-contract.test.ts`, Security-/Input-Limit-Tests. |
| Notwendige Code-/Infra-/Testaenderungen | Primaer Testmatrix/Runbook; ggf. additive Tests fuer Docker-Flags, Origin/Gateway-Fail-Closed und Ressourcengrenzen. Keine Lockerung von Security-Defaults. |
| Voraussetzungen | P4-01 abgeschlossen; Gateway-Konfiguration fuer Testumgebung definierbar; Docker verfuegbar. |
| Relevante Tests/Gates | `npm run test:security:inputs`, `npm run test:docker`, `./run-tests.sh`, `npm audit --omit=dev`, SonarQube Security-Issues/Hotspots. |
| Abbruchkriterien | Ein Test erfordert echte Secrets, oeffnet lokale Produktionsports unsicher oder widerspricht ADR 0001. |
| Commit-Grenze | Security-Runbook/Doku getrennt von Testimplementierung; jede produktive Security-Aenderung separat. |
| Empfohlene Commit-Message | `docs(phase-4): define sandbox security release gate` |

### Teilstep P4-05 — Observability- und Monitoring-Konzept festlegen

| Feld | Inhalt |
| --- | --- |
| Ziel | Bestehende Metriken und Telemetrie in einen Betreibervertrag ueberfuehren: Was wird gemessen, wo erscheint es, welche Schwellwerte fuehren zu Warnung/Abbruch. |
| Betroffene Dateien/Dokumente | `docs/ARCHITECTURE.md`, `README_ADMIN.md`, `ssot/ssot_function_description_serial_output.md`, `server/routes/status.routes.ts`, `server/routes/simulation.ws.ts`, Telemetrie-/Status-Tests. |
| Notwendige Code-/Infra-/Testaenderungen | Zunaechst Dokumentation. Code nur fuer fehlende Metrik-Exporte oder Tests, wenn bestehende Metriken nicht ausreichend beobachtbar sind. |
| Voraussetzungen | P4-01 abgeschlossen; Ist-Metriken aus `/api/status` und WS-Events inventarisiert. |
| Relevante Tests/Gates | Status-Route-Tests, Telemetry-Heartbeat-Integration, WebSocket-State-Tests, `npm run check`, `npm run test:unit`, ggf. `npm run test:integration`. |
| Abbruchkriterien | Metrikdefinitionen widersprechen existierenden Response-Schemas oder wuerden oeffentliche API-Felder ohne Versionierung aendern. |
| Commit-Grenze | Monitoring-Konzept separat; Metrik-Erweiterungen jeweils atomar mit Tests. |
| Empfohlene Commit-Message | `docs(phase-4): define observability and monitoring contract` |

### Teilstep P4-06 — Deployment-/HA-Entscheidung per ADR treffen

| Feld | Inhalt |
| --- | --- |
| Ziel | Explizit entscheiden, ob Phase 4 fuer den naechsten Release beim Single-Stateful-Node bleibt oder eine HA-Zielarchitektur als Folgephase vorbereitet. |
| Betroffene Dateien/Dokumente | Neues ADR-Dokument unter `docs/adr/`, `docs/ARCHITECTURE.md`, `docs/SCALABILITY_100_STUDENTS.md`, `README_ADMIN.md`, `docker-compose.yml`. |
| Notwendige Code-/Infra-/Testaenderungen | Keine fuer die ADR. Bei HA-Entscheidung nur Folgeplan, keine direkte Implementierung in diesem Teilstep. |
| Voraussetzungen | P4-02/P4-05 liefern Kapazitaets- und Observability-Fakten; aktueller Stateful-Session-/RunnerPool-Vertrag verstanden. |
| Relevante Tests/Gates | `npm run check:docs`; bei Doku-Links `git diff --check`. Codegates nur bei begleitenden Codeaenderungen. |
| Abbruchkriterien | Es gibt keine belegbare Betriebsanforderung fuer HA oder die Entscheidung wuerde Stateful-WebSocket-/Docker-Pool-Realitaet ignorieren. |
| Commit-Grenze | Eine ADR plus minimale Verweise in Architektur/Admin-Doku. |
| Empfohlene Commit-Message | `docs(phase-4): record deployment and ha decision` |

### Teilstep P4-07 — REST-/WebSocket-/iframe-Versionierung und Deprecation-Policy definieren

| Feld | Inhalt |
| --- | --- |
| Ziel | Eine konsistente Versionierungs- und Deprecation-Policy fuer `/api/status`, WebSocket-Nachrichten und iframe-postMessage-API definieren. |
| Betroffene Dateien/Dokumente | `docs/EXTERNAL_API.md`, `docs/ARCHITECTURE.md`, `client/src/types/external-api.ts`, `shared/schema.ts`, `server/routes/status.routes.ts`, WebSocket-Schema-/Client-Handler-Tests. |
| Notwendige Code-/Infra-/Testaenderungen | Zunaechst Policy und Testmatrix. Implementierung versionierter Endpunkte/Handshake nur nach separater Freigabe. |
| Voraussetzungen | P4-01 abgeschlossen; Phase-3.3-Deferred-Liste liegt vor; externe Consumer-Inventur gestartet. |
| Relevante Tests/Gates | API-Doku-Check, Typecheck, WS-Schema-Tests, External-API-/Hook-Tests, E2E-Smoke fuer iframe/Start/Status. |
| Abbruchkriterien | Policy setzt Entfernungstermine ohne Consumer-Nachweis oder widerspricht der aktuellen API-Version `1.4.0`. |
| Commit-Grenze | Policy-Dokumentation separat; Schema-/Codeaenderungen spaeter einzeln. |
| Empfohlene Commit-Message | `docs(phase-4): define api and websocket versioning policy` |

### Teilstep P4-08 — Major-Release-/Sunset-Readiness fuer Phase-3.3-Flaechen herstellen

| Feld | Inhalt |
| --- | --- |
| Ziel | Fuer alle Phase-3.3-Deferred-/Sunset-Kandidaten dokumentieren, welche Nachweise vor Entfernung erforderlich sind. |
| Betroffene Dateien/Dokumente | `docs/phase-3.3-deprecation-legacy-plan.md`, `docs/phase-3.3-implementation-report.md`, `docs/EXTERNAL_API.md`, `README_ADMIN.md`, `server/routes/status.routes.ts`, `server/routes/simulation.ws.ts`, `shared/schema.ts`, `client/src/types/external-api.ts`, `server/config.ts`. |
| Notwendige Code-/Infra-/Testaenderungen | Consumer-Inventur, Migrationshinweise, ggf. Deprecation-Telemetrie. Keine Entfernung von Aliassen in diesem Teilstep. |
| Voraussetzungen | P4-07 abgeschlossen; externe/iframe/monitoring Consumer bewertet oder explizit als unbekannt markiert. |
| Relevante Tests/Gates | Alte und neue Pfade parallel testen: Status-Aliasse, `start_simulation` mit/ohne `code`, I/O-Registry modern/legacy, historische Statuswerte, `FORCE_DOCKER`. |
| Abbruchkriterien | Ein unterstuetzter Consumer nutzt noch ausschliesslich Legacy-Felder oder ein Sunset-Datum waere reine Annahme. |
| Commit-Grenze | Readiness-/Consumer-Matrix separat; jede spaetere Entfernung eigener Major-Release-Commit. |
| Empfohlene Commit-Message | `docs(phase-4): prepare legacy surfaces for major release sunset` |

### Teilstep P4-09 — Phase-2-Deferred-Konfiguration als Release-Risiko bewerten

| Feld | Inhalt |
| --- | --- |
| Ziel | Offene Phase-2.7-Punkte zu Compile-Timeout, Gatekeeper-Disable, LocalCompiler-Timeout und Worker-Cache als Release-Risiko oder separate Refactoring-Folgephase klassifizieren. |
| Betroffene Dateien/Dokumente | `docs/archive/plans/phase-2-deferred.md`, `docs/phase-2.7-configuration-centralization-plan.md`, `server/config.ts`, `server/services/compiler/cli-runner.ts`, `server/services/local-compiler.ts`, `server/services/workers/compile-worker.ts`, `server/services/workers/compile-worker-utils.ts`. |
| Notwendige Code-/Infra-/Testaenderungen | Zunaechst Analyse/Doku. Code nur, wenn ein Punkt als Release-blockierend klassifiziert wird und separat freigegeben ist. |
| Voraussetzungen | P4-01 und P4-04 abgeschlossen; aktuelle Config- und Testrealitaet geprueft. |
| Relevante Tests/Gates | `npm run check`, relevante Config-/Compiler-/Worker-Tests, `npm run test:integration`, bei Cache-/Worker-Aenderungen `npm run test:docker`. |
| Abbruchkriterien | Semantik von Timeouts, Cache-Pfaden oder Worker-Signalen ist nicht eindeutig belegbar. |
| Commit-Grenze | Eine Entscheidungsmatrix; Code-Fixes nur in separaten Folgecommits. |
| Empfohlene Commit-Message | `docs(phase-4): classify deferred configuration release risks` |

### Teilstep P4-10 — Abschluss-Doku und Release-Readiness-Review

| Feld | Inhalt |
| --- | --- |
| Ziel | Phase 4 formal abschliessen: erledigte Punkte, offene Folgeentscheidungen, Gate-Ergebnisse, Release-/No-Release-Entscheidung und Major-Release-Kandidaten dokumentieren. |
| Betroffene Dateien/Dokumente | Dieser Plan, `docs/README.md`, `README.md`, `README_ADMIN.md`, `README_SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/SCALABILITY_100_STUDENTS.md`, neue Phase-4-Artefakte. |
| Notwendige Code-/Infra-/Testaenderungen | Dokumentationskonsolidierung; keine neuen Produktivfeatures. |
| Voraussetzungen | P4-01 bis P4-09 entweder abgeschlossen oder begruendet deferred. |
| Relevante Tests/Gates | `npm run check:docs`, `git diff --check`, `npm run check`, `./run-tests.sh`, SonarQube Quality Gate; bei reiner Doku-Aenderung mindestens Docs-Check und SonarQube-Changed-File-Analyse. |
| Abbruchkriterien | Ein Completion-Kriterium ist nicht belegbar, Gate-Ergebnisse fehlen oder offene Risiken werden als erledigt dargestellt. |
| Commit-Grenze | Nur Abschlussbericht/-Doku und Index-Updates. |
| Empfohlene Commit-Message | `docs(phase-4): complete release readiness review` |

---

## Standard-Gates

### Dokumentations-Teilsteps

- `npm run check:docs`
- `git diff --check`
- SonarQube-Analyse der geaenderten Dateien, soweit SonarQube fuer IDE verfuegbar ist
- Keine Produktivcode-Aenderungen im selben Commit

### Code-/Test-/Infra-Teilsteps

Minimal:

- `npm run check`
- relevante gezielte Unit-/Integrationstests
- `npm run check:docs`, wenn Dokumentation betroffen ist

Bei Sandbox-, Security-, WebSocket-, Release- oder API-Aenderungen zusaetzlich:

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:docker`, wenn Docker/Sandbox betroffen ist
- `npm run test:e2e`, wenn Browser-/Flow-/iframe-Verhalten betroffen ist
- `npm run build`
- `./run-tests.sh` vor Merge/Release
- SonarQube Quality Gate fuer `unosim`

### Last-/Heavy-Gates

- Lasttests sind separate, explizite Gates und gehoeren nicht in die schnelle Standard-Feedbackschleife.
- `RUN_HEAVY_TESTS=1 ./run-tests.sh` ist fuer produktionsnahe Sandbox-/Isolationsevidenz vorgesehen.
- `npm run test:load:50`, `npm run test:load:100`, `npm run test:load:200` sind nur aussagekraeftig mit dokumentiertem Hostprofil und Messartefakten.
- Playwright-Scalability mit `playwright.scalability.config.ts` laeuft gegen einen bereits gestarteten Docker-Stack und darf nicht parallel zu anderen Docker-Lasten bewertet werden.

---

## Deferred-/Major-Release-Kandidaten

| Kandidat | Quelle | Phase-4-Ziel | Entfernung erlaubt wann? |
| --- | --- | --- | --- |
| `/api/status` Aliasse `pool`/`compile` | Phase 3.3 L-01 | Deprecation sichtbar, interne Consumer kanonisch, externe Consumer-Inventur. | Erst nach dokumentierter Major-Version, Migrationshinweis und Paralleltest alt/neu. |
| `start_simulation` ohne `code` via `lastCompiledCode` | Phase 3.3 L-02 | E2E-/External-Control-Flows auf code-pro-Session absichern; Race-/Multi-Client-Nachweis. | Erst wenn alle unterstuetzten Clients `code` senden und alter Pfad versioniert/sunset ist. |
| I/O-Registry Legacy-Felder `pinMode`, `definedAt`, `usedAt` | Phase 3.3 L-03 | Moderne Felder als alleinige Consumer-Quelle nachweisen; Fallback-Nutzung erfassen. | Erst nach Consumer-Inventur und Fallback-freier UI/Telemetry/Testmatrix. |
| `removeComments()` alias | Phase 3.3 L-05 | Als interner Parser-Sunset-Kandidat erneut pruefen. | Erst wenn kein Import/externes Paket den Alias nutzt und Parser-Tests gruen sind. |
| `FORCE_DOCKER` | Phase 3.3 L-06 | Environment-Sunset-Policy und Admin-Migration dokumentieren. | Erst nach Betriebsfreigabe; `UNOSIM_SIMULATION_MODE` bleibt kanonisch. |
| Historische Statuswerte `STOPPED`/`QUEUED` | Phase 3.3 C-06 | API-Versionierung/Negotiation definieren. | Erst nach externer API-Sunset-Policy und Kompatibilitaetstests. |
| Serial-/Telemetry optionale Felder | Phase 3.3 C-07 | Telemetrievertrag beobachten und dokumentieren. | Nur mit externer Consumer-Inventur; aktuell keep. |
| Phase-2.7 Deferred Config | Phase-2-Deferred-Index | Als Release-Risiko klassifizieren. | Nicht automatisch Major-Release; separate Refactoring-Entscheidung. |

---

## Completion Criteria

Phase 4 gilt nur dann als formal abgeschlossen, wenn alle folgenden Punkte belegbar sind:

1. Ein Release-Gate-Runbook ist dokumentiert und verweist auf reale, ausfuehrbare Commands.
2. Last-/Scalability-Gates sind als separate Profile mit Hostvoraussetzungen, Messwerten und Pass/Fail-Kriterien beschrieben.
3. Sandbox-/Security-Gates decken die dokumentierten Produktionsmindestanforderungen und Restrisiken ab oder nennen begruendete Luecken.
4. Observability/Monitoring benennt konkrete Metriken, Quellen, Schwellwerte und Betreiberreaktionen.
5. Das Deployment-/HA-Modell ist per ADR oder gleichwertigem Entscheidungsdokument geklaert.
6. API-/WebSocket-/iframe-Versionierung und Deprecation-Policy sind dokumentiert.
7. Alle Phase-3.3-Deferred-/Sunset-Punkte haben eine Major-Release-Readiness-Entscheidung mit Entfernungsvoraussetzungen.
8. Phase-2-Deferred-Konfigurationspunkte sind als release-blockierend, nicht-blockierend oder Folgephase klassifiziert.
9. Abgeschlossene Arbeiten werden nicht erneut als offen gefuehrt; offene Risiken bleiben sichtbar.
10. `npm run check:docs` ist gruen; bei Code-/Infra-/Testaenderungen sind die jeweils definierten Standard-Gates gruen.
11. SonarQube-Analyse der geaenderten Dateien ist erfolgt; vor einem echten Release ist das SonarQube Quality Gate fuer `unosim` gruen.
12. Ein abschliessender Phase-4-Report dokumentiert Gate-Ergebnisse, offene Folgearbeiten und die Release-/No-Release-Empfehlung.

---

## Aktuelle Einordnung

Auf Basis der bestehenden Dokumente ist Phase 4 keine Feature- oder Produktivcode-Migrationsphase, sondern eine Betriebsreifephase. Der naechste sinnvolle Umsetzungsschritt ist P4-01. Ein Major Release `v2.0.0` ist aktuell nicht als Ziel gesetzt; Phase 4 schafft lediglich die Voraussetzungen, um eine solche Entscheidung spaeter belastbar treffen zu koennen.
