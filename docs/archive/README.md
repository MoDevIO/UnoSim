# Documentation archive

This directory contains historical audits, reports and superseded design drafts.
They are retained for traceability and are not normative. Current behavior is
defined by the root README, `docs/SECURITY.md`, the active documents under
`docs/`, ADRs, SSOT contracts and the checked-in source/tests.

Some archived files still contain historical labels such as "current",
superseded file names such as `README_SECURITY.md`, or older capacity claims.
Those labels describe the status at the time of writing and must not be treated
as current contracts. For capacity and HA, use only `../SCALABILITY.md` and
`../adr/0003-scalability-and-ha-model.md` as current sources.

Archived legacy documents:

- `legacy/server-services-README-2026-01.md` — pre-refactoring service overview
- `legacy/ssot-refactoring-plan-initial-2026-01.md` — initial refactoring draft
- `plans/project-analysis-action-plan-2026-09-03.md` — historical project analysis and action plan
- `reports/phase2-characterization-tests-summary-2026-09-04.md` — historical implementation summary for Phase 2.1 characterization tests
- `reports/` — dated performance, optimization and implementation reports
- `plans/` — superseded or historical planning documents
- `reports/ssot-function-description-scalability.md` — archived scalability SSOT draft; current capacity planning lives in `../SCALABILITY.md`
- `plans/external-examples-plan.md` — historical implementation plan for the external examples service; current behavior is defined by the source, routes and active install/security docs

Archive governance:

- Active SSOT documents live under `../../ssot/` and are indexed from `../README.md`.
- Historical implementation notes, completed checklists and superseded roadmaps belong here, not in active SSOT contracts.
- When content is moved out of an active document, keep either a direct link or an archive index entry so traceability is preserved.
- Archived documents are retained for context and must not be used as current behavior contracts unless an active document explicitly references them.
