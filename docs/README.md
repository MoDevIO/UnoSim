# UnoSim-Dokumentation

Die hier verlinkten Dokumente beschreiben die unterstützte aktuelle
Architektur. Weitere Dateien in diesem Verzeichnis sind als historisch oder
nicht normativ gekennzeichnet (Kopfzeile); sie dokumentieren Analysen, Pläne
und Messläufe, keinen Vertrag.

## Installation und Betrieb

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

- [adr/](adr/) – akzeptierte Architekturentscheidungen.
- [../ssot/](../ssot/) – fachliche Single Sources of Truth für UI und Verhalten.

Bei Änderungen zuerst die zuständige normative Quelle aktualisieren.

## Offene Punkte (nicht normativ)

- [OPEN_POINTS.md](OPEN_POINTS.md) – geprüfte offene Entscheidungen und
  zurückgestellte Punkte.

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
liegen unter `adr/` als `NNNN-titel.md`.
