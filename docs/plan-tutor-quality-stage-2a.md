# Tutor Quality – Stage 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, reviewable real-provider evaluation foundation that runs the normal `TutorService` path, records secret-free transcripts, reapplies deterministic Stage-1 checks, and reports technical outcomes separately from Tutor invariant violations.

**Architecture:** Keep Stage 2A as an explicitly invoked observation layer. A repository-owned YAML anchor manifest resolves sketch and typed Course Content fixtures. A testable runner receives an injected `LLMProvider`, clones scenario state per sample, invokes `TutorService` and `CurriculumTutorAdapter`, captures the parsed provider result before service validation/repair, writes allow-listed JSON artifacts, and aggregates deterministic categories. The CLI constructs the real `KiconnectProvider`, performs clean-worktree/credential/model/call-budget preflight, and is never imported by the application runtime or required PR workflows.

**Tech Stack:** TypeScript/ESM, existing `TutorService`/`LLMProvider`/`KiconnectProvider`, `yaml`, Node `crypto`/`fs`, Vitest, `tsx`, GitHub Actions `workflow_dispatch`.

**Spec:** `ssot/ssot_function_definition_TutorQualityStage2A.md`

## Global Constraints

- Preserve all Stage-1 hard gates and existing Tutor trust boundaries.
- Do not call a provider directly from the evaluator; use `TutorService` and the existing provider implementation.
- Do not modify normal provider fallback behavior. Stage 2A requires an explicit model and marks missing/mismatched model metadata `invalid`.
- Never accept or print a credential value, authorization header, `process.env`, or an uploaded diff. Accept only a credential environment-variable name.
- A dirty relevant Git worktree is an invalid preflight and issues no provider call.
- No real-provider call is made by unit tests, pull-request CI, or required checks. Missing credentials produce `not-run` output.
- No semantic grades, LLM-as-Judge, adaptive strategy, fact-extractor expansion, learner profiles, or learning-effect claims.
- Keep artifact schemas allow-listed, bounded, deterministic, and disposable. Do not commit generated run output.
- Use TDD: write a focused failing test, run it red, implement the smallest change, run it green, then commit each coherent task.

## Review Focus

- Verify the runner records both `executionStatus` and `invariantViolations`; a repaired response can be completed while retaining raw invariant violations.
- Verify raw means the parsed `ProviderQuestionResult.result` captured before TutorService validation/repair, never an HTTP envelope.
- Verify `evaluationIdentity` includes Git SHA, Course Content revision, corpus/version, provider/model, prompt revision and effective-template digest, and all bounded parameters.
- Verify prompt revision is app-owned/versioned and changes when the effective system/user templates change.
- Verify every multi-turn scripted answer has an explicit preceding-question binding; otherwise the scenario is invalid.
- Verify `TQ-REG-001` checks no variables-topic activation and no exact/Stage-1-heuristic repeat, not an unimplemented semantic judgement.
- Verify reports distinguish invalid metadata, not-run preflight, technical provider failures, invariant violations, and completed observations with explicit denominators.

---

## Task 1 – Lock the corpus and fixture contract with tests

- [ ] Add a failing loader/contract test for a manifest with `corpusId`, `corpusVersion`, stable scenario IDs, sketch references, course fixture/free-Tutor mode, synthetic answers, explicit turn bindings, and structural expectations.
- [ ] Add a failing test that rejects duplicate IDs, missing fixture references, `auto` model declarations, unbound continuation answers, and a corpus edit that does not increase the version when the parsed scenario digest changes.
- [ ] Add `evals/tutor-quality/anchor-corpus.yaml` at version 1 with the ten approved anchors: `TQ-REG-001`, simple variable, Serial prediction, incorrect answer, partial answer, strong answer/progression, unmatched/free Tutor, LEARN→DEEPEN, EXPAND, and off-topic answer.
- [ ] Add only the small required `.ino` fixtures under `evals/tutor-quality/fixtures/`; reuse the existing PWM fixture where possible rather than copying production content.
- [ ] Add a typed `anchor-course-content.ts` fixture factory for the small valid Course Content snapshots and seeded progression states required by topic activation, LEARN/DEEPEN, and EXPAND cases. Keep revision strings and question IDs explicit and reviewable.
- [ ] Run the focused corpus tests red before implementation and green after the loader/factory exists.

## Task 2 – Make prompt revision metadata explicit without changing prompts

- [ ] Add a failing unit test asserting a versioned prompt revision identifier and SHA-256 digest are stable, contain the effective system/initial-user/dialog-user template sources before scenario substitution, and change when a template source changes.
- [ ] Refactor only the prompt-source declarations needed by `TutorService` so existing generated prompt text remains byte-for-byte compatible; export the revision descriptor for the evaluator.
- [ ] Do not add a new prompt, quality rule, or runtime strategy. The revision helper is metadata only.
- [ ] Run existing Tutor prompt tests plus the new revision test.

## Task 3 – Implement the injectable evaluation runner and transcript model

- [ ] Add failing tests for fresh state/history cloning per sample, normal `TutorService` initial/dialog invocation, provider capture before validation/repair, deterministic repeat/solution/schema checks, state-before/state-after snapshots, and explicit expected structural checks.
- [ ] Add `server/services/tutor/evaluation/real-provider-evaluation.ts` with small typed contracts for corpus scenarios, invocation options, sample metadata, logical turns, deterministic check records, transcript artifacts, and aggregate reports.
- [ ] Inject the provider, clock, random suffix, Git metadata, and output writer seams so tests never need credentials, network, or a mutable repository.
- [ ] Wrap the provider to capture requests and parsed `ProviderQuestionResult` values before `TutorService` receives them. Keep the raw capture allow-listed and exclude transport envelopes/headers.
- [ ] Invoke `TutorService` with `CurriculumTutorAdapter` when a scenario declares Course Content; invoke the same service without planning for free-Tutor cases.
- [ ] Reuse exported `validateLearningQuestion` and `isSemanticallyRepeatedQuestion` for deterministic checks. Record raw complete-solution/repeat violations even when TutorService rejects or repairs the response; never turn these into semantic scores.
- [ ] Enforce fixed requested model, preflight model availability, returned-model equality, explicit call/sample limits, and no call beyond the budget.
- [ ] Implement the two status axes from the SSOT: `executionStatus` (`completed`, `invalid`, `technical-failure`, `not-run`) and `invariantViolations` (array). Classify missing credentials/zero preflight budget as `not-run`; provider errors, timeout, malformed responses, and mid-run budget exhaustion as technical failures; metadata/model/binding problems as invalid.
- [ ] Implement canonical JSON hashing for `evaluationIdentity`, run IDs with UTC timestamp plus collision-resistant suffix, and secret-free allow-listed JSON transcript writing.
- [ ] Implement aggregate counts/rates per scenario and overall with explicit denominators, exact provider-call counts, budget exhaustion, and cost `unavailable` when the provider supplies no cost data.
- [ ] Run the focused evaluator tests red before implementation and green after each runner slice.

## Task 4 – Add adversarial fake-provider coverage

- [ ] Add fake-provider tests for exact repeated questions, Stage-1 heuristic repeats, invalid schema, complete solution, forged/wrong planning metadata, provider error before commit, timeout, returned-model mismatch, and call-budget exhaustion.
- [ ] Assert repaired final planning metadata remains application-owned and state commits only after a successful TutorService request.
- [ ] Assert technical failures do not mutate progression state and are not counted as Tutor-quality violations unless a separate raw deterministic violation was observed.
- [ ] Assert no credential value appears in serialized transcript, report, thrown error, or logger input.

## Task 5 – Add the explicit CLI and local execution contract

- [ ] Add `scripts/tutor-quality-real-provider-eval.ts` as a thin CLI around the runner. Require a fixed `--model`, bounded `--samples` and `--max-calls`, `--output-dir`, corpus selection, and a credential environment-variable name; reject `auto` and any credential value flag.
- [ ] Add a package script such as `eval:tutor-quality:real` that is not referenced by `test`, `test:unit`, `test:tutor-quality`, or normal build gates.
- [ ] Resolve the repository Git SHA/clean state and configured Course Content/corpus revisions before execution. Abort as `invalid` without provider calls when preflight identity cannot be proven.
- [ ] Add a short operator document with a local command, expected output paths, missing-credential behavior, call-budget example, and explicit warning that Stage 2A observes deterministic integrity rather than learning effect.
- [ ] Test CLI argument validation and missing-credential `not-run` behavior without contacting a provider.

## Task 6 – Add a manual-only workflow

- [ ] Add `.github/workflows/tutor-quality-real-provider.yml` with only `workflow_dispatch`, explicit model/sample/call-budget inputs, Node version from `.nvmrc`, and a repository secret exposed only to the invoked process through the configured environment variable.
- [ ] Upload bounded transcript/report artifacts with retention; never print the secret or use a `pull_request`/required-check trigger.
- [ ] Make missing secret a visible skipped/not-run result, not a failing PR gate.
- [ ] Document that this workflow is optional/manual first; do not add nightly scheduling until cost and stability are known.

## Task 7 – Verification and review handoff

- [ ] Run the Node-version check, focused Stage-2A tests, existing `npm run test:tutor-quality`, `npm run check`, `npm run check:docs`, and `git diff --check`.
- [ ] Run the CLI in no-credential mode and verify it writes only the documented not-run artifact (or exits without artifacts according to the contract), with no secret-like data.
- [ ] Confirm generated transcripts/reports are ignored or written only to caller-selected disposable directories.
- [ ] Review the diff for accidental production behavior changes, duplicated Stage-1 validation, direct HTTP access, semantic scoring, and CI hard-gate coupling.
- [ ] Commit the implementation in coherent commits and report branch/base/HEAD, files, anchors, deterministic metrics, excluded Stage-2B dimensions, tests, and the absence of a real-provider run if credentials are unavailable.

