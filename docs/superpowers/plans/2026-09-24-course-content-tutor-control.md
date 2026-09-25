# Course Content Tutor Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Stage-A unified Course Content contract so one immutable repository/ref snapshot controls Examples and the optional repository Tutor capability, with capability-scoped validation, effective strategy selection, topic binding, and server-authoritative session pinning.

**Architecture:** Extend the existing Examples revision loader and cache into the sole Course Content loader. The loader always validates the Examples core independently, then attempts the optional Tutor capability as an all-or-nothing bundle; Tutor planning consumes an immutable snapshot context and falls back to the existing free Tutor path plus the normative built-in strategy. Browser metadata is request context only; the server derives the active revision from the existing source-selection/cache path and issues the session pin needed to keep follow-up dialogs on that revision.

**Tech Stack:** TypeScript, Zod, YAML, Express, React, Vitest, existing Examples source/revision cache, existing Tutor service/planner, npm scripts.

**Spec:** `ssot/ssot_function_definition_CourseContent.md`, `ssot/ssot_function_definition_LearningQuestions.md`, `ssot/ssot_function_definition_ExternalExamples.md`, `docs/adr/0006-unified-course-content-and-tutor-strategy.md`, `docs/adr/0004-repository-based-tutor-curriculum.md`, `docs/ARCHITECTURE.md`, approved in Stage-A commit `526c97c967bcf7695197ba175a1d86927ff15726`.

## Global Constraints

- Keep one repository/ref selection and one Course Content fetch stack for Examples and Tutor.
- Schema-v1 manifests remain Examples-only compatible; schema-v2 adds only the optional Tutor descriptor.
- Validate Examples core and Tutor capability separately; a Tutor-only failure preserves valid Examples and activates no partial Tutor bundle.
- Use the exact normative built-in strategy `built-in-default` with weights `recall 10`, `concept 25`, `application 35`, `prediction 15`, `transfer 15`.
- Preserve current LearningQuestions adaptive semantics: ratings `1:-6`, `2:-3`, `3:0`, `4:+2`, `5:+4`, current window/clamp/step limits.
- Strategy precedence is per-example, then repository default, then built-in; the built-in must use the same effective-strategy path.
- Topic precedence is applicable active-example primary topic, other bound topics, fact-matched repository topics, then free Tutor.
- Repository/ref/revision/example values from the browser are untrusted metadata; the server validates or derives immutable Course Content context.
- Tutor content is usable only from the active Course Content revision; no stale cross-revision substitution.
- No repository-controlled system prompt, no lecturer lock, no second Tutor source selector, no Capacity changes, and no Tutor Registry SSOT changes.
- Preserve API-key privacy, difficulty, dialog, and existing free-Tutor behavior.

## Review Focus

- A malformed Tutor descriptor, manifest, topic, strategy, hash, cross-reference, or per-example Tutor reference must not discard valid Examples or partially activate Tutor files. Test in Tasks 1, 4, and 5.
- A schema-v1 root with no Tutor descriptor must load unchanged and use free Tutor/built-in behavior. Test in Tasks 1 and 5.
- A browser-supplied revision that is valid-looking but not the server-resolved active revision must not select content or cross-pin a dialog. Test in Task 8.
- An external example moved from revision A to B must reset the dialog and never use A's Tutor content for B. Test in Tasks 7 and 8.
- The no-repository and no-topic paths must remain fully functional and must not leak credentials into Course Content metadata or prompts. Test in Tasks 5, 8, and 11.

---

### Task 1: Add capability-scoped Course Content schemas

**Files:**
- Create: `server/services/course-content/course-content-schema.ts`
- Modify: `server/services/examples/examples-schema.ts`
- Test: `tests/server/services/course-content/course-content-schema.test.ts`
- Test: `tests/server/services/examples/examples-schema.test.ts`

**Interfaces:**
- Consumes: existing `ManifestExample`, `ExamplesManifest`, `validateManifestReferences`.
- Produces: `courseContentManifestSchema`, `tutorDescriptorSchema`, `exampleTutorBindingSchema`, `courseContentTopicEntrySchema`, `courseContentStrategyEntrySchema`, and typed validation results that distinguish `examples` from `tutor` capability errors.

- [ ] **Step 1: Write the failing tests** for v1 compatibility, v2 optional Tutor descriptor, closed Tutor descriptor fields, per-example binding shape, and independent capability result.
- [ ] **Step 2: Run** `npx vitest run tests/server/services/course-content/course-content-schema.test.ts tests/server/services/examples/examples-schema.test.ts`; verify the new exports/tests fail before implementation.
- [ ] **Step 3: Implement** the strict v1/v2 root parsing and capability-scoped result. Keep existing Example field validation and reference validation unchanged for the Examples result. Permit only `tutor.manifest` at root and only `topics`, `primaryTopic`, and `strategy` in an Example Tutor binding.
- [ ] **Step 4: Run** the focused tests and the existing Examples service tests; verify v1 parses without Tutor and malformed Tutor data reports only Tutor invalidity.
- [ ] **Step 5: Commit** `feat: add course content manifest schemas`.

### Task 2: Add EffectiveTutorStrategy and the normative built-in

**Files:**
- Create: `server/services/tutor/strategy/effective-tutor-strategy.ts`
- Modify: `server/services/tutor/curriculum/curriculum-schema.ts`
- Modify: `shared/tutor.ts`
- Test: `tests/server/services/tutor/effective-tutor-strategy.test.ts`
- Test: `tests/shared/tutor.test.ts`

**Interfaces:**
- Consumes: Stage-A strategy contract and existing `TutorDifficulty`/`calculateNextTutorDifficulty` behavior.
- Produces: `effectiveTutorStrategySchema`, `BUILT_IN_TUTOR_STRATEGY`, `resolveEffectiveTutorStrategy(input)`, and typed strategy metadata for planner/service responses.

- [ ] **Step 1: Write failing tests** for the exact built-in values, strict strategy schema rejection of prompts/URLs/executable fields, precedence resolution, and unchanged adaptive deltas.
- [ ] **Step 2: Run** the focused tests and verify missing strategy exports fail.
- [ ] **Step 3: Implement** the closed strategy schema and resolver. Set `BUILT_IN_TUTOR_STRATEGY.id` to `built-in-default`, use weights 10/25/35/15/15, and encode the approved Socratic/scaffolding/progression values. Represent adaptive difficulty as `current-contract`; do not introduce a second delta implementation.
- [ ] **Step 4: Run** focused Tutor/shared tests and verify all current difficulty contract tests remain green.
- [ ] **Step 5: Commit** `feat: add effective tutor strategy policy`.

### Task 3: Generalize the Tutor curriculum to multiple topics

**Files:**
- Modify: `server/services/tutor/curriculum/curriculum-schema.ts`
- Modify: `server/services/tutor/curriculum/topic-matcher.ts`
- Modify: `server/services/tutor/curriculum/learning-planner.ts`
- Modify: `server/services/tutor/curriculum/sketch-facts.ts` only where shared fact types need to be exported without semantic changes
- Test: `tests/server/services/tutor/curriculum.test.ts`
- Test: `tests/server/services/tutor/learning-planner.test.ts`

**Interfaces:**
- Consumes: `EffectiveTutorStrategy` from Task 2 and current topic/planner contracts.
- Produces: generic topic IDs in manifest/topic schemas, validated multi-topic collections, deterministic topic matching, and planner selection that accepts a selected topic plus effective strategy without changing existing LearningQuestions difficulty semantics.

- [ ] **Step 1: Add failing tests** for two valid topic entries, duplicate topic IDs, unknown topic references, per-topic cross-reference errors, fact matching across multiple topics, and deterministic strategy-weighted question selection.
- [ ] **Step 2: Run** the focused curriculum tests and verify the current literal/single-topic implementation fails the new cases.
- [ ] **Step 3: Implement** generic topic IDs, manifest uniqueness, per-topic validation, and deterministic multi-topic selection. Apply strategy question-kind weights only as a tie-break/selection policy and preserve the existing difficulty distance and progression/remediation rules.
- [ ] **Step 4: Run** curriculum and planner tests, including existing pilot fixtures, and verify the existing `onRating` contract still maps 1–2/3/4/5 as documented.
- [ ] **Step 5: Commit** `feat: generalize tutor curriculum topics`.

### Task 4: Extend immutable Examples snapshots with optional Tutor capability

**Files:**
- Modify: `server/services/examples/http-provider.ts`
- Modify: `server/services/examples/examples-cache.ts`
- Modify: `server/services/examples/source-provider.ts`
- Create: `server/services/course-content/course-content-loader.ts`
- Test: `tests/server/services/examples/http-provider.test.ts`
- Test: `tests/server/services/examples/source-provider.test.ts`
- Test: `tests/server/services/course-content/course-content-loader.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 schemas and existing `RevisionProvider`, `ExamplesCache`, and source/ref resolution.
- Produces: `CourseContentSnapshot` carrying repository, immutable revision, Examples, optional validated Tutor capability/status, and content size; the existing Examples revision loader remains the only outbound fetch path.

- [ ] **Step 1: Write failing loader tests** for schema-v1, valid schema-v2, missing optional Tutor manifest, all Tutor files loaded from the same revision, and no extra source/fetch repository.
- [ ] **Step 2: Run** the focused loader/provider tests and verify the snapshot type/loader behavior is absent.
- [ ] **Step 3: Implement** the optional Tutor load under the immutable Examples base. Fetch the descriptor-referenced `tutor/manifest.yaml`, then only enumerated strategy/topic paths, verify SHA-256, enforce existing bounded fetch/concurrency/total limits, and return an all-or-nothing Tutor capability status while retaining valid Examples.
- [ ] **Step 4: Run** the loader/cache/source tests and verify revision cache entries carry one combined snapshot and retain source pinning/eviction behavior.
- [ ] **Step 5: Commit** `feat: load tutor capability with course snapshots`.

### Task 5: Implement capability-scoped Tutor validation and complete fallback

**Files:**
- Modify: `server/services/tutor/curriculum/content-repository.ts` or retire it from the production composition root after migrating its tests to the Course Content snapshot
- Modify: `server/services/tutor/curriculum-tutor-adapter.ts`
- Modify: `server/services/tutor/tutor-service-factory.ts`
- Modify: `server/services/tutor/tutor-service.ts`
- Test: `tests/server/services/tutor/curriculum.test.ts`
- Test: `tests/server/services/tutor/tutor-service.test.ts`
- Test: `tests/server/services/tutor/fallback-matrix.test.ts`

**Interfaces:**
- Consumes: `CourseContentSnapshot` from Task 4, `BUILT_IN_TUTOR_STRATEGY`, and the existing app-owned `TUTOR_SYSTEM_PROMPT`.
- Produces: adapter/service behavior implementing fallback matrix A–G: valid Examples survive Tutor-only invalidity; invalid/missing Tutor uses built-in plus free Tutor; no partial Tutor bundle activates; no repository content is required for free Tutor.

- [ ] **Step 1: Write failing matrix tests** for absent repository, schema-v1, valid Tutor, invalid descriptor, invalid manifest, invalid topic/strategy/reference/hash, no topic match, and valid Examples with Tutor capability rejected.
- [ ] **Step 2: Run** the fallback matrix tests and verify the current separate repository path cannot satisfy the matrix.
- [ ] **Step 3: Implement** the adapter against a supplied Course Content snapshot/context, returning `null` for unavailable/invalid Tutor capability and leaving the service’s free Tutor generation path intact. Keep system instructions app-owned; pass repository data as validated context only.
- [ ] **Step 4: Run** matrix, service, route, and existing offline/free Tutor tests; verify no credential or arbitrary browser revision is accepted by this layer.
- [ ] **Step 5: Commit** `feat: isolate tutor capability fallback`.

### Task 6: Apply strategy precedence through one effective-strategy path

**Files:**
- Modify: `server/services/tutor/curriculum-tutor-adapter.ts`
- Modify: `server/services/tutor/tutor-planning.ts`
- Modify: `server/services/tutor/curriculum/learning-planner.ts`
- Modify: `server/services/tutor/tutor-service.ts`
- Test: `tests/server/services/tutor/strategy-precedence.test.ts`
- Test: `tests/server/services/tutor/tutor-planning.test.ts`

**Interfaces:**
- Consumes: per-example binding, repository default strategy, built-in resolver, and existing plan metadata.
- Produces: plans with `strategyId`/strategy source from the resolved effective strategy; precedence exactly per-example → repository default → built-in for both repository and free Tutor paths.

- [ ] **Step 1: Write failing tests** for each precedence branch, invalid per-example reference fallback, repository strategy selection, and built-in free-Tutor strategy metadata.
- [ ] **Step 2: Run** the focused tests and verify current scaffold IDs are incorrectly reported as strategy IDs or no strategy is attached.
- [ ] **Step 3: Implement** strategy resolution before planning; preserve scaffold IDs separately from strategy IDs and use the same normalized object for planning and response metadata.
- [ ] **Step 4: Run** focused planning/service tests and verify adaptive difficulty is still calculated by the existing shared function.
- [ ] **Step 5: Commit** `feat: apply tutor strategy precedence`.

### Task 7: Implement example binding and topic-selection precedence

**Files:**
- Modify: `server/services/tutor/curriculum-tutor-adapter.ts`
- Modify: `server/services/tutor/curriculum/topic-matcher.ts`
- Modify: `server/services/examples/examples-repository.ts`
- Modify: `shared/examples.ts`
- Test: `tests/server/services/tutor/topic-precedence.test.ts`
- Test: `tests/server/services/examples/examples-repository.test.ts`

**Interfaces:**
- Consumes: current external example identity and validated snapshot metadata.
- Produces: topic selection in the exact order active example primary topic, other bound topics, fact matches, free path; catalog/detail metadata that identifies the same Course Content revision without exposing credentials.

- [ ] **Step 1: Write failing tests** for primary topic, bound-topic ordering, fact match fallback, no-match free Tutor, missing/invalid binding, and example detail/catalog revision consistency.
- [ ] **Step 2: Run** focused Examples/Tutor tests and verify current adapter always chooses the first topic.
- [ ] **Step 3: Implement** explicit binding selection and retain `DefaultTopicMatcher` only for the fact-match phase. Reject binding to absent topics as Tutor capability failure rather than activating a partial bundle.
- [ ] **Step 4: Run** focused tests and verify schema-v1 examples still select free Tutor.
- [ ] **Step 5: Commit** `feat: bind tutor topics to examples`.

### Task 8: Make revision and dialog context server-authoritative

**Files:**
- Modify: `shared/tutor.ts`
- Modify: `server/routes/tutor.routes.ts`
- Modify: `server/services/tutor/tutor-service.ts`
- Modify: `server/services/tutor/tutor-service-factory.ts`
- Modify: `server/services/examples/source-provider.ts`
- Modify: `client/src/hooks/use-tutor.ts`
- Modify: `client/src/lib/external-examples.ts`
- Modify: `client/src/components/simulator/ArduinoSimulatorPageLayout.tsx`
- Test: `tests/server/routes/tutor.routes.test.ts`
- Test: `tests/server/services/tutor/revision-pinning.test.ts`
- Test: `tests/client/tutor.test.tsx`
- Test: `tests/client/external-examples.test.tsx`

**Interfaces:**
- Consumes: source/ref selection and combined snapshots from Tasks 4 and 7.
- Produces: validated Course Content context/session handle for question and dialog requests; active dialog pinning; context change reset; server rejection/ignoring of arbitrary client SHA/repository metadata.

- [ ] **Step 1: Write failing tests** for A→A follow-up, A→B reset, client SHA mismatch, unknown revision, and browser override affecting both Examples and Tutor through the existing one selector.
- [ ] **Step 2: Run** focused route/service/client tests and verify current Tutor routes accept no authoritative context contract.
- [ ] **Step 3: Implement** a server-derived context token/handle or equivalent validated request context. Bind initial external-example context to the resolved revision, require the same context for dialog follow-ups, and reset client dialog state when the Course Content source/ref/example context changes.
- [ ] **Step 4: Run** focused revision/dialog tests and verify credential fields remain request-only and no revision from the browser is trusted.
- [ ] **Step 5: Commit** `feat: pin tutor dialogs to course content revisions`.

### Task 9: Remove active separate Tutor source and add migration tombstones

**Files:**
- Modify: `server/config.ts`
- Modify: `server/services/tutor/curriculum/content-repository.ts`
- Modify: `server/services/tutor/tutor-service-factory.ts`
- Modify: `.env.example` or the repository’s existing environment documentation if it lists obsolete Tutor variables
- Test: `tests/server/config.test.ts`
- Test: `tests/server/services/tutor/curriculum.test.ts`

**Interfaces:**
- Consumes: the unified Course Content composition root from Tasks 4–8.
- Produces: no active `UNOSIM_TUTOR_CURRICULUM_*` source/refresh/fetch configuration; every known obsolete variable fails fast with a migration message, while the free Tutor and Course Content path remain available.

- [ ] **Step 1: Write failing tests** for each exact old variable tombstone and for production composition not constructing `GitHubDidacticContentRepository`.
- [ ] **Step 2: Run** config/composition tests and verify old configuration is still accepted or active.
- [ ] **Step 3: Implement** explicit startup tombstones for the eight Stage-A-listed old variables and remove the old fetch stack from active composition; retain only test doubles/adapters needed by focused tests with names that cannot be mistaken for the production source.
- [ ] **Step 4: Run** config, Tutor, and startup tests and verify migration errors are actionable and no Capacity code is changed.
- [ ] **Step 5: Commit** `refactor: retire separate tutor repository source`.

### Task 10: Update Course Content settings and status metadata

**Files:**
- Modify: `shared/examples.ts`
- Modify: `server/routes/examples.routes.ts` or the existing catalog/status route
- Modify: `client/src/lib/external-examples.ts`
- Modify: `client/src/components/features/external-examples-settings.tsx`
- Modify: `client/src/components/features/examples-menu.tsx`
- Test: `tests/server/routes/examples.routes.test.ts`
- Test: `tests/client/external-examples.test.tsx`
- Test: `tests/client/settings-dialog.test.tsx`
- Test: `tests/client/examples-menu.behavior.test.tsx`

**Interfaces:**
- Consumes: combined snapshot/status metadata and the existing `unoExternalExamplesSelection` browser preference.
- Produces: Course Content status that reports Examples and Tutor capability independently, clearly shows the one shared source, and preserves the existing browser-scoped override semantics.

- [ ] **Step 1: Write failing tests** for shared source wording/status, Tutor valid/invalid metadata, one-selector persistence, and no lecturer-lock behavior.
- [ ] **Step 2: Run** focused Settings/Examples tests and verify the UI lacks Tutor capability status.
- [ ] **Step 3: Implement** status plumbing and UI copy without adding another source selector or changing the localStorage key.
- [ ] **Step 4: Run** focused Settings/Examples tests and verify browser override is personal and does not mutate server/operator defaults.
- [ ] **Step 5: Commit** `feat: expose course content status`.

### Task 11: Add authoring fixtures, final documentation adjustments, and full verification

**Files:**
- Create or modify: existing test fixture files under `tests/fixtures/` for schema-v1, schema-v2, valid multi-topic Tutor, invalid Tutor capability, and revision A/B snapshots
- Modify: `docs/ARCHITECTURE.md` only for implementation facts that remain consistent with the Stage-A SSOT
- Test: all relevant Tutor, Examples, and Settings suites

**Interfaces:**
- Consumes: all implementation contracts from Tasks 1–10.
- Produces: maintainable authoring fixtures and a verified branch without changing normative Stage-A decisions.

- [ ] **Step 1: Add failing integration/fixture coverage** for built-in free Tutor, matrix A–G, schema-v1/v2, multi-topic validation, strategy/topic precedence, revision pinning, reset, tombstones, and settings metadata.
- [ ] **Step 2: Run** the focused suites and fix only implementation defects exposed by the tests; record any contract conflict as a ruling before changing code.
- [ ] **Step 3: Update** factual architecture documentation only where the final implementation differs in mechanics from the Stage-A descriptions; do not weaken or rewrite the normative contract.
- [ ] **Step 4: Run the required final commands:** `npm run check`, `npm run test:unit`, `npm run build`, `npm run test:integration`, `npm run check:docs`, `git diff --check`, plus explicit relevant Tutor/Examples/Settings tests.
- [ ] **Step 5: Commit** `test: cover course content tutor control` and record test counts, remaining limitations, PR number if available, and final HEAD SHA. Do not merge or push.
