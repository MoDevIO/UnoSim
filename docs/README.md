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

## SSOT

Die Dateien unter [`../ssot/`](../ssot/) enthalten thematische Single Sources of Truth. Sie ergänzen die aktuellen `docs/`-Dokumente, ersetzen aber keine ADRs, keine externen API-Verträge und keine Test-Gates.

| Dokument | Zielrolle | Zweck |
| --- | --- | --- |
| [`ssot_agent_policy.md`](../ssot/ssot_agent_policy.md) | `agent-governance` | Projektspezifische Agenten-Workflow- und Evidence-Regeln. |
| [`ssot_io-registry.md`](../ssot/ssot_io-registry.md) | `feature-contract` | Fachlicher Vertrag der Hybrid-I/O-Registry. |
| [`ssot_function_definition_OutputPanel.md`](../ssot/ssot_function_definition_OutputPanel.md) | `feature-contract` | OutputPanel-Autoverhalten und Panel-Regeln. |
| [`ssot_function_definition_PauseResume.md`](../ssot/ssot_function_definition_PauseResume.md) | `feature-contract` | Pause/Resume-Verhalten der Simulation. |
| [`ssot_function_description_serial_output.md`](../ssot/ssot_function_description_serial_output.md) | `feature-contract` | Serial-Output-Verhalten und Batching. |
| [`ssot_function_definition_Typography.md`](../ssot/ssot_function_definition_Typography.md) | `ui-design-contract` | Globale Schriftgrößensteuerung. |
| [`ssot_function_description_Buttons.md`](../ssot/ssot_function_description_Buttons.md) | `ui-design-contract` | Zentrale Button-Komponente. |
| [`ssot_function_description_scalability.md`](../ssot/ssot_function_description_scalability.md) | `capacity-planning` | Skalierungsbeschreibung; Merge-/Archiv-Kandidat zugunsten `SCALABILITY_100_STUDENTS.md`. |

## Planning

| Dokument | Zweck |
| --- | --- |
| [`PROJECT_ANALYSIS_REPORT_2026-09-04.md`](PROJECT_ANALYSIS_REPORT_2026-09-04.md) | Aktuelle Projektanalyse und priorisierte Maßnahmen. |
| [`SCALABILITY_100_STUDENTS.md`](SCALABILITY_100_STUDENTS.md) | Skalierbarkeitsanalyse und Mess-/Zielszenarien. |
| [`phase-3.2-ssot-governance-plan.md`](phase-3.2-ssot-governance-plan.md) | Verbindlicher Umsetzungsplan für SSOT-Struktur und Architektur-Governance. |

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
- Neue oder geänderte SSOT-Dokumente sollten zusätzlich eine `Zielrolle` ausweisen.
- Historische Reports und erledigte Umsetzungszusammenfassungen gehören ins Archiv.
- Detailverträge sollen nicht dupliziert werden: Architektur verweist auf ADRs/API/SSOTs, Feature-SSOTs verweisen auf ADRs und API-Dokumente.
- Interne Links und referenzierte npm-Skripte werden mit `npm run check:docs` geprüft.
