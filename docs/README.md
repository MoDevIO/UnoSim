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
- [../README_UbuntuServer.md](../README_UbuntuServer.md) – Ubuntu-Desktop-Setup
  mit Docker, Nginx, TLS und optionaler Benutzeranmeldung.
- [SECURITY.md](SECURITY.md) – Sicherheits- und Isolationsvertrag.
- [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) – Release-Gates und Betriebskontrollen.

## Architektur, APIs und Tests

- [ARCHITECTURE.md](ARCHITECTURE.md) – Komponenten, Datenflüsse und die beiden
  Runtime-Profile.
- [EXTERNAL_API.md](EXTERNAL_API.md) – versionierter iframe-/postMessage-Vertrag.
- [TESTING_STANDARDS.md](TESTING_STANDARDS.md) – Testklassen und Qualitätsgates.
- [SCALABILITY.md](SCALABILITY.md) – historische Kapazitätsmessung; aktuelle
  Werte und Kalibrierung in [CAPACITY_VALIDATION_PLAN.md](CAPACITY_VALIDATION_PLAN.md).

## Entscheidungen und Fachverträge

- [adr/](adr/) – akzeptierte Architekturentscheidungen.
- [../ssot/](../ssot/) – fachliche Single Sources of Truth für UI und Verhalten.

Bei Änderungen zuerst die zuständige normative Quelle aktualisieren.

## Analysen und Arbeitsstand (nicht normativ)

- [UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md](UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md)
  – Architektur- und Gesundheitsbericht (Stand `54cc2950`).
- [UNOSIM_REFACTORING_OPL.md](UNOSIM_REFACTORING_OPL.md) – Ergebnis der daraus
  abgeleiteten Refactoring-Serie und offene Entscheidungen.
