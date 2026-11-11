# Tutor Debug and Graphics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Completed steps use checkbox (`- [x]`) syntax for tracking.

**Status:** Implemented and verified on 2026-11-11; local uncommitted changes on `feature/tutor-debug-graphics`.

**Goal:** Make Tutor graphic processing observable through safe, bounded diagnostics in the existing Debug tab, and repair the reproduced renderer defects.

**Architecture:** Shared Mermaid rules and a strict diagnostic schema define the boundaries. A request-scoped server collector follows Provider/Service decisions and decorates responses outside the Support replay cache. A client diagnostic transport records HTTP and display stages and feeds the existing Debug store; rendering stays local and Debug shows text only.

**Tech Stack:** TypeScript, Zod, AsyncLocalStorage, Express, React, Vitest, Playwright; existing SVG renderer, no new dependencies.

**Spec:** [Tutor diagnosis and graphics design](../specs/2026-11-11-tutor-debug-graphics-design.md).

## Global Constraints

- No credentials, headers, dialog/code text, raw provider errors, Mermaid/SVG or their hashes in diagnostic events.
- Debug events remain in browser RAM/request-scoped server RAM. Maximum 500 messages; 64 server events, 32 KiB per envelope, 2 KiB per event. Retain terminal/truncation information.
- `UNOSIM_TUTOR_DIAGNOSTICS_ENABLED`: development default on, production/test default off; authenticated access still required.
- No extra model-list or generation calls for diagnostics; separate requested/returned model IDs, allowlisted against the current request's model list.
- Existing tests are preserved. New regression suites may be added; no push, merge or publish. Keep product work on `feature/tutor-debug-graphics` in the current checkout to preserve the IDE context.
- Preserve Tutor entries on Compile/Upload, clear all on manual Clear. Shared filtering/export, accessible details, English Debug labels, existing style tokens.
- Graphics first; supplemental Tutor analysis capped at 60 minutes including its report after diagnostic integration. Required implementation verification is outside that cap.

## Review Focus

- A malicious provider places credential/dialog sentinels in optional fields/model names/errors: none reaches diagnostics or the flushed development logger (Tasks 1–3).
- A cached Support response is replayed under a different request ID: no cached diagnostics and no fictitious model call (Task 3).
- A valid learning response has malformed diagnostics: learning content still parses, only a fixed diagnostic error is shown (Task 4).
- A question is held behind Continue or replaced by planning/context change: graphics stay associated with the actually shown question (Tasks 3–4).
- Buffer/view truncation and a Compile/Upload while Tutor traces exist: retention/export counts remain honest (Tasks 2, 5).

## File responsibilities

- `shared/tutor-mermaid-rules.ts`: shared size/header/security checks and fixed rejection codes.
- `client/src/lib/tutor-mermaid.ts`: supported grammar, safe SVG layout, structured render result plus compatible `renderMermaidSubset` wrapper.
- `shared/tutor-diagnostics.ts`: strict event/envelope schema and bounds, fixed stage/outcome/reason vocabulary.
- `server/services/tutor/tutor-diagnostics.ts`: AsyncLocalStorage collector and fixed metadata reporting; no shared per-user mutable instance state.
- `server/routes/tutor-diagnostics.ts`: opt-in middleware and response decoration outside replay storage.
- `client/src/lib/tutor-diagnostics.ts`: HTTP envelope extraction, validated local events, per-response display context and browser event bridge.
- `client/src/lib/debug-messages.ts`: shared filter, safe export and Tutor-preserving automatic reset.
- `client/src/components/features/debug-output.tsx`: focused Debug controls/views extracted from the existing output panel as needed.
- Existing Tutor Provider/Service/routes/hook/learning view: instrumentation at actual decisions, without changing the learning protocol.
- Existing Debug hook/output wiring/configuration: consume optional category/details and expose diagnostic availability.
- `docs/proposals/report-tutor-debug-graphics.md`: evidence, capability matrix, supplemental analysis and limits.

### Task 1: Repair supported graphics and remove raw logging

**Files:** Create `shared/tutor-mermaid-rules.ts`; modify renderer, Tutor service and Provider; add `tests/client/tutor-mermaid-regressions.test.ts`, `tests/server/services/tutor/tutor-mermaid-safety.test.ts`, `tests/server/services/tutor/provider-diagnostic-safety.test.ts`.

**Interfaces:** `checkTutorMermaid(source: string): TutorMermaidRejection | null`, `renderMermaidDiagram(source: string, markerId: string): {svg: string; status: "rendered"} | {status: "rejected"; reason: TutorMermaidRejection}`. Keep `renderMermaidSubset(source, markerId): string | null` compatible.

- [x] Write regressions for two edges in `A --> B --> C`, state transition text, `A -- ja --> B`, allowed `click` label with forbidden actual click command, comparison text versus real markup, and explicit rejection of dotted/unknown syntax; verify escaped SVG and reverse directions.
- [x] Run new suites and observe failures against current production behavior.
- [x] Implement shared rules and complete consumption of supported grammar; preserve safe text fallback. Remove raw Provider content logging, including failure flush behavior.
- [x] Run new and existing Mermaid/Provider/Service suites; run type checks.
- [x] Record completed evidence in the ledger; no changes to existing test expectations.

### Task 2: Define bounded events and Debug data primitives

**Files:** Create shared diagnostic contract and client Debug primitives; add `tests/shared/tutor-diagnostics.test.ts` and `tests/client/lib/debug-messages.test.ts`.

**Interfaces:** `TutorDiagnosticEvent`, `TutorDiagnosticEnvelope`, `tutorDiagnosticEnvelopeSchema`; `DebugMessage.category?: "tutor"`, `DebugMessage.details?: TutorDiagnosticEvent`; `filterDebugMessages(messages, filter)`, `formatDebugMessages(messages)`, `retainTutorDebugMessages(messages)`.

- [x] Write tests rejecting extra/raw fields, unknown enums, oversized arrays/strings/envelopes, and inconsistent IDs; assert shared filtering/export and Tutor-only automatic retention.
- [x] Observe RED, implement strict allowlists and limits, observe GREEN.
- [x] Include terminal/truncation tests with literal 64/32768/2048 limits and no sentinel disclosure.

### Task 3: Instrument request-scoped server decisions

**Files:** Create server collector/middleware; modify `server/config.ts`, Tutor routes/support routes, Provider/Service; update Tutor SSOT before product changes. Add new collector/HTTP/config regression suites.

**Interfaces:** `withTutorDiagnostics(context, operation)`, `reportTutorDiagnostic(eventData)`, `reportTutorModelList(models)`, `reportTutorModel(requested, returned)`. Middleware handles `/api/tutor/*`, accepts validated trace/request headers and appends optional `diagnostics` to a new response object; cached bodies are untouched.

- [x] Write tests for dev/prod/test defaults, explicit server override, no header versus header, success/error envelopes, concurrent callers and malicious model/error metadata.
- [x] Observe RED, implement configuration and opt-in middleware, collector bounds, server model allowlisting and Provider parse/security graphic reports.
- [x] Instrument final graphic retention/replacement/support discard; expose availability through existing safe config. Preserve no-store and no extra model calls.
- [x] Add HTTP tests for real route errors, disabled diagnosis, Support replay isolation and unchanged normal responses. Observe GREEN.

### Task 4: Connect browser HTTP and graphic lifecycles

**Files:** Create client diagnostic helper; modify Tutor hook, support parsing, Mermaid preview and application wiring. Add new hook/view regression suites.

**Interfaces:** Diagnostic transport removes/validates envelopes independently before existing strict learning schemas; fixed browser events use the same contract. Graphic display context is associated with each received response outside persisted dialog history. Bridge validated events to the Debug hook through a browser-local event/callback.

- [x] Write tests for malformed envelope with valid learning content, debug off/on, stable logical trace on retry with fresh request IDs, and no diagnostic data in dialog history/storage.
- [x] Observe RED, implement HTTP/local lifecycle events and end-to-end correlation without logging bodies or keys.
- [x] Test held-next/Continue, context change, Support skip, absent graphic, renderer rejection/import failure and DOM-confirmed render success; prevent duplicate React-effect reports.
- [x] Observe GREEN using actual view/renderer with controlled HTTP responses.

### Task 5: Extend the existing Debug tab

**Files:** Debug hook/primitives/output view, UI state copy wiring, Compile/Upload automatic clear; add `tests/client/tutor-debug-output.test.tsx` and retention integration tests.

**Interfaces:** Existing Debug props remain compatible; optional category/details filters and bounded search use Task 2 helpers. Clear remains global; Compile/Upload uses `retainTutorDebugMessages`.

- [x] Write failing tests for Tutor category/search/stage filters, accessible full details in both views, copy of all matching buffered events, correct 100/50 display versus export counts and preserved Tutor entries on Compile.
- [x] Implement within existing controls/status/style system. Display raw data only as text/JSON; never HTML/Mermaid or active links. Explain disabled server diagnostics with a fixed code.
- [x] Run targeted UI/compile suites and verify normal Debug traffic behavior.

### Task 6: Browser evidence and bounded capability analysis

**Files:** New `e2e/tutor-debug-graphics.spec.ts`, focused report; update design status/progress and relevant SSOT/User Guide configuration notes.

**Interfaces:** Controlled Provider responses exercise the actual HTTP/service/renderer path where practical; browser checks cover final SVG DOM and Debug export, not just SVG strings.

- [x] Verify flow/state/sequence paths, rejection and text fallback, malicious content isolation, held Continue lifecycle, narrow/XXL Debug accessibility and no additional network actions from displaying logs.
- [x] Record actual capabilities and remaining intentional limits. Spend at most 60 minutes on non-graphic Tutor analysis, state evidence and unchecked areas explicitly.
- [x] Run `npm run check`, relevant lint, `npm run check:docs`, app unit suite and required browser checks; report environmental blockers precisely.
- [x] Obtain one independent whole-change review, address material findings with regression tests, repeat affected checks.
- [x] Present final changes, evidence and limitations. No automatic publish/merge/push.

## Execution ledger

Progress and decisions live in this plan's ignored workspace at `.superpowers/sdd/2026-11-11-tutor-debug-graphics/progress.md`. The approved user request authorizes implementation; ordinary reversible implementation choices do not require renewed permission. Tasks execute natively in this session with one fresh final review.

## Final evidence

- App suite: 4,253 passed, one existing skip; emulator suite: 697 passed. Existing tracked test files are unchanged.
- Five controlled-provider browser cases passed, including flow/state/sequence SVG DOM, safe rejection, Continue, measured XXL scale `1.5` and keyboard details. Screenshots inspected.
- Type checks, full build, full lint and documentation checks passed. Initial JavaScript path: 744,826 bytes within the unchanged 745,000-byte budget.
- One independent whole-change review and follow-up completed; all three material findings were fixed with regressions.
- Supplemental analysis completed within 60 minutes; intentional limits and absence of a live-model frequency measurement are recorded in the [report](../../proposals/report-tutor-debug-graphics.md).
- No commit, push, merge or publication. The implementation is ready for local review.
