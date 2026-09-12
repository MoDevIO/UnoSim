# UnoSim-Dokumentation

Zentraler Einstieg in die aktuelle normative Dokumentation. Historische Pläne, Reports und Analysen liegen ausschließlich unter [archive/](archive/).

## Installation

- [INSTALL_LOCAL.md](INSTALL_LOCAL.md) – lokale Entwicklung und Einzelplatzbetrieb.
- [INSTALL_SERVER.md](INSTALL_SERVER.md) – Hochschulserver, Lehrbetrieb und Mehrbenutzerbetrieb.

## Betrieb und Architektur

- [ARCHITECTURE.md](ARCHITECTURE.md) – Komponenten, Datenflüsse und Observability.
- [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) – Gates, Update, Health und Rollback.
- [SECURITY.md](SECURITY.md) – Sicherheitsmodell und Sandbox-Vertrag.
- [EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md](EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md) – Implementierungs- und Betriebsvertrag für die browser-spezifische Examples-Auswahl.

## APIs, Tests und Kapazität

- [EXTERNAL_API.md](EXTERNAL_API.md) – versionierter iframe-/postMessage-Vertrag.
- [TESTING_STANDARDS.md](TESTING_STANDARDS.md) – Testklassen und Qualitätsgates.
- [SCALABILITY.md](SCALABILITY.md) – gemessene Kapazitätsgrenzen.

## Entscheidungen und Fachverträge

- [adr/](adr/) – akzeptierte Architekturentscheidungen.
- [../ssot/](../ssot/) – fachliche Single Sources of Truth für UI und Verhalten.
- [../ssot/ssot_function_definition_ExternalExamples.md](../ssot/ssot_function_definition_ExternalExamples.md) – normativer Vertrag für browser-spezifische External-Examples-Auswahl per Repository und Ref.

## Archiv

[archive/](archive/) enthält abgeschlossene Phasen, historische Analysen, Reports und supersedierte Pläne. Diese Dateien sind nicht normativ.

Bei Änderungen zuerst die zuständige normative Quelle aktualisieren. Historische Evidenz wird archiviert, nicht überschrieben.
