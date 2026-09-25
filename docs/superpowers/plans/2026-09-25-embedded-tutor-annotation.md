# Embedded Tutor Annotations and Learning Objectives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move example-specific Tutor metadata from Course manifest bindings into a validated, server-stripped annotation at the end of the example main `.ino`, and make its learning objectives affect both planned and free Tutor behavior.

**Architecture:** The Course Content loader will extract exactly one terminal `/* @unosim-tutor ... @end-unosim-tutor */` block from each declared main `.ino`. It will return cleaned Example source plus a normalized `ExampleTutorAnnotation` inside the immutable server snapshot; public Example responses expose only cleaned source. Tutor planning receives the annotation separately and resolves embedded strategy, repository default, or built-in fallback without allowing annotation text to become instructions.

**Tech Stack:** TypeScript, Zod, YAML core parser, Vitest, existing CourseContentLoader, TutorService, CurriculumTutorAdapter, and existing client Example/source contracts.

**Spec:** Stage-A SSOT/ADR changes in this branch, based on the user-provided embedded Tutor annotation contract.

## Global Constraints

- Validation and implementation base is exactly `3ec19f7f0ea11071834be00977b10f93365e486e`.
- `/tmp/unosim-examples-v2-pilot` and the original UnoSim-Examples worktree are read-only for this task.
- `ssot/ssot_function_tutor_model_registration.md` remains untouched.
- One optional terminal annotation may exist only in the declared main `.ino`.
- Annotation data is strict, bounded, safe YAML data; it cannot provide prompts, roles, URLs, regexes, scripts, templates, or provider controls.
- Invalid Tutor annotation data strips from Example source, preserves valid Examples, and invalidates Tutor capability without partial activation.
- `learningObjectives` describe what to learn; `EffectiveTutorStrategy` controls how to teach.
- Existing revision/session pinning, privacy, API-key, difficulty, response, and source-authority contracts remain unchanged.

## Review Focus

- Marker placement and malformed/unterminated blocks: parser tests cover EOF, duplicate, middle-of-source, header-file, and hidden-source behavior.
- Invalid annotations must not leak teacher text: loader/API/client/compile tests assert cleaned source only.
- Objective persistence across topic/free paths and pinned dialogs: Tutor tests cover planned, free, no-match, and continuation paths.
- Removing manifest bindings must not break schema-v1 or unannotated schema-v2 Examples: loader/schema fixtures cover both.
- Embedded strategy precedence must remain distinct from repository/default fallback: strategy matrix tests cover embedded, repository, built-in, and arbitrary sketches.

### Task 1: Normative contract

**Files:**
- Modify: `ssot/ssot_function_definition_CourseContent.md`
- Modify: `ssot/ssot_function_definition_LearningQuestions.md`
- Modify if needed: `ssot/ssot_function_definition_ExternalExamples.md`, `docs/adr/0006-unified-course-content-and-tutor-strategy.md`, `docs/ARCHITECTURE.md`

- [ ] Specify the terminal annotation grammar, ownership, safe stripping, strict schema, bounds, objective semantics, and strategy/topic precedence.
- [ ] Record that manifest example Tutor bindings are retired as the canonical mechanism because the only existing external pilot is local and unpushed.
- [ ] Run `npm run check:docs` and `git diff --check`.
- [ ] Commit only documentation with `docs: define embedded tutor annotations and learning objectives`.

### Task 2: Annotation parser and normalized data

**Files:**
- Create: `server/services/course-content/embedded-tutor-annotation.ts`
- Test: `tests/server/services/course-content/embedded-tutor-annotation.test.ts`

- [ ] Add a strict Zod schema for `schemaVersion`, optional safe-ID arrays/IDs, and bounded control-character-free objectives.
- [ ] Add `extractEmbeddedTutorAnnotation(source: string, fileName: string)` that returns cleaned source plus optional normalized annotation, rejects non-main files, and recognizes only the exact terminal marker.
- [ ] Use YAML core parsing with duplicate-key and custom-tag rejection, and enforce a byte limit before parsing.
- [ ] Write failing tests for valid, absent, duplicate, middle, unterminated, invalid field, primary-topic, objective-bound, tag, and header-file cases.
- [ ] Run the focused test red before implementation and green after implementation.

### Task 3: Loader boundary and hidden-source model

**Files:**
- Modify: `server/services/examples/examples-schema.ts`
- Modify: `server/services/course-content/course-content-loader.ts`
- Modify: `server/services/examples/examples-repository.ts`
- Modify: `server/services/examples/examples-cache.ts` or related snapshot types
- Test: `tests/server/services/course-content/course-content-loader.test.ts`, `tests/server/services/examples/examples-repository.test.ts`

- [ ] Process only each example’s declared main `.ino` after fetching files; attach annotation by Example ID and replace the main file content with the cleaned source.
- [ ] Make malformed annotation data invalidate Tutor capability while retaining cleaned valid Examples; ensure annotation is never included in Example API details or cache metadata.
- [ ] Keep ordinary source bytes unchanged except permitted trailing newline normalization.
- [ ] Add loader tests for valid extraction, missing annotation, malformed annotation isolation, secondary `.ino`/`.h` rejection, and all-reference behavior.
- [ ] Run Course Content and Examples tests.

### Task 4: Tutor context and objective behavior

**Files:**
- Modify: `server/services/tutor/tutor-planning.ts`
- Modify: `server/services/tutor/curriculum-tutor-adapter.ts`
- Modify: `server/services/tutor/tutor-service.ts`
- Modify: `server/services/tutor/strategy/tutor-strategy-guidance.ts` or add an app-owned objective guidance helper
- Test: `tests/server/services/tutor/strategy-conformance.test.ts`, `tests/server/services/tutor/tutor-service.test.ts`, relevant route tests

- [ ] Carry annotation data in `TutorPlanningContentContext` and the pinned session context, never from mutable client metadata.
- [ ] Resolve embedded strategy first, then repository default, then `built-in-default`; preserve repository source metadata only for actual behavior.
- [ ] Add application-owned bounded guidance for validated learning objectives to free and planned prompts, explicitly labeling them as data rather than instructions.
- [ ] Preserve current-sketch factual authority, one-question, no-solution, provider, privacy, and response constraints.
- [ ] Add behavioral tests for objective-only free Tutor, objective-plus-topic, nonmatching topic with objectives retained, no annotation, arbitrary sketches, long objective acceptance, and strategy matrix A-E.

### Task 5: Retire manifest Example bindings

**Files:**
- Modify: `server/services/course-content/course-content-schema.ts`
- Modify: `server/services/course-content/course-content-loader.ts`
- Modify: `server/services/tutor/curriculum-tutor-adapter.ts`
- Modify: affected fixtures and tests under `tests/fixtures/course-content` and `tests/server/services`

- [ ] Remove manifest-level per-Example Tutor binding fields and their validation because no published external dependency exists.
- [ ] Make unannotated schema-v2 manifests valid and preserve schema-v1 behavior.
- [ ] Convert existing strategy/topic tests to embedded annotations or direct normalized snapshot data without retaining a second authoring authority.
- [ ] Add explicit regression tests proving no ambiguous manifest-versus-embedded precedence remains.

### Task 6: Client/API/compile hidden-source regression coverage

**Files:**
- Inspect and modify only if required: `server/services/examples/examples-repository.ts`, `client/src/lib/external-examples.ts`, `client/src/components/features/examples-menu.tsx`, `client/src/hooks/use-tutor.ts`, compile/source-project paths
- Test: relevant client Example loading, Tutor, route, compile, and Playwright tests

- [ ] Assert Example API, editor, compiler, and simulator receive cleaned source only.
- [ ] Assert the annotation never appears in client-visible file content or generated source payloads.
- [ ] Verify normal external Examples and unannotated sketches are unchanged.

### Task 7: Final verification, review, and PR

- [ ] Run focused Course Content, Examples, Tutor, strategy, revision/session, API, and client tests.
- [ ] Run `npm run check`, `npm run test:unit`, `npm run test:integration`, `npm run build`, `npm run check:docs`, `npm run test:coverage`, `npm run sonar`, `git diff --check`, and Playwright.
- [ ] Confirm Capacity code, Tutor Registry SSOT, external pilot, original worktrees, and unrelated deployment code are unchanged.
- [ ] Request a code review against the exact base SHA before pushing.
- [ ] Push `feature/embedded-tutor-annotation` and open the PR; do not merge.
