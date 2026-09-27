# Tutor Quality Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish deterministic Tutor quality hard gates, a reusable scenario runner, the PWM regression case, and compatible Course Content validation in UnoSim and UnoSim-Examples.

**Architecture:** Keep runtime ownership in `TutorService`, `CurriculumTutorAdapter`, and existing Course Content schemas. Add one pure authoring validator that reuses production fact matching, one filesystem CLI adapter, and test-only scenario orchestration around the real Tutor service with only the provider faked. Pin the Examples CI consumer to the resulting UnoSim commit.

**Tech Stack:** TypeScript, Vitest, Zod/YAML, GitHub Actions, existing Course Content loader and Tutor planner.

---

Specification: `ssot/ssot_function_definition_TutorQuality.md`

### Task 1: Establish the normative quality contract

**Files:**
- Create: `ssot/ssot_function_definition_TutorQuality.md`
- Modify: `docs/ARCHITECTURE.md`
- Test: `scripts/check-docs.mjs`

1. Add the deterministic learning-support proxy, trust boundaries, runtime/content invariants, scenario contract, CI contract, and explicit Stage 2 exclusions.
2. Link the SSOT from the architecture documentation.
3. Run `npm run check:docs` and commit the documentation.

### Task 2: Build the reusable scenario runner and adversarial service cases

**Files:**
- Create: `tests/server/services/tutor/support/tutor-quality-scenario-runner.ts`
- Create: `tests/server/services/tutor/tutor-quality-scenarios.test.ts`
- Modify: `server/services/tutor/tutor-service.ts`

1. Write failing scenarios for provider errors before commit, invalid output, complete solutions, multiple primary questions, contradictory provider metadata, exact/near repetition, transition/blocked repair retention, and TutorPlan question authority.
2. Run the focused tests and confirm each new invariant fails for the intended reason.
3. Implement the minimal validation/metadata-boundary changes in `TutorService`.
4. Run the focused tests and existing Tutor service/planning tests; commit.

### Task 3: Preserve TQ-REG-001 with real PWM inputs

**Files:**
- Create: `tests/fixtures/tutor-quality/TQ-REG-001-pwm.ino`
- Create: `tests/server/services/tutor/tq-reg-001-pwm.test.ts`

1. Write a failing scenario using the real PWM sketch and the narrowed Topic activation from the reviewed Course Content.
2. Assert that `variables-and-serial` is not selected, a strong-answer repetition is repaired, and phase/revision/state metadata remains consistent.
3. Make only runner/fixture corrections if needed; production changes require a separate failing invariant test.
4. Run the focused regression test and commit.

### Task 4: Add deterministic Course Content quality validation

**Files:**
- Create: `server/services/course-content/tutor-quality-schema.ts`
- Create: `server/services/course-content/tutor-quality-validator.ts`
- Create: `tests/server/services/course-content/tutor-quality-validator.test.ts`
- Create: `scripts/validate-tutor-course-content.ts`
- Create: `tests/scripts/validate-tutor-course-content.test.ts`
- Modify: `package.json`

1. Write failing unit tests for activation cases, missing coverage, unreachable Concepts/Indicators, mastery probe/kind shortages, prerequisite reachability, DEEPEN exhaustion/kind shortages, and a valid bundle.
2. Implement a pure validator using existing facts/matcher/question applicability/deepening defaults.
3. Write a failing CLI test for local bundle loading, hashes, and quality-case parsing.
4. Implement the filesystem fetch adapter and machine-readable/nonzero CLI result.
5. Run focused tests, typecheck, and commit.

### Task 5: Make UnoSim-Examples pass the authoring hard gate

**Files (UnoSim-Examples worktree):**
- Create: `tutor/quality-cases.yaml`
- Modify: `tutor/topics/variables-and-serial.yaml`
- Modify: `tutor/topics/long-values.yaml`
- Modify: `tutor/manifest.yaml`

1. Add minimal positive/negative activation cases, including PWM as a negative case for `variables-and-serial`.
2. Run the validator and observe the expected mastery/DEEPEN exhaustion failures.
3. Add the smallest structurally distinct application/transfer probes needed for reachable mastery and default DEEPEN; update hashes.
4. Re-run the pinned local validator and commit.

### Task 6: Add explicit CI hard gates and compatible-version pinning

**Files:**
- Modify (UnoSim): `.github/workflows/ci.yml`, `package.json`
- Create (UnoSim-Examples): `.github/workflows/tutor-quality.yml`, `.unosim-compatible-commit`

1. Add `test:tutor-quality` as a deterministic, credential-free UnoSim PR step.
2. Pin the Examples workflow to the final UnoSim Stage 1 commit and invoke its Course Content validator against the Examples checkout.
3. Validate workflow syntax structurally and run both local commands.
4. Commit CI changes.

### Task 7: Verify and review the complete change

1. Run `npm run check`, `npm run check:docs`, `npm run test:tutor-quality`, focused Tutor/Course Content tests, and `npm run test:unit` in UnoSim.
2. Run the exact pinned validator against the UnoSim-Examples worktree and verify hashes/status are clean.
3. Inspect both diffs and commits for accidental changes, secrets, scope creep, or reliance on a real provider.
4. Perform a fresh self-review because parallel review agents are disabled for this task; fix verified issues and repeat affected gates.
5. Report both branch heads without pushing or merging.
