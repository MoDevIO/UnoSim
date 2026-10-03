# Tutor Quality Evaluation – Corpus, Execution, Checks, Judge, Report

Status: normative target model for Tutor quality evaluation.
Supersedes: the earlier execution-runner specification and the earlier
semantic-layer design (see the historical glossary entries in §2). Implementation
plan: `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md` (not normative).

> **Target state, not current runtime.** This document partly describes the
> NORMATIVE TARGET STATE of an ongoing migration. The current `main` can
> therefore contain known, temporary deviations. Appendix A lists these known
> deviations and assigns each to a planned PR. No statement in this document
> may be read as claiming that a known, not yet implemented item is already a
> current runtime invariant.

Rules carry stable IDs (for example `R-EXP-1`) so that code, tests, and
reviews can cite them.

## 0. Normative sources and precedence

| Subject | Normative source |
| --- | --- |
| Didactic phases, mastery, deepening, extensions | `ssot_function_definition_LearningQuestions.md` |
| Course Content schemas and loader | `ssot_function_definition_CourseContent.md` |
| Runtime Tutor invariants (Stage 1 PR gate) | `ssot_function_definition_TutorQuality.md` |
| Model registration | `ssot_function_tutor_model_registration.md` (protected; never edited by Tutor-Quality work) |
| Corpus, execution runs, deterministic evaluation checks, Judge, report, verdict | this document |

This document operationalizes the didactic model for tests. If it
contradicts one of the sources above on didactics or runtime behavior, the
other source wins and this document must be corrected.

## 1. Purpose

The goal is to make Tutor quality testable automatically over the long term.
The system MUST:

1. detect real Tutor regressions;
2. test the central learning strategies (LEARN, DEEPEN, EXPAND) semantically;
3. evaluate real Tutor output;
4. separate deterministic product defects from LLM quality problems;
5. accept new quality cases mostly as corpus data (YAML plus fixtures);
6. produce reproducible, comparable reports;
7. be runnable locally and by manual dispatch without new infrastructure.

Constraint: KISS/YAGNI. The corpus may grow; the runner, Judge, and report
infrastructure should stay stable. A new case MUST NOT require a new runner,
a new check type, or new report code, unless it introduces a new expectation
key under §6.4.

## 2. Glossary

| Term | Meaning |
| --- | --- |
| Case / scenario | One corpus entry: sketch, Course Content fixture, turns, expectations, optional Judge block. |
| Sample | One isolated execution of a case. `samples = n` runs every case n times. |
| Turn | One Tutor request inside a sample: `initial` (new question) or `dialog` (answer to a question). |
| Execution run | One invocation of the evaluation CLI over a set of cases and samples. |
| Deterministic check | A rule evaluated by code on the transcript; no LLM involved. |
| Violation | A failed deterministic check, attributed to a source (§8.2). |
| Judge | The optional minimal LLM evaluator for case-specific criteria and critical issues (§9). |
| `executionStatus` | Whether a sample or run executed; never a quality statement (§11.1). |
| `qualityVerdict` | The quality statement per run: `pass`, `warn`, `fail`, or `inconclusive` (§12). |
| L1 / L2 / L3 | Test-pyramid levels (§4). |
| *Historical:* Stage 1 | Name of the deterministic runtime gate; still the title of `ssot_function_definition_TutorQuality.md`. |
| *Historical:* Stage 2A, "Stage A" | Earlier name of the execution run. Its former SSOT and runbook were removed; the runbook moved to Appendix B. Survives only in artifact identifiers (§11.4) and internal type names; not used in the current model. |
| *Historical:* Stage 2B, Protocol A | Removed semantic layer and its non-reproducible judge protocol. Not normative. |
| *Historical:* Protocol B, G1 | The minimal-Judge protocol and its one-time acceptance measurement (schema ≥ 95 %, evidence ≥ 90 %, repeatability ≥ 80 %), documented in `docs/tutor-quality-judge-smoke-2026-10-01.md`. G1 is bound to the Judge prompt revision it measured; it is not a runtime gate. |

## 3. Architecture

### 3.1 Single evaluation path

There is exactly one evaluation path:

```
Corpus case (evals/tutor-quality/anchor-corpus.yaml)
  → parse + validate (fail fast)
  → per sample: fresh clone of the Course Content fixture and progression state
  → per turn: real TutorService
        → CurriculumTutorAdapter / Planner (when Course Content is present)
        → LLM provider (real in L3, fake in L1)
        → validate/repair → apply planning outcome → commit state
  → transcript (secret-free)
  → deterministic checks
  → optional minimal Judge on the final dialog turn
  → evaluation records
  → report.json + report.md + transcripts
```

No parallel runner, adapter layer, or alternative corpus format exists for
the same purpose. The Stage-1 TypeScript scenarios
(`tests/server/services/tutor/support/tutor-quality-scenario-runner.ts`) have
a different job: they script exact provider outputs to pin runtime
invariants. They are not part of this path and are not merged into it.

### 3.2 Responsibilities

| Component | Owns | MUST NOT |
| --- | --- | --- |
| `TutorService` | validating and repairing provider output, applying the planning outcome, committing progression state only after full success | decide didactics |
| `CurriculumTutorAdapter` / Planner | Topic, Concept, Question, phase, Strategy, progression and blocked state | evaluate natural-language quality |
| LLM provider | feedback text, `answerRating`, proposed question text | own planning metadata (TutorService strips it) |
| Evaluation harness | executing, observing, checking, recording | influence planning, state, prompts, or provider requests |
| Judge | verdicts on observable, quotable, case-specific criteria and critical issues | replace deterministic checks, or judge metadata that only code can see |

**R-ARCH-1** The harness may wrap the provider to count, budget, and capture
calls. It MUST NOT alter requests or responses, and MUST NOT mutate the
Course Content or progression state it passes to `TutorService`, except
cloning per sample.

**R-ARCH-2** Everything the harness reports about a turn comes either from
`TutorService`'s return value, from the captured provider exchange, or from
the progression state after the turn. Nothing is reconstructed from incidental
properties (see §10).

## 4. Test pyramid

| Level | Content | Provider | When |
| --- | --- | --- | --- |
| L1 | Stage-1 runtime invariants; the full corpus executed through the real `TutorService` and `CurriculumTutorAdapter` with a fake provider whose ratings come from the case expectations | fake | every PR (`npm run test:tutor-quality`, part of CI) |
| L2 | contract and parser tests: corpus parser, Judge prompt/parser, call budget, preflight, provenance, redaction, report shape | fake | every PR (same gate) |
| L3 | real Tutor model plus real Judge model over the corpus | real | before merging relevant Tutor/prompt/strategy/planner/adapter/Course-Content changes, locally or by deliberate manual dispatch; no periodic run (Appendix B) |

**R-PYR-1** Every corpus case MUST pass L1 with zero violations before it may
run in L3. A case that fails L1 is a corpus or product defect, not an LLM
finding.

**R-PYR-2** L3 is never a required PR check and never runs on a
`pull_request` trigger. A missing credential yields `not-run`, not a CI
failure.

## 5. Phase model operationalized for tests

Normative didactics: `ssot_function_definition_LearningQuestions.md`.

### 5.1 Two distinct phase observations

| Field | Definition | Source |
| --- | --- | --- |
| `learningPhase` | The phase under which the served Tutor turn was planned and executed. | `TutorService` result (`learningPhase`) |
| `phaseAfter` | The progression-state phase after the learner answer has been processed. | progression state after the turn (`phase`) |

**R-PH-1** The two may legitimately differ. The answer is evaluated by the
strategy that produced the current turn. A phase transition is committed to
state immediately, but its first plan is exposed only at the next request.

**R-PH-2** Allowed `(learningPhase, phaseAfter)` pairs for the same active
Topic: equal; `LEARN → DEEPEN`; `DEEPEN → EXPAND`. Any other pair for the
same Topic is a `state` violation. A Topic change is governed by the normal
Topic-selection rules and checked through `activeTopicId` consistency.

**R-PH-3** A free Tutor (no active Topic) has no phase. A case expecting a
phase MUST use Course Content in which a Topic is active.

### 5.2 EXPAND continuation

**R-EXP-1** An EXPAND extension question generated by the planner MUST be
recognized as a valid EXPAND question when the learner answers it in the
next dialog request.

**R-EXP-2** An answer to such a question MUST NOT end in
`content-exhausted` merely because the generated extension question is not
an entry of `topic.questions`. As long as a sensible transfer question, an
unused extension, or a justified return to a demonstrated gap exists, the
Tutor continues in EXPAND. `content-exhausted` is allowed only when none of
these exists.

**R-EXP-3** This document does not prescribe how the recognition is
implemented. Implementations SHOULD use stable application-owned identity or
progression state where it exists, and MAY fall back to text matching only
where the code demonstrably has no stable identity. The choice is justified
in the implementing PR.

**R-EXP-4** Test fixtures MUST NOT add Course Content questions whose only
purpose is to imitate a runtime-generated question so that a case passes.

## 6. Corpus contract

### 6.1 Location, identity, versioning

- Corpus file: `evals/tutor-quality/anchor-corpus.yaml`, with a stable
  `corpusId` and an integer `corpusVersion ≥ 1`.
- Sketch fixtures live under `evals/tutor-quality/` (or existing
  `tests/fixtures/tutor-quality/` references). Course Content fixtures are
  typed builders in `server/services/tutor/evaluation/anchor-course-content.ts`,
  referenced by a fixture ID, or `free` for the free Tutor.

**R-COR-1** Every change that alters the parsed corpus digest MUST increase
`corpusVersion`. Formatting-only edits that keep the digest MAY keep the
version.

**R-COR-2** Corpus files contain only synthetic learner data. No credentials,
personal data, or live learner data.

### 6.2 Case fields

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`, unique |
| `sketch` | yes | path of an existing fixture file |
| `courseContent` | yes | `free` or a registered fixture ID |
| `model` | no | fixed model ID; never `auto` |
| `turns` | yes | ≥ 1 turn (§6.3) |
| `expected` | no | expectation object (§6.4) |
| `judge` | no | Judge block (§9.6) |

### 6.3 Turns and question binding

```ts
type TurnSource =
  | { kind: "initial"; difficulty?: number }                 // 1..100, default 30
  | {
      kind: "dialog";
      question: string;        // the question the learner answers
      answer: string;          // synthetic learner answer
      continuationOf?: number; // index of an earlier turn in the same case
      difficulty?: number;     // 1..100, default 30
      history?: HistoryEntry[]; // bounded scripted prior dialog
    };
```

**R-TURN-1** A dialog turn with `continuationOf: i` is valid only if `i`
refers to an earlier turn and the final Tutor question actually produced by
turn `i` in this sample equals the dialog turn's `question` exactly.
Otherwise the sample is `invalid` (`preceding-question-mismatch`), and the
runner MUST NOT apply the answer to a different question.

**R-TURN-2** A dialog turn without `continuationOf` answers a scripted
question. It is allowed only where the case does not depend on the planner
having served that question.

**R-TURN-3** Strategy cases (cases with `expected.learningPhase`) MUST bind
their evaluated dialog turn to a preceding turn via `continuationOf`, so that
the planner, not the corpus author, chose the question.

**R-TURN-4** The binding is expressed only by `question` and
`continuationOf`. There is no separate binding field and no second or third
check of the same binding.

### 6.4 Expectations (`expected`)

Allowed keys only. **R-EXPD-1** Any other key in `expected` is a parse
error: no silently ignored typos.

| Key | Type | Scope | Meaning |
| --- | --- | --- | --- |
| `topicId` | Topic ID | every turn | result `topicId` equals it |
| `topicIdAbsent` | Topic ID | every turn | neither result `topicId` nor `activeTopicId` equals it |
| `learningPhase` | `LEARN \| DEEPEN \| EXPAND` | every turn | result `learningPhase` equals it exactly |
| `phaseAfter` | `LEARN \| DEEPEN \| EXPAND` | final turn | progression-state phase after the final turn equals it |
| `answerRating` | `[min, max]`, `1 ≤ min ≤ max ≤ 5` | final turn, must be `dialog` | final `answerRating` lies within the band |
| `progressionBlockedReason` | a `ProgressionBlockedReason` value | every turn | see §6.6 |
| `stateUnchanged` | boolean | every turn | progression state equals the sample's initial state |
| `questionNotRepeat` | `exact-or-heuristic` | every dialog turn | final question is not an exact or heuristic repeat of the answered question or history |

Allowed values for phases and blocked reasons come from the application
types (`DidacticPhase`, `ProgressionBlockedReason`); the corpus parser does
not maintain its own copies.

A case declares one `learningPhase` for all its turns. Cases whose turns need
different phases are out of scope until a concrete case requires them; then
per-turn expectations are the extension point.

### 6.5 Answer rating

**R-RAT-1** `answerRating` is required when:

1. the rating itself is the subject of the case (for example "a wrong
   answer must not be rated as correct"), or
2. `phaseAfter` is checked and the transition depends on the rating.

**R-RAT-2** Enforced by the parser: when `phaseAfter` is declared,
`learningPhase` MUST also be declared, and if `learningPhase` is `LEARN` or
`DEEPEN`, `answerRating` MUST be declared, because progression out of those
phases always depends on ratings.

**R-RAT-3** Pure semantic Judge cases without a progression claim MAY omit
`answerRating`.

**R-RAT-4** A final rating outside the band is a deterministic quality
failure in its own right (cause: rating, §8.2).

**R-RAT-5** If the rating is outside the band, a `phaseAfter` expectation
cannot be interpreted and MUST be reported as *not applicable*, never as
pass and never as a progression failure. Only when the rating is inside the
band (or no band applies) does a `phaseAfter` mismatch count as a
progression failure. The report MUST keep "rating wrong" and "progression
wrong" apart.

**R-RAT-6** L1 fake providers derive their rating from the case's
`answerRating` band (for example its lower or upper bound, fixed per test),
never from incidental prompt content.

### 6.6 Blocked states

**R-BLK-1** On every turn, the observed blocked reason is the result's
`progressionBlockedReason`, or else the progression state's
`progressionBlockedReason`.

**R-BLK-2** If `expected.progressionBlockedReason` is absent, the observed
reason MUST be absent. An unexpected blocked reason is a deterministic
failure (cause: progression).

**R-BLK-3** A case that tests a blocked state MUST declare the expected
reason explicitly. `content-exhausted` must never pass silently in a
strategy case.

### 6.7 Authoring rules

**R-AUT-1** A new quality case is YAML plus, where needed, a sketch fixture.
A new typed Course Content fixture is acceptable when a new progression state
is needed. Tests MUST NOT hard-code the full list of case IDs or the case
count. They assert structural invariants (every case parses; every case runs
L1 without violations; strategy cases reach their declared phase).

**R-AUT-2** Fixtures must be didactically sound. A planned question MUST NOT
rest on a premise the sketch does not satisfy (for example asking how a
variable changes in a sketch where it never changes), unless the case
explicitly tests false-premise handling and says so.

**R-AUT-3** Judge facts describe sketch behavior or didactic context in plain
language. They never contain internal IDs (question, concept, topic IDs).
The Judge cannot see those.

## 7. Execution run

### 7.1 Preflight (fail fast, zero provider calls)

The run is rejected before any provider call, in this order, with these
reasons:

| Status | Reason |
| --- | --- |
| `invalid` | `fixed-model-required`, `fixed-judge-model-required` (empty or `auto`) |
| `invalid` | `git-sha-missing`, `dirty-relevant-worktree` |
| `invalid` | `invalid-sample-count`, `sample-count-exceeds-limit` |
| `invalid` | `invalid-call-budget`, `call-budget-exceeds-limit` |
| `invalid` | `empty-corpus`, `mixed-corpus-versions` |
| `not-run` | `missing-credential`, `missing-judge-credential` (a Judge model is set), `call-budget-zero` |

Then one model-list call: a failure yields `technical-failure`; a missing
Tutor or Judge model yields `invalid` (`model-unavailable`,
`judge-model-unavailable`). Corpus parse errors throw before the run and end
the CLI with a non-zero exit.

### 7.2 Call budget

**R-BUD-1** The runner enforces a hard technical maximum for samples and
calls as a safety guard against misconfiguration. Its value is an
implementation constant, not part of this contract.

**R-BUD-2** Every real (L3) run sets an explicit budget that is much smaller
than the safety guard and is computed before the run starts:

```
budget = 1                                   # preflight model list
       + samples × Σ_cases Σ_turns (tutorCallsPerTurn)
       + samples × (number of cases with a judge block, when a Judge model is set)
```

`tutorCallsPerTurn` is taken from the current code at the time of the run,
not assumed. At the time of writing a fixed-model turn costs up to 2 calls
(model resolution plus generation), and a locally handled off-topic fallback
costs 0.

**R-BUD-3** Every provider call, including model listing and Judge calls,
counts against the same budget. The runner stops before a call that would
exceed it. Model-list, generation, and Judge calls are reported separately.
Judge calls never appear in the per-turn Tutor call counts of a transcript.

**R-BUD-4** Provider and account limits (quotas, rate limits, prices) are
external operating constraints, not part of the Tutor quality contract.
Monetary cost is reported only when the provider supplies it; otherwise the
report states that it is unavailable.

### 7.3 Sample isolation and turn execution

**R-RUN-1** Every sample starts from a fresh clone of the case's Course
Content and progression state. Samples never share state.

**R-RUN-2** Turns of a sample run in order. Per turn:
- `preceding-question-mismatch` yields `invalid` and stops the sample;
- a missing returned model identity yields `invalid`;
- a provider or technical error yields `technical-failure` and stops the
  sample, and the progression state MUST be unchanged by the failed turn.

**R-RUN-3** Provenance per run: Git SHA (clean relevant worktree), corpus ID,
version and file digest, sketch digests, Tutor prompt revision and digests,
requested and returned Tutor model, requested and returned Judge model,
temperatures, timeout, budget.

**R-RUN-4** Credentials are passed only by environment-variable name, never
as values on the command line, and are redacted from every artifact. Tutor
and Judge use separately named credential variables.

### 7.4 Run identity and model identity

**R-ID-1** Every run has a unique `runId` and a stable `evaluationIdentity`,
stored in every transcript and in the report. `evaluationIdentity` is the
SHA-256 of canonical JSON over: Git SHA, Course Content revisions, corpus ID
and version, provider ID, requested Tutor model, Tutor prompt revision (ID and
template digest), and the run parameters (timeout, temperature, sample count,
call budget, per-turn difficulties). The `runId` contains the UTC start time
and a collision-resistant suffix. Its prefix `tq2a-` is a historical artifact
contract (§11.4).

**R-ID-2** The Tutor prompt revision is a versioned application-owned
identifier plus a SHA-256 digest of the effective system and user templates
before scenario values are inserted. A change to an application-owned prompt
template MUST change this revision. Per-turn prompt digests are stored in the
transcripts.

**R-ID-3** A real run requires a clean relevant Git state. Any tracked or
indexed change makes the preflight `invalid` (`dirty-relevant-worktree`) and no
provider call is issued. Untracked files invalidate only under versioned input
roots (`evals/tutor-quality/`, `server/`, `shared/`, `scripts/`, `package.json`,
`package-lock.json`, `.nvmrc`); the output directory, editor files, and
protected local SSOT files are ignored. A diff is never uploaded as a
substitute for the Git SHA.

**R-ID-4** The requested model is fixed, explicit, and never `auto`; the
preflight verifies that exact ID. The provider response MUST carry a
non-empty returned model ID. A provider may resolve a public alias to a
concrete snapshot, so the returned ID need not equal the requested one, and a
difference alone does not invalidate a sample or a Judge result. A missing
returned ID makes the result `invalid`. Both IDs are recorded separately; the
set of returned IDs of a run is inspectable in the report. There is no alias
map and no string-normalization heuristic. The same rules apply to the Judge
model (R-RSP-2).

## 8. Deterministic checks

### 8.1 Checks

Per turn with a provider response (raw provider output, before repair):
schema valid; exactly one primary question; no complete solution; no exact or
heuristic question repeat.

Per turn with a final result: the expectations of §6.4 in their scope;
content revision consistent; phase/state consistency (R-PH-2); active Topic
consistent with state; no reuse of an already used Question ID; blocked state
(§6.6); after a technical failure, state unchanged.

### 8.2 Attribution

Every failed check yields a violation with a `source` and a cause:

| Source | Meaning | Typical cause |
| --- | --- | --- |
| `raw-provider` | LLM raw output before repair | LLM quality, reported as a rate |
| `final-tutor` | final Tutor result after repair and planning | product defect, or LLM rating (`answer-rating-out-of-band`) |
| `state` | progression state | progression defect |
| `scenario` | corpus/case problem | corpus defect |

**R-ATT-1** Rating failures and progression failures are distinct violation
codes and remain distinct in the report (R-RAT-5).

**R-ATT-2** A check that is not applicable (for example `phaseAfter` with an
out-of-band rating) is reported as not applicable. It counts neither as pass
nor as fail.

## 9. Minimal Judge

### 9.1 Scope

The Judge evaluates only:
- the case-specific criteria of the case's `judge` block, and
- a small fixed set of case-independent critical issues.

It is not a rubric system, ranking, calibration, or pairwise comparison.

### 9.2 Eligibility

**R-JDG-1** The Judge runs for a sample only if: a Judge model is
configured; the case has a `judge` block; `executionStatus` is `completed`;
the final turn is a `dialog` turn; its final feedback and follow-up question
are non-empty. Otherwise the record is `not-evaluated` with a reason.

### 9.3 Input

```ts
interface JudgeInput {
  sketch: string;
  facts: string[];
  question: string;        // the answered question
  learnerAnswer: string;
  tutor: {
    feedback: string;
    followUpQuestion: string;
    answerRating?: number;
    learningPhase?: string;
  };
  criteria: { id: string; text: string }[];
}
```

The input contains no internal IDs, provider prompts, credentials, or
runtime identities. Temperature is 0.

### 9.4 Evidence and quotes

**R-EVD-1** Quote allowlist, exactly: `sketch`, `tutor.feedback`,
`tutor.followUpQuestion`.

**R-EVD-2** Not quotable: `facts`, `question`, `learnerAnswer`,
`answerRating`, `learningPhase`, any internal ID, the criterion texts.

**R-EVD-3** The Judge prompt and the parser use one and the same allowlist,
defined once in code.

**R-EVD-4** A quote is valid only if, after NFKC normalization and
whitespace collapsing, it is fully contained in **one** normalized allowed
source. Matches across the boundary of concatenated sources are invalid.

**R-EVD-5** Quote semantics:
- `fail`: a quote is mandatory: a non-empty string from an allowed source.
- `pass` / `unclear`: the quote may be missing, `null`, empty, or
  whitespace-only; all mean "no quote". A non-empty quote is still validated
  against the allowlist. Any other JSON type is invalid.
- Critical issue: a quote is mandatory and validated like a `fail` quote.

### 9.5 Response contract (fail closed)

**R-RSP-1** The response is one JSON object with exactly the keys
`criteria` and `criticalIssues`. Every requested criterion appears exactly
once with `id`, `verdict` (`pass` | `fail` | `unclear`), `reason` (1–600
characters), and `quote` per §9.4. Critical issues use only the codes
`factually-wrong-feedback`, `correct-answer-rejected`,
`invented-sketch-property`, `complete-solution`, `false-premise-question`,
each with `code`, `reason`, and `quote`.

**R-RSP-2** Any violation yields `judge-invalid` with a reason. No retry, no
repair, no partial acceptance. A missing returned Judge model identity is
`judge-invalid`. The requested alias and the returned ID are recorded
separately.

**R-RSP-3** Judge statuses: `evaluated`, `judge-invalid`, `judge-error`,
`not-evaluated`, `budget-exhausted`. Everything except `evaluated` is
inconclusive and never a Tutor failure.

**R-RSP-4** Every change to the Judge system prompt text MUST bump the Judge
prompt revision identifier. Acceptance measurements (G1) are bound to the
revision they measured.

### 9.6 Criteria authoring

A `judge` block has `facts` (≥ 1) and `criteria` (1–6; `id` matches
`/^[a-z][a-z0-9-]{0,63}$/`, unique; non-empty `text`).

**R-CRT-1** A criterion may only evaluate behavior that the quotable
evidence can decide.

**R-CRT-2** No criterion whose failure could only be justified by
`answerRating`, Question ID, Topic ID, `learningPhase`, or other non-quotable
metadata. Such requirements belong in deterministic expectations (§6.4).

**R-CRT-3** Criteria are specific and observable ("the feedback corrects the
assumption that `delay` increments `counter`"), not general ("the feedback
is good").

**R-CRT-4** When the follow-up question in a case is planner-owned (§10), a
criterion about the follow-up question evaluates planner and Course Content
behavior, not the LLM. Authors keep this in mind, and the report shows the
provenance.

## 10. Follow-up provenance

**R-FUP-1** For every turn with a final result, the report states where the
final follow-up question came from:

| Value | Meaning |
| --- | --- |
| `planner` | taken from an application-owned `TutorPlan` |
| `provider` | the provider's question, validated and accepted |
| `application-fallback` | the application replaced the provider question (repeat repair, philosophical/off-topic fallback) |

**R-FUP-2** The provenance is recorded where the application decides which
follow-up question is used (inside `TutorService`) and handed to callers
through `TutorService`'s internal return value. It MUST NOT be inferred from
incidental properties such as "a `questionId` is present".

**R-FUP-3** The provenance is not part of the public HTTP response unless a
separate API specification adds it.

**R-FUP-4** Until the decision site exposes the provenance, the report shows
it as unavailable. A heuristic substitute is not allowed.

## 11. Reporting

### 11.1 Execution status vs quality

**R-REP-1** `executionStatus` (`completed`, `invalid`,
`technical-failure`, `not-run`) describes only whether a sample or run
executed. It is never a quality statement.

**R-REP-2** Quality is expressed by deterministic check results, violations,
Judge records, and the run's `qualityVerdict` (§12).

### 11.2 Required diagnostics

Per sample (and, where marked, per turn), the report MUST let a developer
see:

- case ID, sample index;
- per turn: `learningPhase`, `answerRating`, blocked reason, follow-up
  provenance (or "unavailable"), deterministic checks with outcome
  pass/fail/not applicable, violations with source and code;
- final `phaseAfter`;
- Judge status, per-criterion verdict, reason and quote, critical issues;
- technical errors and invalid reasons;
- provider calls (model list, generation, Judge) and durations.

Per run: requested and returned Tutor and Judge models, corpus
ID/version/digest, Git SHA, Tutor and Judge prompt revisions, temperatures,
timeout, budget and calls used, total duration.

**R-REP-3** `report.md` is ordered deterministically (case ID, sample index,
turn index, check name), so that two runs can be compared with a plain text
diff.

### 11.3 Artifacts

`report.json` (complete, machine-readable), `report.md` (human-readable
diagnosis), and `transcripts/transcript-<case>-<sample>.json`. Artifacts are
disposable run data: written to a caller-chosen output directory or uploaded
as CI artifacts with bounded retention; never committed by the runner. No
database and no dashboard.

**R-ART-1** A transcript contains: schema version, run ID, evaluation
identity, metadata (R-RUN-3), the scenario with its synthetic turns, state
before and after, the ordered turns, deterministic check records, violations,
and a terminal `executionStatus`. Each turn contains the Tutor request artifact
(prompts and their digests, no credentials or transport headers), the parsed
provider result as received by `TutorService` before repair, the normalized
final result, the follow-up provenance (R-FUP-1), the returned model, the
checks, and a technical error if any. Serialization uses an allow-list of
fields. It never includes `process.env`, authorization headers, or arbitrary
provider response envelopes (R-RUN-4).

### 11.4 Stable identifiers

The schema identifiers `tutor-quality-report-v1` and
`tutor-quality-transcript-v1` and the run-ID prefix are artifact contracts.
Additive fields are allowed without a schema bump. Removing or redefining
fields requires a new schema identifier.

## 12. Quality verdict

Evidence for this rule: the real-provider baseline
(`docs/tutor-quality-baseline-2026-10-03.md`) and the remediation rerun of the
repaired strategy cases (`docs/tutor-quality-remediation-rerun-2026-10-03.md`).
In those runs, deterministic application violations never occurred; stable
LLM-dependent findings recurred in 3 of 3 samples across runs; and the same
case with byte-identical prompts showed a finding once in 1 of 3 and once in
2 of 3 samples. Independent single-sample findings were spread over different
cases. The rule therefore counts per case and finding key, never pooled across
cases.

**R-VER-1** Every run report carries exactly one `qualityVerdict`: `pass`,
`warn`, `fail`, or `inconclusive`. It is computed by one central, deterministic
function from the run status, the samples' execution status and violations,
and the Judge records. The verdict carries the rule revision
(`tutor-quality-verdict-v1`), the samples per case `n`, the repeat threshold
`k(n)`, whether a Judge model was configured, and the complete sorted list of
findings that determined it.

**R-VER-2** `inconclusive` covers results that cannot be attributed to Tutor
quality: a run that did not complete, samples that are `invalid` or
`technical-failure`, corpus/case violations (`scenario`), Judge statuses other
than `evaluated`, and Judge verdicts `unclear` that repeat (R-VER-5). Such
outcomes are never reported as Tutor regressions.

**R-VER-3** Findings are counted per **(case, finding key)** over the samples of
that case. A sample counts at most once per key, however many turns or Judge
entries carry it. Findings of different cases or different keys are never
added together.

| Finding class | Finding key | Source | Effect |
| --- | --- | --- | --- |
| product violation | `<source>/<code>` | violation with source `state`, or `final-tutor` with any code except `answer-rating-out-of-band` | `fail` from 1 sample |
| rating out of band | `final-tutor/answer-rating-out-of-band` | R-RAT-4 | LLM-dependent (R-VER-4) |
| raw provider violation | `raw-provider/<code>` | violation with source `raw-provider` | LLM-dependent (R-VER-4) |
| Judge criterion | `criterion/<criterion id>` | verdict `fail` in an `evaluated` Judge record | LLM-dependent (R-VER-4) |
| critical issue | `critical-issue/<code>` | critical issue in an `evaluated` Judge record | LLM-dependent (R-VER-4) |
| unclear criterion | `criterion-unclear/<criterion id>` | verdict `unclear` in an `evaluated` Judge record | R-VER-5 |
| scenario violation | `scenario/<code>` | violation with source `scenario` | `inconclusive` |
| sample not completed | `execution/<status>/<reason>` | sample `executionStatus` `invalid` or `technical-failure` | `inconclusive` |
| Judge not evaluated | `judge/<status>/<reason>` | Judge record status other than `evaluated` | `inconclusive` |
| run not completed | `run/<status>/<reason>` (no case) | run status other than `completed` | `inconclusive` |

A product violation is a deterministic application defect (§8.2). One sample
is enough, because the application must hold these invariants for every LLM
output.

**R-VER-4** With `n` samples per case, an LLM-dependent finding is
**repeated** when it occurs in at least `k(n) = max(2, ⌊n / 2⌋ + 1)` samples
of the case (a strict majority, and never a single sample); its effect is
`fail`. Otherwise it is **isolated** and its effect is `warn`. For `n = 3`,
`k = 2`. With `n = 1`, an LLM-dependent finding can only be isolated: a single
sample cannot separate a regression from model variance. A finding whose true
rate is near one half may land on either side of `k` from run to run; that is
the measurement limit of `n`, and the remedy is more samples, not a different
count.

**R-VER-5** An `unclear` Judge verdict is not a Tutor failure. Isolated, its
effect is `warn`; repeated (≥ `k(n)` samples of the case), its effect is
`inconclusive`, because the criterion is then not decidable for this case
(R-CRT-1).

**R-VER-6** The run verdict is the effect with the highest priority among all
findings: `fail` > `inconclusive` > `warn`; with no finding it is `pass`.
`fail` ranks above `inconclusive` because a product violation or a repeated
finding is positive evidence that missing samples cannot remove. `inconclusive`
ranks above `warn` because incomplete evidence cannot confirm that a run is
only `warn` or `pass`.

**R-VER-7** Judge records exist only when a Judge model is configured and the
case has a `judge` block (R-JDG-1). A run without a Judge model is judged on
its deterministic findings alone; its verdict records that no Judge was
configured, so that it is never mistaken for a run with semantic evaluation.

**R-VER-8** The evaluation CLI ends with these exit codes:

| Exit code | Meaning |
| --- | --- |
| 0 | `pass` or `warn`; also `inconclusive` whose only finding is run status `not-run` (R-PYR-2) |
| 1 | runtime or usage error of the CLI; no verdict (for example a corpus parse error) |
| 2 | `fail` |
| 3 | `inconclusive` |

`warn` exits 0 because isolated findings are expected model variance; they are
visible in the report but do not stop an automated run. `inconclusive` has its
own non-zero code so that an automated gate never treats it as a confirmed
`pass`. The single exception is `not-run` (missing credential or zero budget),
which R-PYR-2 requires not to fail CI; the report still records
`inconclusive`.

**R-VER-9** Every change to this rule (classes, keys, threshold, priority, or
exit codes) MUST bump the rule revision identifier and cite the evidence that
justifies it.

## 13. Change control

| Change | Required |
| --- | --- |
| corpus digest changes | bump `corpusVersion` (R-COR-1) |
| Judge system prompt text | bump Judge prompt revision (R-RSP-4) |
| Tutor prompt templates | existing Tutor prompt revision/digest mechanism; L3 run before merge |
| planner, adapter, strategy, Course Content semantics | L1 green; L3 run before merge |
| new expectation key | update §6.4, parser allowlist, L2 parser tests |
| verdict rule (§12) | bump the verdict rule revision (R-VER-9); L2 verdict tests |

## 14. Non-goals

No benchmark framework, new runner, model ranking, pairwise evaluation,
calibration platform, exposure tracking, general rubric engine, run database,
dashboard, workflow engine, or statistics platform.

## Appendix A – Conformance status (non-normative)

Verified against `main` @ `425bf362` plus the conformance fix that follows it
(PRs #128–#132 of `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md`). Closed since
the first version of this document: the EXPAND continuation (R-EXP-1..4, PR A),
the corpus, rating-band, and binding contract (R-TURN-4, R-RAT-1..6, R-AUT-1..3,
R-EXPD-1, R-BLK-1/2, PR B), the Judge quote, provenance, and report diagnostics
contract (R-EVD-3/4, R-RSP-4, R-FUP-1..4, R-REP-2/3, §11.2, PR C), and the two
remaining gaps found by the consolidation: the run-level corpus ID and version
in `report.json` (`manifest.corpusId`, `manifest.corpusVersion`) and `report.md`
(§11.2), and the fail-fast corpus-parser enforcement of R-TURN-3 for every dialog
turn of a case that declares `expected.learningPhase`. The quality verdict
and the CLI exit codes (R-VER-1..9) followed in PR F, the weekly L3 run and
the Judge-credential preflight (`missing-judge-credential`) in PR G; the weekly
schedule was later deactivated (Appendix B). Remaining known
deviations:

| Rule | Current code | Owner |
| --- | --- | --- |
| R-ATT-2 | only `expected-phase-after` can be reported as not applicable (rating out of band) | none; no other check has a not-applicable state |

Intentional historical identifiers that stay in code and artifacts (§11.4):
the report field `stageAStatus`, internal type names `TutorQualityStageA…`, and
the run-ID prefix `tq2a-`.

## Appendix B – Running an evaluation (non-normative runbook)

Local run, from a clean relevant Git state (R-ID-3), with a fixed model (R-ID-4)
and a disposable output directory:

```sh
npm run eval:tutor-quality:real -- \
  --model <fixed-tutor-model-id> \
  --judge-model <fixed-judge-model-id> \
  --credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL \
  --judge-credential-env UNOSIM_TUTOR_JUDGE_CREDENTIAL \
  --samples <n> \
  --max-calls <budget computed per R-BUD-2> \
  --output-dir <disposable-directory> \
  [--case <case-id> ...] [--corpus <corpus-file>]
```

- Credentials are read only from the named environment variables, never passed
  as values (R-RUN-4). Tutor and Judge use different variable names. Without
  `--judge-model` only the Tutor execution and the deterministic checks run.
- `--case` is repeatable and selects cases by ID. The default corpus is
  `evals/tutor-quality/anchor-corpus.yaml`.
- Compute `--max-calls` before every run (R-BUD-2). The current implementation
  guard (R-BUD-1) allows at most 20 samples per case and 500 calls per run;
  these constants are not part of the contract.
- Without the Tutor credential the command writes a run-level `report.json`
  with `runStatus: "not-run"`, `reason: "missing-credential"`, zero provider
  calls, and no transcripts. With `--judge-model` but without the Judge
  credential the reason is `missing-judge-credential`, also before any call.
- Output: `report.json`, `report.md`, and `transcripts/` (§11.3). Do not commit
  them.
- `report.json` carries `qualityVerdict` with its findings; `report.md` shows it
  under "Quality verdict". The CLI also prints the verdict in its one-line JSON
  summary and exits with 0 (`pass`, `warn`, or `not-run`), 1 (CLI error),
  2 (`fail`), or 3 (`inconclusive`) (R-VER-8).

Workflow: `.github/workflows/tutor-quality-real-provider.yml` is the only L3
workflow. It has no `pull_request` or `push` trigger (R-PYR-2).

- **Manual** (`workflow_dispatch`, any ref): inputs `model`, `samples`,
  `max_calls`, `judge_model` (leave empty for execution only), and `case`. The
  `max_calls` default is a placeholder; set it from the R-BUD-2 calculation.
- **No periodic run.** The weekly `schedule` of PR G is deactivated. L3 is a
  development and merge gate: run it before merging a change listed in §13,
  normally locally. No provider secrets are stored in the repository, and a
  scheduled run without them would only report a green `not-run` that looks
  like a regular measurement. Re-enabling a schedule needs a dedicated service
  credential in a protected environment restricted to `main`, and an update of
  this runbook and of the workflow contract test.
- **Full-corpus configuration** used for merge decisions (R-BUD-2, compute
  before every run from the current call graph): Tutor `openai-gpt5.4-mini`,
  Judge `openai-gpt5.5`, 5 samples per case, no `--case`; for corpus v8
  `1 + 5 × (52 + 9) = 306` calls.
- **Result**: the job result is the CLI exit code (R-VER-8). `pass` and `warn`
  are green; `fail` (exit 2) and `inconclusive` (exit 3) are red; a run without
  the Tutor or Judge secret ends `not-run` and stays green (R-PYR-2); it is no
  measurement. A red run is a quality signal to read in `report.md`, not a
  workflow defect; do not re-run it to obtain green. There is no automatic retry.
- **Artifacts**: `report.json`, `report.md`, and `transcripts/` are uploaded as
  `tutor-quality-run-<run id>-<attempt>`, also when the evaluation step fails,
  with 28 days of retention. Compare two runs with a plain
  text diff of their `report.md` (R-REP-3); timings stand on their own lines.
- **Concurrency**: one evaluation at a time (group
  `tutor-quality-real-provider`); a new run waits and never cancels a running
  one.
- **Secrets**: a dispatch needs the repository secrets
  `UNOSIM_TUTOR_EVAL_CREDENTIAL` and `UNOSIM_TUTOR_JUDGE_CREDENTIAL`; they are
  passed only to the evaluation step, by variable name (R-RUN-4). They are not
  configured at present, so the local run is the working L3 path: load the two
  variables from an untracked, gitignored local env file into the shell that
  starts the CLI, never into the repository or an artifact.
