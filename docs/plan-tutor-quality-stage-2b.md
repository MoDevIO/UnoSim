# Tutor Quality Stage 2B – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a reviewable, calibrated semantic evaluation layer over immutable Stage-2A transcripts, then extend it to repeated controlled Tutor-model comparisons without changing Stage 1 or the Stage-2A execution contract.

**Architecture:** Keep the Semantic Corpus and all semantic artifacts Stage-2B-owned. A narrow adapter translates a Semantic Case and Frozen Pre-Turn Context into the existing TutorQualityEvaluationScenario/TutorQualityTurn inputs and calls the existing Stage-2A runner unchanged; Stage 2B then loads and validates the resulting immutable transcript. A secondary ingestion path accepts an already-existing compatible transcript without rerunning the Tutor. Judge orchestration, evidence filtering, result validation, calibration, comparisons, and reports remain separate Stage-2B modules.

**Tech Stack:** TypeScript/ESM, Node 24.20.0 from .nvmrc, existing yaml and zod dependencies, existing TutorService/LLMProvider/KiconnectProvider boundary, Vitest, tsx, and an optional workflow_dispatch-only GitHub Actions workflow.

**Spec:** ssot/ssot_function_definition_TutorQualityStage2B.md (normative); ssot/ssot_function_definition_TutorQualityStage2A.md and ssot/ssot_function_definition_TutorQuality.md remain authoritative within their scopes.

This plan follows the existing repository convention at docs/plan-tutor-quality-stage-2a.md. It is non-normative; where it conflicts with the Stage-2B SSOT, the SSOT wins. The implementation branch starts from 68d2703f3513762b521284718f0b5c0b6a4a5de8 and is docs/tutor-quality-stage-2b-implementation-plan.

## Global Constraints

- Do not change Stage-1 hard gates, Tutor runtime behavior, prompt text, Tutor strategy, or Course Content semantics.
- Do not extend evals/tutor-quality/anchor-corpus.yaml with Stage-2B rubric, reference, role, exposure, or Judge metadata.
- Do not modify the Stage-2A runner contract. Stage 2A remains the only TutorService invocation, Tutor-provider transport, credential, provider-call-accounting, deterministic-invariant, and transcript-generation path.
- Generate a Stage-2A scenario from a Stage-2B case only through the adapter defined in this plan; do not create a second Tutor execution pipeline.
- Map Stage-2B expected interpretations, Human References, rubric labels, roles, and exposure only to Stage-2B artifacts. Stage-A `expected` fields remain limited to their existing deterministic structural contract; never encode semantic answers or Human verdicts there.
- Treat compatible pre-existing Stage-2A transcripts as a secondary ingestion path; never rerun a Tutor for that path.
- Evaluate the normalized final Tutor result as the primary response. Keep the original Stage-2A executionStatus and invariantViolations unchanged and separately attributable. Do not expose raw provider results to the Judge in the first implementation.
- Keep executionStatus, invariantViolations, semanticEvaluationStatus, criticalSemanticFailures, rubric results, calibration metadata, and per-comparison comparabilityStatus as independent axes.
- Use deterministic synthetic learner input only. Do not add a Student LLM, multi-turn autonomous learner, real-learner data, learning-effect claim, or Stage 2C behavior.
- Use fixed, resolved Tutor and Judge model IDs. Credentials are environment-variable values only; CLIs accept environment-variable names, never secret values.
- Route Judge structured generation through the existing provider implementation and shared transport/error/timeout boundary. Do not add direct HTTP/fetch calls in Stage-2B modules or a parallel provider framework.
- Give the Judge an application-built allow-listed evidence object. Blind Tutor model/provider identity and Candidate labels; hide human outcome labels, desired ranks, other candidates, and prior Judge verdicts.
- Version and digest corpus, cases, Frozen Pre-Turn Context, factual references, prompts, rubric, schemas, evidence policy, calibration, and benchmark protocol. Canonicalize unordered linked records without separating associated values.
- Keep all artifacts allow-listed, bounded, secret-free, caller-selected, disposable, and traceable to Stage-2A evaluationIdentity plus transcript digest. Never commit run output.
- Declare finite Tutor, Judge, retry, and total provider-call limits before any external call; enforce a run-wide total as well as the existing Stage-2A per-run limit. Concrete Stage-2B limit values require DG-10.
- Real Tutor/Judge calls are manual-only. Do not add them to tests, pull-request triggers, required checks, or normal CI.
- Do not calculate weighted overall scores, force an ordering, or make validated ranking/superiority claims until the required Decision Gates have been resolved normatively.
- Apply TDD to future code tasks: add a focused failing test, confirm red, implement the minimum change, confirm green, and commit one coherent reviewable PR at a time.

## Review Focus

- A learner answer is bound to a different or changed question: reject the adapter input as invalid before any provider call; pin with Frozen Context and adapter binding tests.
- A Judge sees Tutor/Candidate/provider identity, raw provider output, hidden human labels, or unrelated transcript fields: build a positive allow-list and assert absent-field tests at the evidence-builder boundary.
- A technical failure or Stage-1 invariant is collapsed into semantic quality: preserve and test all status axes independently, including repaired final output with a raw invariant violation.
- A Critical Semantic Failure is emitted without a cited Tutor claim, contrary evidence, and materiality rationale: reject the semantic result or require abstention; test malformed and adversarial Judge outputs.
- A known/development case is reported as uncontaminated held-out evidence or model ranking is claimed under uncalibrated/incompatible inputs: test per-Candidate exposure, calibration-scope, and comparability guardrails.

---

## Implementability Analysis

| Classification | Stage-2B work | Plan treatment |
| --- | --- | --- |
| Directly implementable from the SSOT | Stage-2B-owned corpus IDs/version/digest, stable case IDs, synthetic answer binding, evidence-source typing, Frozen Pre-Turn Context validation, Stage-2A transcript references, semantic status axes, strict application-owned schemas, Judge evidence allow-list, fixed model IDs, abstention, absolute evaluation, severity/critical-failure evidence, secret-free artifacts, manual-only calls, and no learning-effect claims. | Milestones 1–2 establish these contracts and the first absolute-evaluation vertical slice. |
| Directly implementable without resolving a statistical policy | Raw per-dimension distributions, explicit denominators, failure counts, reliability, latency, call counts, per-comparison comparability evidence, report rendering, calibration agreement/disagreement records, and exploratory runs marked uncalibrated. | Milestones 3–4 can expose evidence without promoting it to validated claims. |
| Requires an explicit Decision Gate before the affected behavior | Substantive rubric scale; any confidence score; calibration sufficiency/status transitions; minimum samples for claims; statistical intervals/multiple-comparison method; Judge ensembles; initial held-out governance; ranking/partial-order method; cost normalization; finite operational caps; pairwise reversal protocol; admission/adjudication policy for contested Human References. | No undocumented defaults. See DG-1 through DG-12; stop only the dependent claim or milestone when a gate is open. |
| Not required for the first useful Stage-2B release | Pairwise evaluation, multiple Tutor models, a statistical ranking, cost normalization, held-out generalization evidence, autonomous Student LLM, production selection, prompt/strategy optimization, or Stage 2C. | Defer to Milestones 4–6 or exclude entirely as specified below. |

### Repository architecture mapping

| Stage-2B responsibility | Existing/new module | Input → output | Normative owner and boundary | Tests / non-duplication |
| --- | --- | --- | --- | --- |
| Stage-2B Semantic Corpus parse, validation, canonical digest/evolution | New server/services/tutor/evaluation/semantic/semantic-corpus.ts; follow structure of existing server/services/tutor/evaluation/anchor-corpus.ts | YAML/object → typed, validated corpus and digest | Stage 2B; do not add semantic fields to the Stage-2A anchor corpus/parser | New semantic-corpus tests; independent schema because the contracts differ, while reusing the established parser/digest pattern |
| Frozen Pre-Turn Context and evidence sources | New semantic/frozen-context.ts and semantic/evidence.ts | Case/context → bound immutable context and typed evidence references | Stage 2B; preserve exact ordered history and question/answer binding | Context/evidence allow-list tests; no Stage-1 rule copy |
| Stage-2B case → Stage-2A scenario bridge | New semantic/stage2a-adapter.ts | Valid Semantic Case + resolved sketch/Course Content → TutorQualityEvaluationScenario | Translation only; calls existing runTutorQualityEvaluation unchanged | Adapter unit tests; no TutorService/provider calls or Stage-2A transcript recreation |
| Tutor run, credentials, deterministic checks, transcript | Existing server/services/tutor/evaluation/real-provider-evaluation.ts and TutorService, CurriculumTutorAdapter, LLMProvider/KiconnectProvider | Stage-A scenario + fixed Tutor model → existing report/transcripts | Stage 2A sole owner; Stage-2B orchestrator supplies inputs and consumes its artifact | Keep existing real-provider and TutorService tests; Stage-2B integration test asserts exactly one Stage-A invocation and unchanged transcript statuses |
| Existing-transcript ingestion | New semantic/stage2a-transcript.ts | JSON transcript + expected Semantic Case → compatible typed transcript or invalid reason | Stage 2B may validate and reference, but must not edit or rerun the transcript | Valid/invalid digest, schema, binding, non-completed-status tests |
| Judge call abstraction and accounting | New semantic/judge-provider.ts plus an additive structured-output interface in existing server/services/tutor/llm-provider.ts and implementation in kiconnect-provider.ts | Allow-listed prompt request + fixed Judge model/credential → returned model plus parsed JSON value and call metadata | Transport/error/timeout stays in existing Kiconnect provider; Stage 2B owns Judge request orchestration, schema validation, and Judge budget. Tutor generation method remains unchanged | Fake Judge contract tests plus existing kiconnect-provider tests; no second HTTP stack |
| Prompt/evidence/result validation/absolute evaluation | New semantic/judge-evidence.ts, semantic/judge-schema.ts, semantic/absolute-evaluation.ts | Case + immutable Stage-2A transcript → blinded evidence → strict result schema → Semantic Sample Evaluation | Stage 2B; final Tutor output primary, raw provider result excluded from Judge payload | Allow-list, malformed-schema, missing citation, abstention, Critical Semantic Failure evidence tests |
| Human Reference/calibration | New semantic/human-reference.ts and semantic/calibration.ts | Reviewed reference set + Judge artifacts → disagreement and scoped calibration evidence | Human labels remain separate/hidden during evaluation; no status promotion without DG-3/DG-12 policy | Reference provenance/privacy and disagreement-category tests |
| Benchmark manifest/comparability/repeats | New semantic/benchmark.ts and semantic/comparability.ts | Baseline/Candidates + frozen case selections + Stage-A transcripts → per-comparison status and sample associations | Stage 2B; Stage-A execution remains delegated; status is determined from manifests, not scores | Controlled-field, qualified-confound, invalid-difference, exposure, repeat-allocation, and no-ranking guard tests |
| Pairwise/report aggregation | New semantic/pairwise.ts, semantic/aggregate-report.ts, semantic/human-report.ts | Absolute artifacts and optional pair inputs → separate distributions and human-readable explanation | Stage 2B; absolute evaluation is the canonical critical-failure source | Order seed/balance, reversal disagreement, denominators, artifact links, and no forced total-order tests |
| Operator entrypoints | New scripts/tutor-quality-semantic-eval.ts; later scripts/tutor-quality-benchmark.ts | CLI flags + environment credential names + corpus/transcript selection → bounded Stage-A/2B output directory | Thin script around the existing runner and semantic modules; do not edit the Stage-A CLI to load B metadata | Fake-provider CLI tests; only manual workflow may make real calls |

The existing Stage-2A runner exports TutorQualityEvaluationScenario, TutorQualityTurn, TutorQualityEvaluationOptions, TutorQualityTranscript, TutorQualityEvaluationReport, and runTutorQualityEvaluation. Its injectable artifactWriter is the seam for preserving Stage-2A artifacts before semantic consumption. The existing CLI exports readTutorQualityGitState and uses KiconnectProvider; the new Stage-2B CLI should reuse these only as appropriate and should not call the Stage-2A CLI as an alternate runner.

The current LLMProvider.generateLearningQuestion operation returns TutorContentResult, which is intentionally narrower than a Judge result. Milestone 2 must first add an additive structured-response operation at the existing provider boundary, implemented by KiconnectProvider through its existing transport/error/timeout path. Keep generateLearningQuestion behavior and TutorService call sites stable; do not make the Stage-2B Judge call through TutorService or parse a Judge payload as TutorContentResult.

### Proposed Stage-2B module contracts

Names below are implementation-plan interfaces for review; exact code remains for the implementation PRs.

- parseSemanticCorpus(input: unknown, references: SemanticCorpusReferences): SemanticCorpus — strict parse, referential validation, and stable digest; reject duplicate IDs, invalid roles/exposure, unresolved sketch/Course Content references, and an answer not bound to the exact preceding question.
- validateFrozenPreTurnContext(input: unknown): FrozenPreTurnContextValidation — verify immutable component digests and exact ordered prior history/question/answer association; return invalid with a reason rather than repairing or guessing.
- toStage2AScenario(corpus: SemanticCorpus, semanticCase: SemanticCase, fixtures: SemanticFixtureResolver): TutorQualityEvaluationScenario — pure mapping only. Use the semantic corpus ID/version as source identity in the generated Stage-A scenario, stable case ID as scenario ID, and the exact case sketch/context/turns. Do not attach Judge, rubric, Human Reference, role, or exposure metadata to Stage 2A.
- validateStage2ATranscript(input: unknown, expectedCase: SemanticCase): Stage2ATranscriptValidation — require schemaVersion tutor-quality-transcript-v1, transcript digest, compatible case/scenario identity, exact synthetic turn binding and sketch digest, and execution status. A non-completed transcript stays not-evaluated for tutor-quality semantics.
- buildJudgeEvidence(semanticCase: SemanticCase, transcript: TutorQualityTranscript): JudgeEvidence — construct only named evidence fields; use finalTutorResult, not rawProviderResult; omit Tutor/Candidate/provider model identity, prompt request, credentials, arbitrary metadata, Human outcomes, and other candidates.
- validateAbsoluteJudgeResult(input: unknown, evidence: JudgeEvidence, rubric: RubricDefinition): AbsoluteJudgeResult — strict versioned shape, all required dimensions, known issue codes, evidence citation resolution, explicit abstention, and proof requirements for each critical failure.
- evaluateSemanticSample(transcript: TutorQualityTranscript, judge: JudgeConfiguration, corpus: SemanticCorpus): Promise<SemanticSampleEvaluation> — no call if Stage-A executionStatus is not completed; preserve Stage-A axes byte-for-byte/semantically unchanged; return one Stage-B sample artifact.
- assessComparability(manifest: BenchmarkManifest, baseline: VariantManifest, candidate: VariantManifest): ComparabilityAssessment — deterministic from declared and resolved fields only; never inspect semantic scores/Judge verdicts.
- canonicalSemanticEvaluationIdentity(manifest: SemanticEvaluationManifest): string — canonical digest with sorted duplicate-free unordered sets and linked records, preserving order where it is meaningful.

### Stage-2B-only corpus and first-case data

Create evals/tutor-quality/semantic-corpus.yaml and keep its schema/parser separate from evals/tutor-quality/anchor-corpus.yaml. Add pinned, minimal Stage-2B-owned sketch fixtures only where the exact sketch is not already present as a tracked repository fixture. At minimum, TQ-SEM-001 needs the supplied INPUT_PULLUP sketch. Prefer self-contained fixtures and digests over a runtime dependency on the sibling UnoSim-Examples checkout.

The TQ-SEM-001 Tutor turn is a dialog turn whose question is the declared logical-condition question and whose synthetic answer is exactly “buttonPin, also an PIN2 muss GND anliegen!”; bindsToQuestion must equal that exact declared question. Its factual reference may state only reviewed claims needed for the case: INPUT_PULLUP configures an internal pull-up; a grounded button-to-GND condition reads LOW; the sketch tests digitalRead(buttonPin) == LOW and writes HIGH to LED_BUILTIN. Reviewers must explicitly approve wording equivalence and any board/hardware assumptions. The Judge sees the reviewed facts as factual evidence, never the hidden human verdict or desired candidate outcome.

TQ-SEM-002 through TQ-SEM-005 require their concrete sketches, exact question/answer turns, ordered history, Course Content/Strategy context or explicit absence, relevant facts, and assessable dimensions to be frozen before they can run. Do not fill missing observations by guessing from case names. The current UnoSim checkout does not establish all those exact inputs. Treat their rows below as case-intent/review checklists, not executable corpus records, until the source artifacts and human-reviewed turns are supplied and pinned; sibling-example sketches may be used only after confirming they are the intended exact cases. Otherwise create minimal reviewed Stage-2B fixtures. This input-completeness dependency is DG-14 and does not block the complete TQ-SEM-001 vertical slice.

## Initial Semantic Case Matrix

The case IDs and semantic intents below come from the Stage-2B SSOT. The five manually observed cases are known/exposed material, not a held-out set. The suggested initial development role is not a final governance policy. Only cases with complete, pinned inputs enter an executable corpus version; none is a Gold Case until its factual interpretation and human labels have the required review.

| Case | Frozen Pre-Turn Context / answer category | Primary dimensions | Potential issue patterns (Judge must prove consequence) | Required factual reference and human confirmation | Recommended initial role / exposure |
| --- | --- | --- | --- | --- | --- |
| TQ-SEM-001 INPUT_PULLUP | Supplied sketch/digest, exact preceding logic-condition question, exact learner answer above, ordered history (initially empty unless an actual predecessor is declared), course/strategy state or explicit free-Tutor state; fully-correct answer | Factual correctness, grounding, learner diagnosis, precision | Critical correct-answer-rejected or false-sketch-claim only with claim/evidence/materiality; major misdiagnosis; harmless paraphrase is not a failure | Reviewed INPUT_PULLUP-to-GND/LOW derivation, exact sketch branch, acceptable paraphrases, question/answer interpretation, and hardware boundary | development; case-known/outcome-exposed, and used-for-targeted-change for any Candidate tuned from this observed failure; never held out |
| TQ-SEM-002 millis()/delay() | Exact timing sketch, preceding question and correct learner answer, full bounded preceding turn order and same phase/difficulty; fully-correct answer | Diagnosis, instructional usefulness, scaffolding, progression, difficulty | Major needless strictness or follow-up with no new reasoning; minor over-demand that does not mislead; critical only if feedback teaches a material false fact | Exact sketch behavior and reviewed millis/delay blocking/timing facts; human review defines what counts as a real new reasoning demand rather than preferred wording | development; case-known/outcome-exposed; mark targeted-change separately per Candidate |
| TQ-SEM-003 lastReport | Exact declaration/assignments/use of lastReport, prior question/answer and history showing what “last” stores, application context/difficulty; partial or terminology-confusion answer according to reviewed reference | Grounding, diagnosis, precision, usefulness | Major if “time” removes timestamp/event meaning and induces a false mental model; minor if local shorthand is harmless; critical only if materially false | Derive timestamp meaning from the concrete assignments/operations; reviewer confirms intended contrast between timestamp and elapsed duration | development; case-known/outcome-exposed; mark targeted-change separately per Candidate |
| TQ-SEM-004 unsigned long/millis/overflow | Exact type/declaration and millis use, preceding answer, earlier timing question(s) and ordered answers so semantic repetition is assessable, phase/Strategy/difficulty; strong/correct answer | Precision, grounding, progression, non-repetition, difficulty | Major type imprecision that teaches the wrong type or repeated reasoning after demonstrated understanding; minor harmless shorthand; critical only for materially false type/overflow claims | Reviewed type of millis return, unsigned-long semantics, wraparound and safe elapsed-time reasoning as used by the actual sketch; human review confirms progression target and acceptable transfer | development; case-known/outcome-exposed; mark targeted-change separately per Candidate |
| TQ-SEM-005 matrix int/byte | Exact matrix declaration, indexing/use, prior question/answer and ordered history, Course Content/Strategy context or explicit absence; terminology-confusion or misconception answer as human-reviewed | Diagnosis, factual correctness, grounding, precision, difficulty | Major false diagnosis or important type misconception left intact; critical only when a materially false type/range claim is taught or a correct answer is rejected; minor terminology compression otherwise | Reviewed exact declarations and target platform type/range facts; human review distinguishes the actual misconception from harmless phrasing and records platform assumptions | development; case-known/outcome-exposed; mark targeted-change separately per Candidate |

Initial role proposal: recommend development for all five observed intents, but corpus version 1 contains only fully specified executable records (initially TQ-SEM-001); do not fabricate TQ-SEM-002..005 records to satisfy the list. Do not assign any observed case held-out-evaluation or calibration status. Their observations are already known and may have informed design. Record exposure per Candidate, rather than laundering the shared observation into a global “unexposed” label. A future calibration set should be explicitly reviewed and frozen before Judge outcomes; a future held-out set should consist of new cases not used for targeted changes. Both require the governance decisions in DG-7 and versioned role/exposure history. Until reviewers approve all required labels and evidence, set Human Reference state to pending/unreviewed and exclude the case from Gold calibration claims.

## User Interface and Call Model

### Minimal CLI shape

The one-sample Stage-2B command should have two explicit modes:

- Primary generation mode: select semantic case IDs, one fixed Tutor model, one fixed Judge model, requested Tutor samples, separate Tutor/Judge credential environment-variable names, finite Tutor/Judge/total-call budgets, and a caller-selected output directory. Translate cases with the adapter, invoke Stage 2A, persist its report/transcripts, then load those transcript files by digest and run absolute evaluation.
- Secondary ingestion mode: accept one or more Stage-2A transcript paths/run directories plus Semantic Case IDs, fixed Judge model, Judge credential environment-variable name, finite Judge/total-call budgets, and output directory. Validate compatibility and evaluate without invoking the Tutor or reading Tutor credentials.

Proposed flag contract (exact spelling remains an implementation detail to review, not a normative SSOT decision):

| Purpose | Proposed flags / input |
| --- | --- |
| Corpus and case selection | --corpus {semantic-corpus-path}; repeated --case {stable-case-id}; ingestion instead accepts --transcript {path} or --transcript-dir {path} |
| Tutor variant | --tutor-model {fixed-id}; benchmark mode later uses one --baseline-model {fixed-id} and repeated --candidate-model {fixed-id} |
| Judge configuration | --judge-model {fixed-id}; required output-affecting Judge parameters are explicit manifest/CLI inputs and recorded |
| Credentials | --tutor-credential-env {ENV_NAME} only in generation mode; --judge-credential-env {ENV_NAME}; no credential-value argument |
| Sampling | --samples-per-case {positive-count}; benchmark mode rejects a single sample as a repeated-sampling benchmark but makes no inferential sufficiency claim |
| Safety budgets | --max-tutor-calls {finite-count}, --max-judge-calls {finite-count}, --max-total-calls {finite-count}, plus bounded retries only if a separately versioned retry policy is enabled |
| Artifacts | --output-dir {caller-selected-path}; Stage-A and Stage-B output remain separate and Stage-A files are never overwritten |
| Claim mode | No user flag can mark a run calibrated/trusted; exploratory/calibrated eligibility is derived from calibration identity/status and scope, while comparison claims are derived from the recorded per-comparison status and any approved analysis policy |

Later benchmark mode adds selected cases, samples-per-case, declared varied/controlled fields, documented confounds, Judge configuration, and separate stage/total budgets. Reject auto, aliases, duplicate IDs, free-form credential values, missing limits, missing case bindings, and unknown cases before any provider call. Do not use comma-separated parsing if it cannot unambiguously preserve fixed model IDs; repeated flags or a versioned manifest are preferable.

The report/artifact directory should contain distinct stage-2a and stage-2b subdirectories. Stage-2A artifacts are written first and never modified by Stage 2B. Stage-2B artifacts include semantic-sample evaluations and a human-readable report. Benchmark mode later adds manifests, pairwise artifacts, and aggregate reports. Exploratory/calibration status is derived from the recorded Judge configuration and calibration identity, not a user-selectable “trusted” switch.

Add a new package script name eval:tutor-quality:semantic for one-sample generation/ingestion and a separate eval:tutor-quality:benchmark only in Milestone 4. Do not change test, test:unit, test:tutor-quality, normal build, or CI triggers to run a real provider. Keep a fake-provider/manual CLI test in the existing tests/server/services/tutor/evaluation/ tree. Add a workflow only with workflow_dispatch and separate secrets for Tutor and Judge credentials; no pull_request, schedule, required-check, or production-selection workflow.

### Call and cost model

Let V be Tutor variants, C selected Semantic Cases, S requested Tutor samples per case/variant, and T the provider-backed turns per Stage-A sample. Then requested Tutor sample units are V × C × S. Stage-A Tutor-provider calls are not the same as sample units:

TutorCalls = L_preflight + (V × C × S × T × (L_turn + G_turn)) + R_tutor

L_preflight is the count of Stage-2A model-list/preflight calls across Stage-A invocations; L_turn is the existing TutorService fixed-model availability lookup per provider-backed turn; G_turn is Tutor generation per turn; R_tutor is the bounded retry call count, if retries are later supported. Use actual Stage-2A report counts as source of truth and recalculate if that code changes.

For V=5, C=5, S=3, and one Tutor turn per sample: 75 Tutor sample units and (assuming all execute) 75 generation calls. In the current Stage-2A runner shape, five Stage-A runs (one batched run per Tutor model), each with one preflight model-list call and one TutorService model-list call per sample turn, produce 5 + 75 = 80 model-list calls and 155 total Tutor-provider calls before retries. This arithmetic is illustrative, not a new Stage-2B limit; the persisted Stage-2A report must govern observed counts.

Let A be the number of eligible completed Stage-A transcripts (at most V × C × S), P be matched Baseline/Candidate sample pairs, L_judge be Judge model-list/preflight calls, and R_judge be retries. Under one baseline paired separately with each of V−1 Candidates, P = C × S × (V−1), subject to eligible matching pairs. JudgeAbsoluteCalls = A, JudgePairwiseCalls = P for one order, or 2 × P for pair-balanced A/B plus B/A presentations. JudgeCalls = L_judge + JudgeAbsoluteCalls + JudgePairwiseCalls + R_judge.

In the illustrative 5/5/3 setup, with all 75 Tutor samples eligible: absolute only is 75 Judge generations (plus explicit L_judge/retries); absolute plus one pairwise order for baseline-vs-four-candidates is 75 + 60 = 135 Judge generations; pair-balanced A/B and B/A is 75 + 120 = 195 Judge generations. These Judge generations do not include the separate model-list/preflight count. Total external calls are TutorCalls + JudgeCalls, including all model-list, retry, and generation calls.

The largest linear cost terms are more samples/cases/models and absolute Judge calls; pairwise comparison grows with number of baseline-candidate pairs and doubles under two-order balancing. All-pairs comparison among every Tutor model would instead use C × S × V × (V−1) / 2 unique pairs before order balancing. Never estimate money from call counts; report provider-supplied token/cost data or unavailable. Quality/Cost normalization remains blocked by DG-9.

## Reviewable Implementation PRs

Every PR below is a future implementation unit, not work authorized by this planning task. Each PR gets focused red/green tests, a reviewable diff, and its own commit. No real provider call occurs in CI. The plan intentionally reaches a first useful absolute-evaluation slice before multi-model benchmarking.

### PR 1 / Milestone 1 — Semantic contracts, Corpus, and Stage-2A adapter

**Goal:** Load and validate Stage-2B-owned Semantic Cases, freeze and digest context/evidence, translate one case into the existing Stage-2A scenario type, and validate existing Stage-2A transcript compatibility. No external Judge or Tutor calls in tests.

**Scope:** Semantic Corpus schema, one complete executable TQ-SEM-001 record and needed pinned fixture, a non-executable intent/review matrix for TQ-SEM-002..005, roles/exposure state representation, evidence source typing, Frozen Pre-Turn Context validation, Stage-2B status/artifact base types, canonical digest/evolution checks, adapter, transcript ingestion contract.

**Excluded:** Judge, human-calibration result, benchmark loop, pairwise, scoring/weights, ranking, changing the Stage-2A anchor corpus/parser/runner/CLI, real-provider execution, and declaring any case Gold before review.

**Files:** Create server/services/tutor/evaluation/semantic/semantic-corpus.ts, frozen-context.ts, stage2a-adapter.ts, stage2a-transcript.ts, semantic-types.ts, evals/tutor-quality/semantic-corpus.yaml, and the minimal evals/tutor-quality/semantic-fixtures/TQ-SEM-001-input-pullup.ino, plus matching files under tests/server/services/tutor/evaluation/semantic/. Add TQ-SEM-002..005 fixtures/records only after DG-14 inputs are complete. Reuse Stage-A types and the anchor-corpus parser as a structural precedent only; do not modify them.

**Interfaces:** Produce parseSemanticCorpus, semanticCorpusDigest, validateFrozenPreTurnContext, toStage2AScenario, and validateStage2ATranscript as defined above. Corpus v1 includes complete executable records only (initially TQ-SEM-001), with versioned source/factual evidence metadata, draft Human Reference state, assessable-dimension declarations, answer category, known patterns, case role, and per-Candidate exposure schema. Keep the remaining reserved case intents in the review matrix until DG-14 inputs are complete. Scale outcomes remain references to a versioned rubric definition; do not create an ordinal scale in this PR.

- [ ] Write failing parser tests for corpus ID/version/digest, stable unique IDs, all required case fields, source/evidence types, exact bindsToQuestion, selected fixture existence/digest, Course Content reference/explicit absence, and rejection of unsupported role/exposure values.
- [ ] Run focused semantic-corpus tests and confirm failures identify the missing parser/validator contract.
- [ ] Add strict corpus types/parser/digest/evolution comparison; require a semantic version increase when parsed case, reference, role, or exposure changes; formatting-only input may retain version only if canonical parsed content/digest is unchanged.
- [ ] Add Frozen Pre-Turn Context tests for identical ordered prior turns, same exact question/answer binding, sketch/course revision digest, and rejection instead of repair when any variant context differs.
- [ ] Add adapter tests asserting generated TutorQualityEvaluationScenario/TutorQualityTurn carries the exact case ID, corpus ID/version, sketch reference/content, answer, question binding, ordered history, difficulty, and Course Content state; assert no Stage-2B rubric, human label, Candidate, role, exposure, or Judge metadata is attached.
- [ ] Add transcript-ingestion tests for valid Stage-A schema/digest, mismatched sketch/case/binding/evaluation identity, malformed schema, and non-completed executionStatus; assert invariantViolations are preserved, not translated.
- [ ] Add one complete runnable TQ-SEM-001 corpus-v1 development record with Human Reference pending review. Keep TQ-SEM-002..005 as non-executable intent/review entries until DG-14 is met; never use incomplete placeholders as benchmark cases. Do not claim any case is Gold or uncontaminated held-out evidence.
- [ ] Run focused semantic tests and existing anchor-corpus tests. Confirm evals/tutor-quality/anchor-corpus.yaml and Stage-A code are unchanged.
- [ ] Review and commit PR 1 only after corpus role/exposure proposal and any unresolved case facts are explicitly presented for human review.

**Acceptance criteria:** Invalid bindings/context fail before a Stage-A provider call; generated Stage-A types are consumed without runtime-path duplication; Stage-A `expected` remains structural-only; existing transcripts can be admitted only if compatible and will never be rerun; Stage-A axes remain unchanged; corpus digest/version and exposure are reproducible.

**Risks:** Mapping Course Content/history incorrectly; treating five known cases as Gold; Stage-A identity not capturing an adapter input change. Mitigate with a stage2B corpus ID/version source identity, explicit case digest in Stage-B identity, exact input assertions, version evolution tests, and rejection of unresolved inputs.

**Depends on:** Approved Stage-2B SSOT and the user's Stage-2A Case Adapter decision (already supplied). DG-7 governance decisions are required before future held-out claims, not before this development-only schema/corpus foundation.

### PR 2 / Milestone 2 — One absolute Judge evaluation and first useful vertical slice

**Goal:** Evaluate one completed Stage-A transcript against one versioned case with one fixed real Judge, validate a schema-owned absolute result, write a secret-free semantic artifact, and render an evidence-first human-readable report.

**Scope:** Additive structured-response operation on existing provider boundary; Judge prompt/configuration identity; allow-listed evidence; strict result validation; absolute evaluation; Judge call-budget accounting; single-case semantic CLI with primary adapter-generation mode and secondary existing-transcript ingestion; manual-only real-Judge smoke workflow/operator instructions.

**Excluded:** Pairwise, multiple models, automated calibration claims, numeric confidence, weights, sample-level ranking, production changes, Judge access to raw Stage-A result, or learning-effect claims.

**Files:** Create semantic/judge-provider.ts, judge-prompt.ts, judge-evidence.ts, judge-schema.ts, absolute-evaluation.ts, semantic-artifact-writer.ts, human-report.ts, scripts/tutor-quality-semantic-eval.ts, tests/server/services/tutor/evaluation/semantic/judge-*.test.ts, semantic-evaluation.test.ts, semantic-cli.test.ts, docs/tutor-quality-stage-2b-operator.md, and .github/workflows/tutor-quality-semantic-eval.yml. Modify server/services/tutor/llm-provider.ts additively, server/services/tutor/kiconnect-provider.ts to implement structured output using its existing transport/error/timeout path, package.json add only the optional semantic CLI script, and tests/server/services/tutor/kiconnect-provider.test.ts for unchanged Tutor behavior plus structured responses.

**Interfaces:** Structured output returns declared fixed model metadata plus an untrusted parsed JSON value; Judge provider requests record all output-affecting parameters. JudgeConfiguration binds fixed model/provider, prompt revision/digest, parameters, rubric/schema/evidence-policy versions, credential environment-variable name (never its value), and calibration identity/status. SemanticSampleEvaluation references Stage-A evaluationIdentity and canonical transcript digest, stores its unchanged executionStatus/invariantViolations, semanticEvaluationStatus, independent rubric results, issues/critical failures, Judge metadata, citations, time, and calls.

- [ ] Write failing tests for structured provider success, malformed JSON, provider error/timeout, returned-model missing/mismatch, fixed-model preflight, and continued byte-compatible existing Tutor parsing/repair behavior.
- [ ] Run provider tests and confirm the existing Kiconnect path tests remain green apart from the intended new failure.
- [ ] Add the additive structured result/request boundary and reuse KiconnectProvider transport, timeout, credential, and error mapping; do not create a Judge-specific fetch/client.
- [ ] Write failing evidence tests asserting finalTutorResult is supplied while rawProviderResult, provider request prompts, Tutor/Candidate/provider model identities, human labels, other candidates, environment, and headers are absent; assert only declared factual references and provenance labels enter evidence.
- [ ] Implement strict Judge evidence construction and evidence-location IDs; map all citations back to present case/transcript/reference fields.
- [ ] Write failing schema tests for each required rubric dimension, assessed/not-assessable/abstained states, unknown fields/codes, missing/invalid evidence citations, malformed status, unsupported confidence, missing abstention reason, and each Critical Semantic Failure lacking its claim + contrary evidence + materiality rationale.
- [ ] Implement the application-owned versioned output schema and status transitions. Preserve uncertainty in rationales/abstention/missing-evidence records without inventing a numerical confidence scale; substantive outcome labels must come from the loaded rubric version.
- [ ] Write failing absolute-evaluation integration tests with a fake Judge for a correct INPUT_PULLUP answer, a supported correct-answer-rejected claim with cited evidence, an unsupported critical claim that must abstain, invalid Stage-A status that gets not-evaluated without Judge call, and Judge technical failure.
- [ ] Implement evaluateSemanticSample with bounded Judge accounting; do not alter Stage-A artifacts. Compute identity from the Stage-A immutable identity/digest plus corpus/case/context/reference and Judge/rubric/schema/evidence-policy metadata.
- [ ] Write CLI tests for both modes: generation mode calls the existing Stage-A runner exactly once per requested Tutor run and consumes its written transcript by digest; ingestion mode calls it zero times. Both reject auto, secret values, invalid IDs, missing finite limits, and unknown cases before provider calls.
- [ ] Implement a caller-selected output tree with separate stage-2a and stage-2b artifacts. Add a manual-only workflow_dispatch job with separate Tutor/Judge credential secrets and bounded artifact retention; no pull_request/schedule/required-check trigger.
- [ ] Run focused fake-provider tests and the existing test:tutor-quality suite. Run the real Judge smoke manually only after DG-1 rubric scale, DG-10 hard limits, and the operator has supplied fixed model IDs/credentials; record it as exploratory with calibrationStatus uncalibrated until policy says otherwise.
- [ ] Review/commit PR 2. Do not call a real provider from unit tests, CI, or this planning task.

**Acceptance criteria:** A completed Stage-A transcript becomes one schema-valid semantic artifact and human report; a known-good interpretation is allowed; a supported correct-answer-rejected issue can be represented with concrete evidence; missing evidence causes abstention/not-assessable; Stage-A statuses/invariants remain untouched; Judge identity and cost/call metadata are recorded; no candidate or hidden Human verdict reaches the Judge.

**Risks:** Current LLMProvider is Tutor-schema-specific; a transport refactor may regress Tutor behavior; Judge output may be fluent but invalid or unsupported. Mitigate with additive interface, shared transport, regression tests, strict parser, evidence citation checks, bounded retries only if separately declared, and human audit.

**Depends on:** PR 1 plus DG-1 rubric scale, DG-10 finite call limits, and review of the structured-output provider contract. No validated ranking/calibrated status is required for FIRST_USEFUL_STAGE_2B.

### PR 3 / Milestone 3 — Human Reference and calibration evidence

**Goal:** Compare Judge observations with privacy-preserving, reviewed Human References and produce scoped calibration evidence without inventing thresholds.

**Scope:** Human Reference schema/review provenance, disagreement/adjudication records, calibration identity, default uncalibrated state, agreement report with assessable counts and error categories, human challenge/correction as a new versioned artifact.

**Excluded:** Silent majority adjudication, post-hoc reference tuning for a preferred ranking, automatic calibrated/provisional transition without a predeclared policy, public ranking, or model-specific prompt tuning.

**Files:** Create semantic/human-reference.ts, calibration.ts, calibration-report.ts and tests/server/services/tutor/evaluation/semantic/human-reference.test.ts and calibration.test.ts. Extend the Stage-B corpus/reference fixture only through a versioned semantic corpus/review update; do not alter Stage-A corpus.

**Interfaces:** HumanReferenceSet binds case ID/revision, evidence digests, rubric version, privacy-preserving reviewer provenance, independent review status, disagreement and adjudication notes, and approved labels. CalibrationArtifact binds Judge calibrationIdentity, Human Reference set identity, immutable Judge artifact digests, per-dimension/severity/critical/abstention agreement and disagreement counts, and classified disagreement reasons. Reports carry calibrationStatus independently of semanticEvaluationStatus.

- [ ] Write failing reference-schema tests for unreviewed/disputed/adjudicated states, provenance without personal identifiers, evidence/rubric/corpus version mismatch, missing critical-label independent review, and attempted in-place mutation.
- [ ] Run reference tests red; add the Human Reference parser/validator and immutable digest contract.
- [ ] Write failing calibration tests for all SSOT disagreement classes, assessable denominators, Judge abstention agreement, critical-failure agreement, incompatible calibration identities, and correction creating a new artifact.
- [ ] Implement descriptive calibration comparisons only. Initial status is uncalibrated. Do not hard-code sufficiency thresholds or label any Judge configuration calibrated while DG-3/DG-12 are open.
- [ ] Add human report disclosure for Judge configuration status/scope, human disagreements, uncovered dimensions/failure types, and case exposure.
- [ ] Run fake-reference/calibration tests and existing tutor-quality regression suite; do not call a provider.
- [ ] Review/commit PR 3 as an exploratory calibration-foundation PR, with Gold eligibility only for references actually reviewed under the agreed process.

**Acceptance criteria:** Calibration evidence can be audited and reproduced; no numerical or categorical pass threshold is invented; initial five cases remain development and non-Gold until review; corrections do not rewrite published artifacts.

**Risks:** Human label inconsistency and Judge overfitting. Mitigate with independent review for critical labels, versioned disputes/adjudication, blinding, fixed rubric/Judge identity, and explicit unknown/disputed states.

**Depends on:** PR 2; DG-12 before contested Human References are admitted as truth; DG-3 before provisional/calibrated status transitions or any validated comparison claim. If gates remain open, the deliverable is descriptive calibration evidence and uncalibrated status only.

### PR 4 / Milestone 4 — Repeated multi-model benchmark and raw reporting

**Goal:** Run multiple fixed Tutor models from identical frozen cases with repeated synthetic samples, associate Stage-A transcripts with absolute evaluations, and report raw distributions and comparability without a forced ranking.

**Scope:** Versioned Benchmark Manifest, Baseline/Candidate variants, repeated run orchestration through the adapter and unchanged Stage-A runner, aggregate run-wide budgets, per-comparison comparabilityStatus, exposure/contamination, technical reliability, deterministic violation, semantic distribution, latency/call/cost-availability reporting, and benchmark CLI.

**Excluded:** Pairwise judgments, calibrated superiority/ranking, cost-normalized ordering, a significance method, automatic prompt/strategy/model selection, and online feedback.

**Files:** Create semantic/benchmark-manifest.ts, benchmark-orchestrator.ts, comparability.ts, aggregate-report.ts and tests/server/services/tutor/evaluation/semantic/{benchmark-manifest,benchmark-orchestrator,comparability,aggregate-report}.test.ts; create scripts/tutor-quality-benchmark.ts and add only eval:tutor-quality:benchmark to package.json. Existing Stage-A runner, Stage-A CLI, anchor-corpus.yaml, and normal CI workflow remain unchanged.

**Interfaces:** BenchmarkManifest explicitly names Baseline and Candidates, intended varied factor, controlled fields, permitted confounds, corpus/case selection, sample counts, Tutor/Judge configurations, protocol versions, exposure records, and each hard cap. The orchestrator invokes runTutorQualityEvaluation once per Tutor variant/run with scenarios from toStage2AScenario, writes Stage-A artifacts first, then loads them by digest for semantic scoring. A run-wide provider budget decorator bounds cumulative Stage-A plus Judge calls while the Stage-A runner continues enforcing its own per-run budget. Comparability is derived only from manifest/resolved identity evidence.

- [ ] Write failing manifest tests for fixed unique model IDs, exactly one declared single varied factor (or explicit multifactorial design), frozen context match, version digests, per-case exposure, explicit confounds, duplicate-free canonical sets, and finite declared budgets.
- [ ] Write failing fake-provider orchestration tests proving each model receives the exact same case inputs, every sample gets fresh Stage-A execution, Stage-A runner remains the sole Tutor caller, immutable Stage-A artifacts precede Judge calls, and cumulative budget stops before the next external call.
- [ ] Write failing comparability tests for fully-comparable, documented qualified-comparison, and undeclared/missing identity invalid-comparison. Assert semantic scores and Judge results cannot affect status.
- [ ] Write failing aggregation tests for requested/attempted/valid/semantic counts, Stage-A technical failures, Judge failures/abstentions, unchanged invariant violations, canonical absolute critical failures, per-case/variant denominators, latency, calls, and unavailable cost.
- [ ] Implement repeated orchestration and deterministic raw report. Require explicit samples-per-case; the benchmark mode must request repeated samples (>1) for its MVP, but do not interpret that as the statistical minimum for a superiority claim.
- [ ] Add tests that raw report generation never emits a total order or “winner”, and that invalid-comparison remains per comparison while otherwise valid sample statuses remain valid.
- [ ] Run all fake-provider benchmark tests, CLI tests, and existing Stage-1/Stage-2A tutor-quality tests. Keep real model runs manual-only.
- [ ] Review/commit PR 4 with no ranking or statistical superiority language.

**Acceptance criteria:** MODEL_BENCHMARK_MVP raw evidence is reproducible; all variants share frozen context and allocated sample counts; per-comparison status and confounds are explicit; technical reliability, invariant failures, semantic quality, critical failures, latency, calls, and provider-supplied cost remain separate; no forced order.

**Risks:** Cross-model prompt/provider confounds, corpus leakage, cumulative budget bypass, and small samples. Mitigate with predeclared manifests, a shared global call budget, per-Candidate exposure records, case/prompt digest identity, and no superiority claims while policies remain open.

**Depends on:** PRs 1–3, DG-10 before any real multi-model call, and DG-14 before claiming MODEL_BENCHMARK_MVP or including TQ-SEM-002..005 as executable cases. If fewer than two complete reviewed cases are available, defer that MVP marker; do not create placeholder cases. DG-4/DG-5/DG-8 are not required to report raw distributions but are required before any inferential claim or ranked view. DG-7 is required before held-out/generalization claims.

### PR 5 / Milestone 5 — Blinded pairwise evaluation

**Goal:** Add a calibrated absolute-independent comparative observation for matched Baseline/Candidate output pairs while keeping absolute evaluation canonical for critical failures.

**Scope:** Neutral A/B labels, declared randomization/balance seed, paired sample matching, pairwise outcome schema, order-conditioned reports, reversal disagreement, comparative-only potential critical observations, artifact references.

**Excluded:** Using pairwise alone to create a ranking, hiding absolute failures, counting pairwise-only critical observations as canonical, or deciding reversal protocol through code defaults.

**Files:** Create semantic/pairwise.ts and tests/server/services/tutor/evaluation/semantic/pairwise.test.ts; extend pairwise protocol/artifact fields in semantic schemas and report only after a corpus/protocol version change.

**Interfaces:** evaluatePairwise(pair: MatchedTranscriptPair, judge: JudgeConfiguration, order: PairwiseOrder): Promise<PairwiseEvaluation>; output contains transcript digests, neutral labels, actual presentation order, seed/balance-group identity, outcome, comparative evidence, relevant dimensions, potential critical observations, and Judge configuration/calibration identity. Potential critical observations remain a separate family from absolute criticalSemanticFailures.

- [ ] Write failing matching tests for case/context/question-answer/sample-index compatibility and rejection of mismatched or invalid pairs.
- [ ] Write failing fake-Judge tests for all required outcomes, order randomization/balancing and reproducibility, reversed-order disagreement, cannot-determine, and candidate identity blinding.
- [ ] Write failing artifact tests proving pairwise critical observations cannot inflate canonical critical failure counts without a separately referenced absolute evaluation.
- [ ] Resolve DG-11 and version the pairwise protocol before implementation. Implement order generation from recorded deterministic seed or predeclared balanced allocation; do not select the more favorable ordering.
- [ ] Aggregate order-conditioned results without majority coercion; surface unresolved reversal as disagreement.
- [ ] Run fake pairwise tests and all prior deterministic suites; do not use pairwise outcomes to rank a single sample.
- [ ] Review/commit PR 5 independently.

**Acceptance criteria:** The output is a separate pairwise artifact, identities are blinded, order is reproducible/balanced, reversal conflict stays visible, and absolute results remain the sole canonical source for sample-level critical-failure rates.

**Risks:** Position bias and pairing mismatch. Mitigate with neutral labels, pair-balanced order, exact context/sample matching, seed/digest recording, order-conditioned output, and cannot-determine/discordance retention.

**Depends on:** PR 4, calibrated scope if pairwise results are to support claims, and DG-11. Ranking method remains out of scope until PR 6 and its gates.

### PR 6 / Milestone 6 — Final reporting views and conditional ranking

**Goal:** Complete the benchmark report families and, only if the relevant normative gates are resolved, add transparent, versioned non-forced comparison views.

**Scope:** Aggregate model and benchmark reports; uncertainty/interval output under an explicitly versioned analysis policy; not-clearly-distinguishable state; optional Tutor Quality, Quality/Latency, and Quality/Cost views; exposed component results/denominators/calibration/comparability/critical failures.

**Excluded while any required gate is open:** Any automatic ranking, validated superiority, best/winner/improved label, or cost-normalized comparison. If gates remain open, this PR may ship report infrastructure and a clear “ranking not configured/claim not permitted” outcome only.

**Files:** Extend semantic/aggregate-report.ts and human-report.ts; create semantic/statistical-analysis.ts only after DG-5 and a concrete method is approved; create tests/server/services/tutor/evaluation/semantic/statistical-analysis.test.ts and report tests. Modify the Stage-B operator guide for report semantics. Do not change CI gates or production model selection.

**Interfaces:** buildBenchmarkReport(manifest, sampleEvaluations, pairwiseEvaluations, calibrationEvidence, analysisPolicy?) returns component distributions and per-comparison statuses; a ranking view exists only when a fully resolved AnalysisPolicy has method/version, eligibility, uncertainty, multiple-comparison, calibration-scope, critical-failure, comparability, and exposure rules. Partial ordering/equivalence groups are allowed only if DG-8 policy says how; never fall back to an opaque total score.

- [ ] Write failing report tests for separate result families/denominators, calibration identity per Judge configuration, comparability per Baseline/Candidate pair, contamination, uncertainty, selected examples linked to artifacts, and unavailable costs.
- [ ] Resolve DG-3/DG-4/DG-5/DG-8 before any validated ranking; resolve DG-9 before a Quality/Cost view. Keep no-rank reporting valid when one or more policies is absent.
- [ ] Add an analysis-policy schema and tests proving uncalibrated/provisional Judge, out-of-scope calibration identity, invalid-comparison, insufficient repeats, exposure contamination, unresolved uncertainty, or observed critical failures cannot be silently hidden by an aggregate.
- [ ] Implement only the predeclared calculation. Preserve all component distributions, denominators, intervals/method version, critical failure counts and case evidence; show not clearly distinguishable rather than forcing order.
- [ ] Test any permitted view with deterministic synthetic artifacts only; test that missing provider cost prevents only Quality/Cost, not separately supported Tutor Quality/Latency reporting.
- [ ] Run all Stage-B fake tests and existing tests; conduct a final SSOT crosswalk and review. No real provider calls in PR CI.
- [ ] Review/commit PR 6 only for the policy actually resolved; leave unresolved ranking/cost features deferred.

**Acceptance criteria:** Reports explain evidence and uncertainty, retain all required separate result families, and use validated ranking language only when every applicable policy permits it. No one opaque total and no measured-learning-gain claim.

**Risks:** False precision, weight leakage, overclaiming from calibrated-on-development cases, and cost/provider drift. Mitigate with versioned analysis policy, held-out governance, report-visible scope/confounds/denominators, and cost unavailable unless source data/policy exists.

**Depends on:** PRs 1–5. Ranking is conditional on DG-3/4/5/8/10 and relevant scope; Quality/Cost additionally requires DG-9; held-out claims require DG-7; pairwise-based interpretation requires DG-11.

## Decision Gates

Recommendations below are proposals only, not hidden product choices. Any gate that resolves a Stage-2B SSOT Open Question requires an explicit reviewed normative update and associated corpus/rubric/protocol versioning before the affected behavior ships.

| Gate | Needed before | Why | Options | Recommendation (not a decision) | Normative update required? | Can empirical data help? |
| --- | --- | --- | --- | --- | --- | --- |
| DG-1 Rubric scale | PR 2 real absolute Judge evaluation | Strict schema cannot invent substantive labels; corpus may be drafted before then | Ordinal levels; named categorical outcomes; rubric-specific non-ordered categories | Start with a small, human-readable categorical scale per dimension if reviewers can reliably apply it; retain not-assessable/abstained outside substantive outcomes | Yes: rubric ID/version and outcome definitions | Yes: human/Judge disagreement and false certainty on pilot cases |
| DG-2 Confidence representation | Any confidence field or later inferential report; not required for first slice if uncertainty is evidenced by notes/abstention | Prevent false numerical precision | No scalar; ordinal confidence; calibrated probability with validation | No numeric confidence in the first slice; preserve uncertainty notes, evidence limits, and explicit abstention | Yes if confidence representation is added | Yes, only with calibration evidence |
| DG-3 Calibration Policy/thresholds | PR 3 status promotion and all validated ranking/superiority claims | SSOT forbids invented calibration sufficiency | Scope-specific thresholds; policy yielding uncalibrated/provisional/calibrated; no promotion until sufficient evidence | Initially retain uncalibrated; create reports first; set provisional/calibrated only after a predeclared scope-specific policy is reviewed | Yes | Yes: reviewed human references, agreement, failure-type coverage |
| DG-4 Minimum sample sizes | Any claim that compares variants; PR 4 raw MVP can require an explicitly requested repeated count without claiming it is statistically sufficient | One sample is not a benchmark; threshold is open | Fixed minimum by case/type; sequential pilot policy; no claim with current evidence | Keep samples-per-case explicit; raw MVP uses repeated samples but makes no sufficiency claim until set | Yes for normative claim eligibility | Yes: per-case/model variance and execution failures |
| DG-5 Statistical method | Any interval/superiority/inferential view in PR 6 | Needed to quantify uncertainty and multiplicity | Prespecified paired or hierarchical method; descriptive only; bootstrap/permutation options | Preserve raw distributions in PR 4; select one method only after variance/dependence design review | Yes | Yes, with enough pilot observations and declared estimand |
| DG-6 Judge count/diversity | Judge ensemble or aggregate multi-Judge claim; not one fixed Judge in PR 2 | Number and correlation of instruments changes calibration | One fixed Judge; independent Judges; ensemble; adjudicating human | Start with one fixed Judge config per run and attribute identities; do not ensemble until justified | Yes for ensemble aggregation/calibration policy | Yes: disagreement/dependence study |
| DG-7 Held-out corpus governance | Held-out role assignment, generalization claim, or “unbiased” benchmark label | Five observed cases are known/exposed; minimum composition/governance is open | Separate newly authored held-out cases; rotating holdout; governed refresh/versioning | Keep all five initial cases development; create separate later calibration/held-out sets; mark unknown exposure as unknown, never clean | Yes: corpus/protocol role/exposure governance | Yes: leakage audit can inform governance but cannot recover exposure that was never tracked |
| DG-8 Ranking method | Any ordered/ranking view in PR 6 | Avoid forced total order and opaque aggregate | Partial order/equivalence groups; criterion-specific views; no ranking | Prefer component-first partial ordering and “not clearly distinguishable”; no total score unless separately justified | Yes | Yes: variance and multi-case results inform suitability, not the method alone |
| DG-9 Cost normalization | Quality/Cost view | Providers differ in tokens, currencies, cache/pricing schedules | Raw provider-reported cost only; versioned currency/price normalization; omit cost view | Initially report raw cost if supplied and otherwise unavailable; omit normalized Quality/Cost | Yes before normalized view | Yes: actual token/cost telemetry and pricing governance |
| DG-10 Operational hard limits | Before any real Tutor/Judge call (PR 2); revise before larger PR 4/5 runs | SSOT requires hard finite maxima before calls; values are not specified | Fixed safe caps; operator-declared caps bounded by reviewed maxima; environment-specific caps | Choose small finite caps after provider/cost review; enforce Tutor, Judge absolute/pairwise, retries, variants, cases, samples, and total together | Yes for reviewed normative/operational policy values; may be versioned operational policy if SSOT permits | Yes: provider timeout, call, token, and cost evidence |
| DG-11 Pairwise reversal protocol | PR 5 | Same-judge-context vs independent call affects correlated evidence and call budgets | Same Judge with swapped order; independent calls; balanced distinct calls | Use balanced swapped-order presentations with explicitly declared independence/context policy; do not decide inside implementation | Yes: pairwise protocol version | Yes: order effect and Judge stability study |
| DG-12 Contested Human Reference policy | PR 3 before disputed cases contribute calibration truth | Hidden majority can erase substantive disagreement | Preserve disputed; independent adjudication; panel consensus with rationale; retire case | Keep disputed cases out of decisive calibration truth until explicit adjudication; preserve original disagreement | Yes | Yes: reviewer agreement and downstream Judge error analysis |
| DG-13 Tutor/Judge dependence treatment | PR 3 calibration scope and any PR-4/6 comparative claim where models/providers overlap | A shared model family/provider can correlate errors and affect the scope of measurement claims | Report-only risk; calibration stratified by overlap; exclude dependent configurations from a claim; additional independent Judge evidence | Always disclose overlap in artifacts/reports; do not claim independent measurement from family/provider labels alone; decide claim treatment before any superiority claim | Yes for claim eligibility policy; reporting itself is already required | Yes: paired disagreement/sensitivity evidence, not proof of independence |
| DG-14 Exact source inputs for TQ-SEM-002..005 | Before each affected case is executable; before PR 4 can claim its two-case MVP if fewer than two complete cases otherwise exist; all five initial intents must be represented by complete, human-reviewed Gold Cases before comparative claims per SSOT §6.3 | SSOT requires frozen, exact question/answer/history, context, evidence, and reviewed reference; case names alone do not supply these inputs | Confirm the exact intended sketches/questions/answers from user-provided artifacts; confirm an existing tracked fixture is the intended case; or author a minimal Stage-2B fixture with reviewed factual references | Keep only TQ-SEM-001 executable until the remaining inputs are pinned and reviewed; do not infer missing case details. A multi-model report over fewer than the five reviewed Gold Cases may only be exploratory, with no comparative claim | Corpus/protocol version must change when case evidence or expected interpretation is added or changed | Yes: repository/examples lookup can establish whether a candidate fixture exists, but only human confirmation can establish that it is the intended case |

The user's Stage-2A Case Adapter decision is already resolved: keep the B corpus separate; map a B case/context into the existing Stage-A scenario/turn contract; use runTutorQualityEvaluation unchanged; then consume its immutable transcript. Do not add a Stage-2A anchor-corpus extension. The provider payload shape mismatch is a concrete interface task, not permission to add parallel transport: resolve it with an additive structured operation on the existing provider boundary in PR 2. The Stage-2B SSOT's open question about any future non-blocking release policy remains outside all six PRs and needs a separate normative policy if revisited. No planned result becomes a release gate.

No DG-1 through DG-13 policy decision is required before PR 1; the Stage-2A adapter architecture has already been approved. PR 1 must, however, present the proposed development-only initial role/exposure assignment for review, and it cannot label a case Gold or held out. DG-14 gates only execution of TQ-SEM-002..005 and the two-case MVP if fewer than two complete cases are available; it does not block the Stage-2B contract or the TQ-SEM-001 FIRST_USEFUL slice. DG-1 and DG-10 are required before the PR-2 real Judge smoke. DG-3/DG-12 gate calibration status promotion; DG-4/DG-5/DG-8 gate inferential or ranking claims; DG-7 gates held-out/generalization claims; DG-9 gates normalized Quality/Cost; DG-11 gates pairwise evaluation; DG-6 gates any Judge ensemble; DG-13 gates comparative claims affected by Tutor/Judge dependence. Weighting remains excluded unless a separately versioned rubric/analysis decision is approved. These gates may remain open after PR 1 without blocking the first contract/corpus PR.

## Delivery Markers

### FIRST_USEFUL_STAGE_2B

Reached after PR 2 when one versioned TQ-SEM-001 development case has a reviewed factual bundle and frozen/bound context; the Stage-2A adapter produces one completed immutable transcript through the existing runner; a fixed real Judge evaluates the normalized final response through the evidence allow-list; the application validates and writes a secret-free absolute semantic artifact with citations and explicit Critical Semantic Failure/abstention state; and a human-readable report links the Stage-A transcript and all identities. A fake-Judge regression proves both a supported correct-answer-rejected failure and a correct response not falsely rejected. The real Judge smoke is manual, bounded, exploratory, and uncalibrated until policy permits more. This marker makes no Tutor-superiority, ranking, or actual-learning claim.

### MODEL_BENCHMARK_MVP

Reached after PR 4 only when DG-14 is satisfied for at least two fully specified, reviewed executable cases and a declared Baseline plus multiple fixed Tutor model IDs are evaluated from byte/digest-equivalent Frozen Pre-Turn Contexts, with explicitly repeated sample allocation, Stage-A transcripts, one fixed Judge configuration, absolute semantic artifacts, per-comparison comparabilityStatus, and separate raw dimension/critical/invariant/reliability/latency/call/cost-availability results. It is exploratory: no forced total order or superiority claim, and no held-out/generalization claim from the five known cases. A validated ranking is not required for this MVP and remains blocked on calibration/statistical/ranking Decision Gates.

## Test Strategy and Coverage Crosswalk

| Test layer | Planned evidence |
| --- | --- |
| Pure unit | Semantic corpus/schema/version/digest/canonical sorting; evidence allow-list; Frozen Context and bindings; exposure state; transcript compatibility; semantic status transitions; comparability; artifact identity; strict citations/schema. |
| Deterministic Judge behavior | Fake valid Judge; malformed/schema-extending Judge; missing/mismatched model; unsupported/adversarial critical claim; abstaining Judge; provider failure/timeout; bounded budget stop; human reference disagreements. |
| Stage-2A integration | Adapter maps case into current exported Stage-A types; normal runner called once; Stage-A output written and re-read by digest; no TutorService/provider duplicate; existing transcript secondary mode calls Stage-A zero times; status/invariant arrays preserved. |
| Real-Judge smoke | Manual only, one fixed Judge model, reviewed limits, secret via environment-variable boundary, bounded artifact output, no PR/required workflow. Do not simulate smoke success in unit tests. |
| Benchmark | Multiple Tutor identities, identical frozen case inputs, repeated samples, total budget, per-comparison statuses, technical vs semantic denominators, and a hard no-ranking guard when comparison/calibration/statistical policy is ineligible. |
| Regression | Existing tests/server/services/tutor/evaluation/anchor-corpus.test.ts, real-provider-evaluation.test.ts, tutor-quality-real-provider-cli.test.ts, tests/server/services/tutor/kiconnect-provider.test.ts, and the Stage-1 Tutor quality suite remain in place and must continue passing. Add TQ-SEM-001 semantic regression coverage first; add TQ-SEM-002..005 reference tests only after their exact cases are complete under DG-14. Never replace Stage-1 or Stage-2A tests. |

All deterministic Stage-2B test modules live under tests/server/services/tutor/evaluation/semantic/ so the existing test:tutor-quality directory command can discover them without turning any real-provider workflow into a gate. Provider transport regression tests stay adjacent to the existing kiconnect-provider.test.ts. Add test names/assertions per PR before implementation; never contact Kiconnect or another provider from Vitest.

### SSOT coverage self-review map

| Stage-2B SSOT areas | Planned coverage |
| --- | --- |
| §§1–3 purpose, owner boundaries, evaluation unit, frozen context, evidence | Global constraints; PR 1 corpus/context/adapter; PR 2 allow-list; first useful marker |
| §§4–5 rubric dimensions, severity, Critical Semantic Failure | PR 1 schema references; DG-1; PR 2 validator/evidence tests; raw distributions in PR 4 |
| §§6–7 corpus, Gold/roles/exposure, factual bundles, synthetic answers | PR 1 runnable TQ-SEM-001 and intent/review matrix for TQ-SEM-002..005; DG-7/DG-14; no Gold claim until reviewed |
| §8 Judge identity/schema/abstention | PR 2 provider/config/evidence/schema and bounded orchestration |
| §9 absolute/pairwise/reconciliation | PR 2 canonical absolute results; PR 5 comparative-only artifacts and visible disagreement |
| §10 Human Reference/calibration | PR 3 plus DG-3/DG-12; default uncalibrated |
| §11 benchmark design and comparability | PR 4 manifest/per-comparison deterministic status; provider confounds disclosed |
| §12 sampling/uncertainty | PR 4 explicit counts/raw distributions; DG-4/DG-5 for inferential method |
| §13 aggregation/critical/ranking | PR 4 separate counts; PR 6 conditional policy; no opaque score |
| §14 status axes | PR 1 semantic types; PRs 2–4 preserve per-run/Judge/comparison attribution |
| §15 reproducibility/canonical identity | PR 1 corpus/context digest; PR 2 sample identity; PR 4 manifest/run identity; linked-record sorting tests |
| §16 bias/contamination | PR 2 blinding; PR 4 exposure and model-family/provider disclosure; risk table |
| §17 budgets/credentials/retries | PR 2 fixed env-name boundary and Judge cap; PR 4 cumulative provider cap; DG-10 |
| §§18–19 artifacts and human reports | PRs 2–6 versioned artifacts, citations, denominators, report links and disclosures |
| §§20–21 non-goals/future Stage 2C | Global constraints and explicit exclusions in PR scopes |
| §22 terminology | Reuse the normative vocabulary in types/docs; no alternate semantic meanings |
| §23 open questions | DG-1 through DG-14 with gating, options, recommendations, policy-update need, and role for empirical data; weights remain absent by default under §5.3; any non-blocking release policy is explicitly out of scope |

## Risks

| Risk | Prevention | Detection | Reporting |
| --- | --- | --- | --- |
| Judge bias/style preference | Blinded neutral payload; human references describe acceptable ranges, not ideal prose | Calibration by dimension and human challenge | Disclose Judge identity/configuration and known limitations |
| Same-family/provider Judge-Tutor dependence | Record model-family/provider relationship; do not assume independence | Compare calibration disagreements and sensitivity when available | Show overlap adjacent to all reports |
| Benchmark contamination/prompt overfit | Separate development/calibration/held-out roles; version exposure per Candidate; no within-run feedback | Validate exposure history and new identities after targeted changes | Mark used-for-targeted-change/unknown and disqualify held-out claims |
| Held-out leakage | Do not use the five known cases as held-out; gate role changes | Case history/version audit | State case role and exposure per Candidate |
| False Critical Semantic Failure | Require a Tutor claim, contrary allowed evidence, and materiality; human review critical labels | Fake adversarial tests and calibration disagreement review | Separate canonical absolute failures from pairwise observations |
| False Judge certainty / abstention suppression | Explicit abstain/not-assessable; no unreviewed numeric confidence | Missing-evidence, ambiguity, malformed-result tests | Expose abstentions and uncertainty, not as neutral pass |
| Provider/model drift or unresolved alias | Fixed IDs and returned-model validation | Preflight/returned-ID mismatch tests and transcript audit | Mark invalid, never Tutor semantic weakness |
| Cost explosion | Finite per-stage and total caps; dry preflight; cap before each call; bounded retries | Fake call-count assertions and stop-before-exceed tests | Report actual model-list/generation/retry totals and unavailable cost |
| Flaky provider/network | Keep smoke manual; deterministic fake-provider coverage; bounded timeout/retries | Technical failure/status counts | Preserve technical failures in reliability denominator; no low semantic score |
| Pairwise position bias | Neutral labels and pair-balanced A/B/B/A protocol after DG-11 | Order-conditioned outcomes and reversal checks | Show order effects/disagreement |
| Small-sample false precision | Raw distributions first; no default threshold or ranking | Claim eligibility checks | Report requested/evaluable denominators; label exploratory |
| Schema/version drift | Strict versioned allow-listed schemas and canonical digest | Reject unknown fields/codes and incompatible identities | Mark invalid; preserve earlier artifacts and versions |
| Stage-2A duplication | Adapter-only mapping and unchanged runTutorQualityEvaluation; no duplicate transport/service/checks | Tests assert runner invocation count and unchanged Stage-A outputs | Keep Stage-A and Stage-B artifacts/status axes distinct |
| Unsafe artifact/credential leakage | Environment-name CLI input only; writer allow-list and caller-selected bounded output | Secret sentinel tests across artifacts/errors/logging | Report only credentialPresent/config names if allowed, never credential values/headers |

## Final Plan Review and Handoff

- [ ] Confirm the only new tracked file in this planning branch is docs/plan-tutor-quality-stage-2b.md; the protected local ssot/ssot_function_tutor_model_registration.md remains untracked and unchanged.
- [ ] Cross-check all planned requirements against the Stage-2B, Stage-2A, and Stage-1 SSOTs; resolve any conflict in favor of the applicable SSOT.
- [ ] Confirm the Stage-2A Case Adapter is the only primary Tutor-generation path and the old Stage-A anchor corpus/runner/CLI remain untouched.
- [ ] Confirm the first useful marker arrives after PR 2, before repeated multi-model benchmark PR 4; model benchmark MVP arrives after PR 4.
- [ ] Confirm no unresolved Decision Gate was hidden in an enum default, sample count, threshold, weighting, cost model, or ranking algorithm.
- [ ] Confirm each future PR is reviewable, testable with fake providers, and revertible without undoing another subsystem.
- [ ] Confirm no real providers, Tutor prompts/strategies, implementation code, tests, Gold Case records, PR, or Stage 2C work were created as part of this plan task.
- [ ] Run Node 24.20.0 as pinned by .nvmrc when available, then run only npm run check:docs and git diff --check for this documentation-only change.
- [ ] Stage and commit only docs/plan-tutor-quality-stage-2b.md with commit message docs(tutor-quality): plan stage 2b implementation. Do not push or open a PR.

TUTOR_QUALITY_STAGE_2B_IMPLEMENTATION_PLAN_READY_FOR_REVIEW=YES
