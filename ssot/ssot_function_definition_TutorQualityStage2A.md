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

1. `TQ-REG-001` PWM: strong answer and no semantic question repetition;
2. simple variable question;
3. Serial-output prediction;
4. incorrect answer and remediation;
5. partially correct answer and focused follow-up;
6. strong answer and progression;
7. unmatched Topic / free Tutor;
8. LEARN to DEEPEN;
9. EXPAND;
10. clearly off-topic learner answer.

The corpus may grow only by adding a reviewed scenario or a corpus-version
change. A scenario edit is an evaluation change, not a hidden implementation
change.

## 4. Run identity and metadata

Each run has both a unique `runId` and a stable `evaluationIdentity`.

`evaluationIdentity` is the SHA-256 of canonical JSON containing at least:

- UnoSim Git SHA;
- Course Content revision(s);
- corpus ID and version;
- provider ID;
- requested model ID;
- prompt revision;
- relevant provider parameters, including timeout, temperature when known,
  difficulty, sample count, and call budget.

The `runId` additionally identifies this concrete invocation and MUST include a
UTC start time and collision-resistant suffix. The identity and run ID are
stored in every transcript and the aggregate report.

The runner MUST record, without secrets:

- provider ID and endpoint origin when useful for diagnosis;
- requested model and returned model;
- prompt revision;
- Course Content revision;
- scenario/corpus version;
- Git SHA and dirty-state indicator;
- sample index, turn index, timestamps, duration, and call counts;
- timeout, temperature, difficulty, and configured call/sample limits.

Missing or inconsistent identity metadata, including an omitted or `auto`
model, makes a sample `invalid`. It MUST NOT be reported as a Tutor-quality
failure. If the provider returns a model different from the requested fixed
model, the sample is also `invalid` and no quality conclusion is drawn.

## 5. Provider and credential rules

The first implementation supports the existing Kiconnect/OpenAI-compatible
provider through `KiconnectProvider` and a fixed model ID supplied by the
scenario invocation. A runner preflight MUST verify that the requested model
is available. Any returned-model mismatch invalidates the sample rather than
silently accepting `auto` fallback.

Credentials are read only from an invocation environment variable. They MUST
never appear in a transcript, aggregate report, log line, exception message,
Git diff, or uploaded artifact. Authorization headers are provider-internal
and are never part of the evaluation artifact model.

Missing credentials cause an explicit `not-run/missing-credential` result for
manual/workflow execution. They do not fail normal CI because Stage 2A is not
part of normal CI.

## 6. Transcript artifact contract

One JSON transcript is written per scenario sample. It contains:

- schema version, run ID, evaluation identity, and complete metadata;
- scenario inputs and synthetic learner answers;
- ordered logical Tutor turns;
- the Tutor request context needed for later review, excluding credentials and
  transport headers;
- raw provider result as returned to the service, normalized final Tutor
  result, returned model, or technical error;
- deterministic check records and state-before/state-after snapshots;
- a terminal sample status.

Transcript status is one of:

- `completed`: all requested turns executed and metadata is valid;
- `invalid`: identity/model/contract metadata is missing or inconsistent;
- `technical-failure`: provider error, timeout, malformed provider response, or
  call-budget exhaustion prevented a turn;
- `deterministic-violation`: a Stage-1 invariant was observed on raw/final
  output. A repaired raw response may be both technically completed and have a
  violation record; the report MUST preserve that distinction.

The artifact writer uses an allow-list of fields. It MUST NOT serialize the
credential environment, `process.env`, Authorization headers, or arbitrary
provider response envelopes.

## 7. Deterministic checks and aggregation

Stage 2A may report only properties with a deterministic rule. The runner
reuses the existing TutorService validation and bounded repeat heuristic and
records at least:

- provider response/schema validity;
- exactly one primary question;
- complete-solution rejection;
- raw exact or heuristic question repetition;
- application-owned State-/Topic-/Phase-/revision consistency;
- no forbidden Question-ID reuse when Course Content is active;
- state unchanged after provider/technical failure;
- requested/returned model consistency;
- provider error category and timeout category;
- successful scenario/turn execution;
- provider-call count and budget exhaustion.

The aggregate report contains counts and rates with explicit denominators per
scenario and overall. It MUST keep these categories separate:

1. `invalid` evaluation metadata;
2. technical provider failures;
3. deterministic Tutor-quality invariant violations;
4. completed observations.

There are no semantic quality grades, learning-support scores, or pass/fail
claims about actual learning in Stage 2A.

Every invocation has a hard maximum sample count and provider-call budget.
The runner stops before issuing a call that would exceed the budget. Provider
token/cost data is reported only when the provider supplies it; otherwise the
report states that monetary cost is unavailable and still reports exact call
counts.

## 8. Execution and CI

The evaluation is available through a local CLI with explicit model, sample,
output-directory, credential, and call-budget inputs. A manual
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
