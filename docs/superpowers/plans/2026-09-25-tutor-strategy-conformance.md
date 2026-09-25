# Tutor Strategy Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every normal Tutor request consume exactly one EffectiveTutorStrategy, including free Tutor requests for arbitrary sketches, while preserving the Course Content SSOT and all app-owned Tutor safety rules.

**Architecture:** First strengthen the Course Content and LearningQuestions SSOT so strategy behavior is normative for planned and free Tutor paths. Then audit the merged implementation and record a field-by-field matrix before writing code. Finally add failing behavioral tests and introduce the smallest app-owned translation from EffectiveTutorStrategy to planner and free-Tutor behavior; repository data remains normalized closed-schema data and never becomes prompt instructions.

**Tech Stack:** TypeScript, Vitest, existing TutorService/planner/provider abstractions, Markdown SSOT/ADR documentation, npm scripts, Git worktrees.

**Spec:** `ssot/ssot_function_definition_CourseContent.md`, `ssot/ssot_function_definition_LearningQuestions.md`, and the user-provided three-stage Tutor Strategy Conformance requirements.

## Global Constraints

- `origin/main` must remain the baseline `6f3676d40fb5ce5f8eab625d035b77f2f99b9016` before work begins.
- Stage A modifies only the requested normative documentation and the execution-plan artifact; no implementation or test files change before the audit is complete.
- Every normal Tutor request uses exactly one EffectiveTutorStrategy.
- Topic planning answers what should be learned; strategy answers how the Tutor teaches; absence of a Topic never disables the selected strategy.
- Strategy precedence is per-example, repository defaultStrategy, built-in-default.
- Topic precedence is active-example primaryTopic, other applicable bound topics, fact-matched repository topics, then free Tutor with the same EffectiveTutorStrategy.
- Invalid Tutor capability disables repository Topics and Strategies together; valid Examples remain usable.
- Repository content cannot provide system prompts, raw prompts, roles, URLs, regexes, scripts, template code, or arbitrary instructions.
- Preserve the current sketch as factual authority, one-primary-question behavior, answerRating 1..5, provider isolation, privacy/API-key behavior, response limits, Mermaid safety, and persistent-storage rules.
- Do not modify Capacity code/defaults, Tutor Registry SSOT, unrelated deployment code, or `ttbombadil/unosim-examples`.
- Do not invent adaptive-difficulty profiles; schema version 1 uses `current-contract` and the existing LearningQuestions algorithm.

## Review Focus

- An arbitrary local sketch with a repository defaultStrategy must show trusted strategy guidance in the provider prompt, not only strategy metadata; Task 4 adds this regression test.
- A valid repository strategy with zero Topics must control free Tutor behavior; Task 4 covers this separately from the no-match case.
- A no-match sketch must retain the repository strategy while omitting only the Topic plan; Task 4 asserts the effective strategy identity and behavior together.
- Invalid Tutor capability and no repository must select built-in-default through the same path; Task 4 covers both fallback cases.
- Strategy values must remain closed normalized data and cannot inject prompt text or executable/template content; Task 4 adds the security regression assertion.

---

### Task 1: Strengthen Course Content and LearningQuestions SSOT

**Files:**
- Modify: `ssot/ssot_function_definition_CourseContent.md`
- Modify: `ssot/ssot_function_definition_LearningQuestions.md`
- Modify: `docs/adr/0006-unified-course-content-and-tutor-strategy.md` only where the clarified invariant is needed
- Modify: `docs/ARCHITECTURE.md` only where the clarified invariant is needed
- Modify: `docs/superpowers/plans/2026-09-25-tutor-strategy-conformance.md`
- Test: no implementation/test files in this task

**Interfaces:**
- Consumes: Stage-A SSOT/ADR from PR #108 and the explicit field semantics in the user request.
- Produces: normative definitions of EffectiveTutorStrategy application, topic/strategy independence, all ten strategy fields, and app-owned non-configurable rules for Stage B and Stage C.

- [ ] **Step 1: Edit the Course Content SSOT**

  Add the exact normal-request invariant, the planned/free path cases, the independent Topic/strategy model, precedence rules, behavioral-not-metadata conformance rule, and closed-schema security constraints. Define operational semantics for `questionKindWeights`, `sketchSpecificity`, `repetition`, `remediation`, `clarification`, `progression`, `scaffolding`, `feedbackVerbosity`, `hintFirst`, and schema-v1 `adaptiveDifficulty`.

- [ ] **Step 2: Edit the LearningQuestions SSOT**

  Define how each strategy field affects deterministic planning and free-Tutor guidance without changing answerRating, one-question, factual-authority, difficulty, privacy, response-limit, or provider contracts.

- [ ] **Step 3: Make only necessary ADR/architecture wording corrections**

  Update the unified Course Content ADR and architecture overview to state that a no-Topic free Tutor still consumes the repository/default EffectiveTutorStrategy, and that metadata without behavioral consumption is non-conformant.

- [ ] **Step 4: Run documentation validation**

  Run `npm run check:docs` and `git diff --check`. Expected: both exit successfully and only the requested Markdown/plan files are changed.

- [ ] **Step 5: Commit Stage A**

  ```bash
  git add ssot/ssot_function_definition_CourseContent.md ssot/ssot_function_definition_LearningQuestions.md docs/adr/0006-unified-course-content-and-tutor-strategy.md docs/ARCHITECTURE.md docs/superpowers/plans/2026-09-25-tutor-strategy-conformance.md
  git commit -m "docs: clarify tutor strategy behavior across all tutor paths"
  ```

### Task 2: Read-only implementation conformance audit

**Files:**
- Inspect: `server/services/tutor/tutor-service.ts`
- Inspect: `server/services/tutor/tutor-planning.ts`
- Inspect: `server/services/tutor/curriculum-tutor-adapter.ts`
- Inspect: `server/services/tutor/curriculum/learning-planner.ts`
- Inspect: `server/services/tutor/strategy/effective-tutor-strategy.ts`
- Inspect: `server/services/course-content/*`
- Inspect: `shared/tutor.ts`
- Inspect: `client/src/hooks/use-tutor.ts`
- Inspect: relevant Tutor, Examples, Course Content, Settings, and route tests
- Create: `docs/audits/2026-09-25-tutor-strategy-conformance-audit.md`

**Interfaces:**
- Consumes: the Stage-A SSOT commit from Task 1.
- Produces: a complete matrix with rows for every strategy field and columns Planned initial, Planned dialog, Free initial, Free dialog, Tests, and Status; explicit metadata-only findings; fallback/precedence findings; exact file/function evidence; smallest fix architecture.

- [ ] **Step 1: Trace strategy resolution and behavior consumers**

  Search for every `EffectiveTutorStrategy` resolution and record whether the resolved object reaches prompt construction, deterministic planning, remediation, progression, repetition, clarification, scaffolding, feedback, hint ordering, and difficulty behavior before response generation.

- [ ] **Step 2: Trace free-Tutor hard-coded policy**

  Inspect `buildUserPrompt`, `buildDialogPrompt`, `getRemediationInstruction`, `getProgressionInstruction`, `ensureDistinctDialogQuestion`, `buildRemediationQuestion`, and `buildConceptTransitionQuestion`; record each hard-coded policy and whether the SSOT makes it configurable.

- [ ] **Step 3: Trace planner field coverage**

  Verify actual use of all ten strategy fields in the deterministic curriculum path and distinguish meaningful fallback semantics from fields that are only parsed or returned as metadata.

- [ ] **Step 4: Audit required scenarios and tests**

  Inspect arbitrary local sketch/default strategy, no Topic match/default strategy, repository strategy without Topics, invalid Tutor capability, no repository, per-example override, and the existing tests that assert only `strategyId`/`strategySource`.

- [ ] **Step 5: Write the audit report before any Stage-C code**

  Write the matrix and exact gaps to `docs/audits/2026-09-25-tutor-strategy-conformance-audit.md`. The report must label each row `PASS`, `PARTIAL`, `MISSING`, or `NOT-APPLICABLE-BY-CONTRACT`, name the exact functions/files, and describe the smallest fix architecture without implementing it.

### Task 3: Add failing behavioral conformance tests

**Files:**
- Modify: existing focused Tutor/Course Content test files identified in Task 2
- Create: a focused conformance test file only if existing test ownership cannot express the behavior without duplication

**Interfaces:**
- Consumes: the audit matrix and current public/internal Tutor test seams.
- Produces: failing tests that observe trusted strategy guidance/selection and behavior, not merely metadata, for the exact gaps identified in the audit.

- [ ] **Step 1: Add the arbitrary/no-Topic regression**

  Assert that a repository default strategy changes provider-owned strategy guidance for an arbitrary sketch when no Topic plan exists.

- [ ] **Step 2: Add zero-Topics and no-match regressions**

  Assert that a repository strategy with zero Topics and a repository with valid Topics that do not match both retain the repository strategy on the free path.

- [ ] **Step 3: Add built-in and invalid-capability regressions**

  Assert that no repository and invalid Tutor capability both use built-in-default through the same behavior-producing path.

- [ ] **Step 4: Add two-strategy behavioral distinction and per-example precedence**

  Assert that two valid strategies produce different trusted guidance or deterministic policy, and that a valid per-example strategy overrides the repository default.

- [ ] **Step 5: Add field-specific behavioral tests for every demonstrated gap**

  Cover weights, specificity, repetition, remediation, clarification, progression, scaffolding, feedback verbosity, hintFirst, and current-contract adaptive difficulty only where Task 2 shows the current path needs correction.

- [ ] **Step 6: Run the focused tests and record RED**

  Run the exact focused Vitest files. Expected: each newly added test fails for the audited reason before implementation changes; unrelated baseline tests remain green.

- [ ] **Step 7: Commit the regression tests**

  ```bash
  git add tests
  git commit -m "test: expose tutor strategy conformance gaps"
  ```

### Task 4: Fix only demonstrated conformance gaps

**Files:**
- Modify: only the Tutor service/planner/strategy files named by the audit
- Modify: only the focused tests from Task 3 as required for final assertions
- Do not modify: Course Content architecture, Capacity, Tutor Registry SSOT, external examples repository

**Interfaces:**
- Consumes: `EffectiveTutorStrategy` and the closed strategy schema defined by Stage A; existing Tutor provider, dialog, difficulty, privacy, and answerRating contracts.
- Produces: one application-owned translation layer from EffectiveTutorStrategy to deterministic planner policy, free-Tutor guidance, and dialog/remediation policy without passing raw repository text to prompts.

- [ ] **Step 1: Introduce the smallest trusted strategy-to-behavior mapping**

  Map closed enum/number values to application-owned guidance or deterministic choices. Ensure the built-in strategy uses this exact path and repository strategies cannot inject arbitrary prompt text.

- [ ] **Step 2: Apply the strategy to free initial questions**

  Pass the effective strategy into the free initial prompt path and ensure arbitrary sketches, zero-Topic repositories, and no-match repositories retain repository defaultStrategy behavior.

- [ ] **Step 3: Parameterize free dialog behavior**

  Replace only the audited hard-coded configurable remediation, repetition, clarification, progression, scaffolding, feedback, and hint-first decisions with the trusted mapping while preserving core Tutor safety rules.

- [ ] **Step 4: Complete planner coverage where the SSOT requires it**

  Consume every audited applicable field in deterministic planning, using generated/app-owned fallbacks where the SSOT defines them and retaining current-contract adaptive difficulty without a second delta implementation.

- [ ] **Step 5: Run the focused tests GREEN**

  Run the focused Tutor/Course Content tests from Task 3. Expected: all new regression tests pass and metadata matches the strategy that actually produced the behavior.

- [ ] **Step 6: Commit the implementation fix**

  ```bash
  git add server client shared tests
  git commit -m "fix: apply effective tutor strategy to free tutor behavior"
  ```

### Task 5: Final verification and review handoff

**Files:**
- Inspect: complete branch diff and final audit/SSOT changes
- Modify: no new functionality; only test/doc adjustments required by verification evidence

**Interfaces:**
- Consumes: all Stage-A, test, and implementation commits.
- Produces: a reviewable branch with exact test evidence, no external-repository changes, and a PR-ready report; it is not merged automatically.

- [ ] **Step 1: Run relevant focused Tutor/Examples/Settings tests**

  Run all focused tests named by the audit plus the existing Tutor, Course Content, Examples, and Settings suites. Expected: zero failures and no test-only metadata assertions left for corrected behavior.

- [ ] **Step 2: Run the required release gates**

  Run `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run check:docs`, `npm run test:coverage`, `npm run sonar`, and `git diff --check`. Run Playwright if the changed behavior reaches browser Tutor behavior.

- [ ] **Step 3: Verify scope and security**

  Confirm no Capacity files/defaults, Tutor Registry SSOT, or external examples repository files changed; search the final diff for raw repository prompt fields, roles, URLs, regexes, scripts, and template content.

- [ ] **Step 4: Perform final review before push/PR**

  Review the complete `origin/main...HEAD` diff against the strengthened SSOT, record remaining limitations, and only then push `feature/tutor-strategy-conformance` and open a PR. Do not merge automatically.
