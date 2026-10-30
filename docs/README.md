# UnoSim-Dokumentation

Die hier verlinkten Dokumente beschreiben die unterstützte aktuelle
Architektur. Weitere Dateien in diesem Verzeichnis sind als historisch oder
nicht normativ gekennzeichnet (Kopfzeile); sie dokumentieren Analysen, Pläne
und Messläufe, keinen Vertrag.

## Nutzung

- [USER_GUIDE.md](USER_GUIDE.md) – UnoSim im Browser bedienen: Sketches,
  Simulation, Beispiele und Tutor.
- [UnoSim-Examples](https://github.com/ttbombadil/UnoSim-Examples#course-content-and-tutor-authoring)
  – eigene Beispiele und Tutor-Inhalte erstellen.

## Installation und Betrieb

Für einen ersten Klassenraum-Aufbau ist
[INSTALL_UBUNTU_VBOX.md](INSTALL_UBUNTU_VBOX.md) der kürzeste Weg; für einen
eigenen Reverse Proxy gilt [INSTALL_SERVER.md](INSTALL_SERVER.md).


- [INSTALL_LOCAL.md](INSTALL_LOCAL.md) – lokale Entwicklung mit lokaler
  Kompilierung und Simulation.
- [INSTALL_SERVER.md](INSTALL_SERVER.md) – Docker-Deployment mit erforderlichem
  Gateway, optionaler Benutzeranmeldung und Docker-Sandboxen.
- [INSTALL_UBUNTU_VBOX.md](INSTALL_UBUNTU_VBOX.md) – Ubuntu-Desktop-Setup in VirtualBox
  mit Docker, Nginx, TLS und optionaler Benutzeranmeldung.
- [SECURITY.md](SECURITY.md) – Sicherheits- und Isolationsvertrag.
- [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) – Release-Gates und Betriebskontrollen.

## Architektur, APIs und Tests

- [ARCHITECTURE.md](ARCHITECTURE.md) – Komponenten, Datenflüsse und die beiden
  Runtime-Profile.
- [EXTERNAL_API.md](EXTERNAL_API.md) – versionierter iframe-/postMessage-Vertrag.
- [TESTING_STANDARDS.md](TESTING_STANDARDS.md) – Testklassen und Qualitätsgates.

## Kapazität

- [CAPACITY_MODEL.md](CAPACITY_MODEL.md) – maßgebliches
  Kapazitätsmodell, Timeout-Grenzen und Kalibrierung.
- [CAPACITY_VALIDATION_QUICKSTART.md](CAPACITY_VALIDATION_QUICKSTART.md) –
  Ablauf der Validierung auf dem Staging-Host.
- [CAPACITY_MIXED_LOAD_TESTING.md](CAPACITY_MIXED_LOAD_TESTING.md) – gemischte
  Messung aus REST-Compiles, Simulationsstarts und laufenden Simulationen.
- [CAPACITY_TEST_RESULTS.md](CAPACITY_TEST_RESULTS.md) – gemessene
  Referenzergebnisse.
- [CAPACITY_HISTORICAL_PHASE_3_4.md](CAPACITY_HISTORICAL_PHASE_3_4.md) –
  historische Kapazitätsmessung aus Phase 3.4 (nicht normativ).

## Entscheidungen und Fachverträge

- [adr/](adr/) – akzeptierte Architekturentscheidungen. Als Entwurf
  (`Proposed`) liegen dort
  [ADR 0009](adr/0009-browser-emulation-runtime.md) (Browser-Emulation als
  Laufzeit) und [ADR 0010](adr/0010-compile-sandbox-and-flash-artifact.md)
  (Compile-Sandbox und Flash-Abbild); sie gelten erst nach ihrer Annahme.
- [../ssot/](../ssot/) – fachliche Single Sources of Truth für UI und Verhalten,
  für die Browser-Emulation vor allem
  [Boards](../ssot/ssot_function_definition_Boards.md) (Katalog, Pinbelegung,
  Freigabestatus) und
  [SimulationRuntime](../ssot/ssot_function_definition_SimulationRuntime.md)
  (Laufzeit-Schnittstelle, Worker-Protokoll, Zeit- und Speichermodell).
- [../packages/avr-emulator/README.md](../packages/avr-emulator/README.md) –
  API, Boards, Korrekturen an avr8js und Grenzen des Emulationskerns.
- [Bibliotheksverwaltung](../ssot/ssot_function_definition_Libraries.md) –
  Fachvertrag für den kuratierten Katalog, projektbezogene Versionen, AUnit und
  vier Pakete ohne zusätzliche Hardware; erste Ausbaustufe umgesetzt.

Bei Änderungen zuerst die zuständige normative Quelle aktualisieren.

## Offene Punkte (nicht normativ)

- [OPEN_POINTS.md](OPEN_POINTS.md) – geprüfte offene Entscheidungen und
  zurückgestellte Punkte.

## Laufende Umsetzung (nicht normativ)

- [proposals/browser-emulation-plan.md](proposals/browser-emulation-plan.md) –
  Umsetzungsplan Browser-Emulation, mit
  [Vorschlag](proposals/browser-emulation.md) und
  [Umsetzungsstand](proposals/browser-emulation-status.md); wird nach Abschluss
  gelöscht. Was nur ein Mensch erledigen kann, steht mit Anleitung in
  [proposals/human-tests.md](proposals/human-tests.md).

## Archiv

- [archive/refactoring/](archive/refactoring/) – Architektur- und
  Gesundheitsbericht (Stand `54cc2950`) und die daraus abgeleitete,
  abgeschlossene Refactoring-Serie.
- [archive/tutor-quality/](archive/tutor-quality/) – abgeschlossene Pläne und
  Messberichte zur Tutor-Qualität. Normativ bleibt
  [../ssot/ssot_function_definition_TutorQualityEvaluation.md](../ssot/ssot_function_definition_TutorQualityEvaluation.md).

Erledigte Implementierungspläne werden gelöscht, nicht archiviert; sie bleiben
in der Git-Historie.

## Namenskonvention

Dateien im Wurzelverzeichnis heißen `THEMA_INHALT.md` in Großbuchstaben. Das
Präfix gruppiert zusammengehörige Dokumente (`INSTALL_`, `CAPACITY_`). ADRs
liegen unter `adr/` als `NNNN-titel.md`. Fachliche SSOTs unter `../ssot/`
heißen `ssot_function_definition_<Thema>.md` mit `<Thema>` in PascalCase;
nur die Agenten-Policy heißt `ssot_agent_policy.md`.
