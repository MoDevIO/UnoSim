# UnoSim Dokumentation

Status: current

Dieser Einstiegspunkt trennt aktuelle, planende und archivierte Dokumente. Für das aktuelle Verhalten gelten die Root-READMEs, die aktiven Dokumente in `docs/`, die ADRs sowie der eingecheckte Quellcode und die Tests.

## Status-Klassen

- `Status: current` — aktuell gültige oder normative Dokumentation.
- `Status: planning` — aktive Analyse- oder Zielbild-Dokumente; nicht als Ist-Zustand missverstehen.
- `Status: completed` — abgeschlossene Pläne mit dokumentiertem Ist-Ergebnis.
- `Status: archived` — historische Dokumente, Reports oder Pläne; nur zur Nachvollziehbarkeit.

## Current

| Dokument | Zweck |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Architekturüberblick, Komponenten und Datenflüsse. |
| [`EXTERNAL_API.md`](EXTERNAL_API.md) | Normatives `postMessage`-Protokoll für iframe-Integrationen. |
| [`TESTING_STANDARDS.md`](TESTING_STANDARDS.md) | Testkonventionen, Timing-Toleranzen und Coverage-Ziele. |
| [`adr/0001-authentication-and-gateway-contract.md`](adr/0001-authentication-and-gateway-contract.md) | Akzeptierte Entscheidung zu Authentifizierung und Gateway-Vertrag. |
| [`adr/0002-unified-scroll-area.md`](adr/0002-unified-scroll-area.md) | Akzeptierte Entscheidung zu einheitlichen Scrollbereichen. |

## Planning

| Dokument | Zweck |
| --- | --- |
| [`PROJECT_ANALYSIS_REPORT_2026-09-04.md`](PROJECT_ANALYSIS_REPORT_2026-09-04.md) | Aktuelle Projektanalyse und priorisierte Maßnahmen. |
| [`SCALABILITY_100_STUDENTS.md`](SCALABILITY_100_STUDENTS.md) | Skalierbarkeitsanalyse und Mess-/Zielszenarien. |

## Completed

| Dokument | Zweck |
| --- | --- |
| [`archive/refactoring/phase-2.1-refactoring-plan.md`](archive/refactoring/phase-2.1-refactoring-plan.md) | Abgeschlossener Plan und Ist-Ergebnis der Hook-Zerlegung. |

## Archived

Historische Dokumente liegen unter [`archive/`](archive/). Sie sind nicht normativ.

| Dokument | Zweck |
| --- | --- |
| [`archive/plans/project-analysis-action-plan-2026-09-03.md`](archive/plans/project-analysis-action-plan-2026-09-03.md) | Historischer Projektanalyse- und Maßnahmenplan. |
| [`archive/reports/phase2-characterization-tests-summary-2026-09-04.md`](archive/reports/phase2-characterization-tests-summary-2026-09-04.md) | Historischer Umsetzungsbericht zu Phase-2.1-Characterization-Tests. |
| [`archive/reports/`](archive/reports/) | Frühere Performance-, Optimierungs- und Analyseberichte. |
| [`archive/plans/`](archive/plans/) | Historische oder supersedierte Planungsdokumente. |
| [`archive/legacy/`](archive/legacy/) | Alte Architektur- und Refactoring-Entwürfe. |

## Pflegehinweise

- Neue dauerhafte Dokumentation sollte einen expliziten Status erhalten.
- Historische Reports und erledigte Umsetzungszusammenfassungen gehören ins Archiv.
- Interne Links und referenzierte npm-Skripte werden mit `npm run check:docs` geprüft.
