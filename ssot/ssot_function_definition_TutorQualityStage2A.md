# Tutor Quality – Stage 2A: Real-Provider Evaluation Foundation

Status: normative for the Stage-2A evaluation runner and its artifacts. This
SSOT does not change the Stage-1 PR hard gate and does not claim to measure
learning effect.

## 1. Purpose and boundary

Stage 2A makes real Tutor responses observable, reproducible enough for
comparison, and available for later human or calibrated-judge review. Its
measurement target is **evaluation integrity**:

- the same versioned scenarios can be run again;
- every sample identifies the exact code, Course Content, prompt, provider,
  model, and relevant parameters used;
- the normal `TutorService` and provider trust boundary remains in force;
- deterministic Stage-1 invariants are applied to real responses;
- technical failures are separated from Tutor-quality invariant violations;
- complete, secret-free transcripts can be inspected later.

Stage 2A does **not** measure whether a learner actually learned, assign a
semantic quality score, optimize a strategy, or make a Tutor decision. Those
activities are Stage 2B or later.

## 2. Relationship to Stage 1

Stage 1 remains the deterministic PR hard-gate layer. Stage 2A is a separate,
explicitly invoked observation layer. Real-provider calls MUST NOT be added to
normal unit tests, pull-request gates, or other required CI checks.

The existing trust boundaries remain authoritative:

- `TutorService` owns validation, planning application, repair, and state
  commit;
- `CurriculumTutorAdapter` owns Course Content matching and progression;
- `KiconnectProvider` owns the OpenAI-compatible provider transport and parser;
- the evaluation runner owns only scenario orchestration, metadata, artifact
  writing, and aggregation;
- provider output remains untrusted content, never application-owned planning
  metadata.

The runner MUST call the normal `TutorService`/`LLMProvider` path. It MUST NOT
call a provider HTTP endpoint directly or duplicate TutorService validation.

## 3. Versioned corpus and scenario contract

The anchor corpus is repository-owned and versioned. A corpus manifest has a
stable `corpusId`, an integer `corpusVersion`, and stable scenario IDs. A
scenario contains only synthetic learner data and references repository-owned
sketch/Course Content fixtures. A scenario MAY contain multiple sequential
Tutor turns; each sample starts from a fresh clone of the declared initial
history and progression state.

Minimum scenario fields:

- `id` and corpus version;
- sketch fixture/reference and its digest;
- Course Content revision/reference or explicit free-Tutor mode;
- initial history and progression state, when applicable;
- deterministic difficulty and simulated learner answers for each turn;
- expected structural observations only, such as phase/topic/state policy;
- no credential, personal identifier, or live learner data.

The initial Stage-2A anchor set is deliberately small:

1. `TQ-REG-001` PWM: strong answer and no exact or Stage-1-heuristic question
   repetition;
2. simple variable question;
3. Serial-output prediction;
4. incorrect answer and remediation;
5. partially correct answer and focused follow-up;
6. strong answer and progression;
7. unmatched Topic / free Tutor;
8. LEARN to DEEPEN;
9. EXPAND;
10. clearly off-topic learner answer.

Adding, removing, or semantically changing an anchor scenario MUST increase
`corpusVersion`. A scenario edit is an evaluation change, not a hidden
implementation change. Non-semantic formatting changes may keep the version
only when the parsed scenario and its digest remain identical.

The first implementation uses state-seeded turns for multi-step cases. Every
scripted learner answer is bound to a declared preceding question context. A
continuation step without that binding, or with a different preceding
question, is `invalid`; the runner MUST NOT silently pretend that the answer
was given to an arbitrary real-model question. Scenarios that do not need a
deterministic binding should remain single-step cases.

## 4. Run identity and metadata

Each run has both a unique `runId` and a stable `evaluationIdentity`.

`evaluationIdentity` is the SHA-256 of canonical JSON containing at least:

- UnoSim Git SHA;
- Course Content revision(s);
- corpus ID and version;
- provider ID;
- requested model ID;
- prompt revision identifier and effective-template digest;
- relevant provider parameters, including timeout, temperature when known,
  difficulty, sample count, and call budget.

The `runId` additionally identifies this concrete invocation and MUST include a
UTC start time and collision-resistant suffix. The identity and run ID are
stored in every transcript and the aggregate report.

The runner MUST record, without secrets:

- provider ID and endpoint origin when useful for diagnosis;
- requested model and returned model;
- prompt revision identifier and effective-template digest;
- Course Content revision;
- scenario/corpus version;
- Git SHA and dirty-state indicator;
- sample index, turn index, timestamps, duration, and call counts;
- timeout, temperature, difficulty, and configured call/sample limits.

`promptRevision` is not an arbitrary label. It consists of a versioned
application-owned prompt identifier and a SHA-256 digest of the effective
system/user prompt templates (before scenario values are inserted). A change
to an application-owned prompt template MUST change this revision. Per-turn
prompt digests MAY additionally be stored in transcripts.

Real-provider evaluation requires a clean relevant Git state. Any tracked or
indexed change makes the run preflight `invalid` and no provider call is
issued. Untracked files are invalidating only when they are under a
versioned evaluation/runtime input root and could affect the run; known
untracked editor files, protected local SSOT files, and ignored output
directories do not affect the preflight. The runner does not upload a diff as
a substitute for the exact Git SHA.

The requested model MUST be fixed, explicit, and non-`auto`; preflight MUST
verify that exact requested ID is available. The provider response MUST also
include a non-empty returned model ID, which is recorded as provenance. A
provider may resolve a public request alias to a concrete model snapshot, so
the returned ID need not be string-identical to the requested ID. A different
returned ID alone does not invalidate a sample or its Judge result. Missing
identity metadata makes the sample/result `invalid`, not a Tutor-quality
failure. Reports MUST retain requested and returned IDs separately so the
resolved provenance remains observable. Returned IDs MUST be consistent
within a reproducible batch; the batch report MUST make the set of returned
IDs inspectable.

## 5. Provider and credential rules

The first implementation supports the existing Kiconnect/OpenAI-compatible
provider through `KiconnectProvider` and a fixed model ID supplied by the
scenario invocation. A runner preflight MUST verify that the requested model
is available. It MUST NOT substitute `auto`. The completion response's
returned model ID is required provenance and may be a resolved ID different
from the requested alias; the runner MUST record both IDs without a hardcoded
alias map or string-normalization heuristic. A missing returned ID invalidates
the result. Batch-level consistency is checked from the returned IDs recorded
in the report.

Credentials are read only from a configured invocation environment variable.
The CLI may accept the variable's name, but never its value. They MUST
never appear in a transcript, aggregate report, log line, exception message,
Git diff, or uploaded artifact. Authorization headers are provider-internal
and are never part of the evaluation artifact model.

Missing credentials cause an explicit `not-run/missing-credential` result for
manual/workflow execution. The runner still writes a run-level report with
that reason and zero provider calls, but no sample transcripts. Missing
credentials do not fail normal CI because Stage 2A is not part of normal CI.

## 6. Transcript artifact contract

One JSON transcript is written per scenario sample. It contains:

- schema version, run ID, evaluation identity, and complete metadata;
- scenario inputs and synthetic learner answers;
- ordered logical Tutor turns;
- the Tutor request context needed for later review, excluding credentials and
  transport headers;
- parsed `LLMProvider` result as received by `TutorService` before
  application-side repair/normalization, normalized final Tutor result,
  returned model, or technical error;
- deterministic check records and state-before/state-after snapshots;
- a terminal sample status.

Every sample has two independent status axes:

`executionStatus` is one of:

- `completed`: all requested turns executed and metadata is valid;
- `invalid`: identity/model/contract metadata is missing or inconsistent;
- `technical-failure`: a provider error, timeout, malformed provider response,
  or mid-run call-budget exhaustion prevented a turn;
- `not-run`: preflight stopped execution, for example because credentials were
  missing or the call budget was zero before the first call.

`invariantViolations` is always an array. It is empty or contains deterministic
Stage-1 violation records. A repaired raw response may therefore be
`executionStatus: completed` with non-empty `invariantViolations`; the report
MUST preserve that distinction. Missing credentials and preflight budget
exhaustion are `not-run`, not Tutor-quality failures.

The artifact writer uses an allow-list of fields. It MUST NOT serialize the
credential environment, `process.env`, Authorization headers, or arbitrary
provider response envelopes.

## 7. Deterministic checks and aggregation

Stage 2A may report only properties with a deterministic rule. The runner
reuses the existing TutorService validation and bounded repeat heuristic and
records at least. The validation exposes one shared pure diagnostic result for
schema, question-count, complete-solution, and related deterministic issues;
`TutorService` retains its existing throw/repair behavior by consuming that
result, and the evaluator consumes the same records rather than duplicating
rules.

- provider response/schema validity;
- exactly one primary question;
- complete-solution rejection;
- raw exact or heuristic question repetition;
- application-owned State-/Topic-/Phase-/revision consistency;
- no forbidden Question-ID reuse when Course Content is active;
- state unchanged after provider/technical failure;
- fixed requested-model/preflight availability, returned-model presence, and
  observable batch-level returned-model consistency;
- provider error category and timeout category;
- successful scenario/turn execution;
- provider-call count and budget exhaustion.

The aggregate report contains counts and rates with explicit denominators per
scenario and overall. It MUST keep these categories separate:

1. `invalid` evaluation metadata;
2. `not-run` preflight outcomes;
3. technical provider failures;
4. deterministic Tutor-quality invariant violations;
5. completed observations.

There are no semantic quality grades, learning-support scores, or pass/fail
claims about actual learning in Stage 2A.

Every invocation has a hard maximum sample count and provider-call budget. The
budget covers every external provider call, including `listModels()` preflight
and model resolution as well as generation; reports additionally separate
model-list calls from generation calls. The runner stops before issuing a call
that would exceed the budget. Provider token/cost data is reported only when
the provider supplies it; otherwise the report states that monetary cost is
unavailable and still reports exact call counts.

## 8. Execution and CI

The evaluation is available through a local CLI with explicit model, sample,
output-directory, credential-environment-variable name, and call-budget
inputs. A credential value is never a CLI argument. A manual
`workflow_dispatch` job MAY invoke the same CLI with a repository secret and
upload transcripts/report artifacts. The workflow MUST have no `pull_request`
trigger and MUST not gate merges. A missing secret is a skipped/not-run
evaluation, not a normal CI failure.

Evaluation output is disposable run data. It is not committed to the
repository by the runner and should be written to a caller-selected output
directory or uploaded as an artifact with bounded retention.

## 9. Explicit Stage-2B boundary

Stage 2B may add a semantic rubric, calibrated LLM-as-Judge, inter-rater
agreement with human review, and baseline-vs-candidate statistical analysis.
Those layers must consume Stage-2A transcripts and deterministic reports; they
must not change Stage-1 invariants or reinterpret Stage-2A technical failures
as learning outcomes.
