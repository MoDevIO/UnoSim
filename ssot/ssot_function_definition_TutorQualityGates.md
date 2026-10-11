# Tutor Quality – Stage 1: Deterministic Quality Foundation

Status: normative for deterministic Tutor quality gates.

## 1. Scope and quality model

The Tutor's primary quality objective is learning support: each turn should help
the learner build, test, or transfer an understanding of the current sketch.
Stage 1 does not claim to measure that outcome directly. It establishes the
deterministic preconditions without which a turn cannot be reliably
learning-supportive.

The Stage 1 proxy is **deterministic instructional integrity**:

- the selected Topic is activated by trusted facts from the current sketch;
- Topic, Concept, Indicator, Question, Strategy, phase, revision, and session
  state form one consistent application-owned plan;
- the plan can reach mastery and the configured DEEPEN criterion without an
  obvious content-exhaustion path;
- a successful learner answer progresses to a distinct question or phase;
- provider output cannot replace application-owned planning metadata;
- invalid, repeated, multi-question, or complete-solution output is rejected or
  repaired before state is committed.

Passing these gates means "structurally capable of supporting learning", not
"empirically proven to improve learning".

## 2. Trust boundaries

The existing trust boundaries remain authoritative:

- the Course Content schemas and loader validate repository-owned data;
- the fact extractor and Topic matcher decide fact-based applicability;
- the planner owns Topic, Concept, Indicator, Question, phase, Strategy, and
  progression metadata;
- the provider owns natural-language feedback and a proposed question only;
- `TutorService` validates/repairs provider content, applies the plan, and
  commits progression state only after the complete request succeeds.

Provider-supplied planning metadata is untrusted and MUST NOT survive when it
conflicts with application-owned planning or Strategy resolution. A real
`TutorPlan` MAY replace provider question text deliberately. Transition and
blocked outcomes MUST retain an already repaired provider question because they
carry metadata but no replacement question.

## 3. Deterministic runtime invariants

The Stage 1 hard gate covers at least these invariants:

1. Topic, Strategy, phase, active Topic, and content revision are mutually
   consistent and application-owned.
2. Progression state is committed only after provider output and the complete
   planning outcome have succeeded.
3. A content revision change starts with revision-scoped progression state;
   session state never leaks between Course Content sessions.
4. Strict repetition never reuses a previously used Question ID. A Question ID
   is used once the learner has answered it in the current Tutor session. The
   application derives this from the session's progression evidence together
   with the bounded dialog history, so a question that has left the dialog
   window stays used, and the planner evaluates Concept mastery against all
   session evidence. Relaxed repetition may still revisit a used question when
   no unused applicable question remains.
5. Exact and heuristically near question repetition is repaired where the
   existing bounded similarity heuristic detects it.
6. Transition and blocked metadata do not overwrite the repaired question.
7. A real `TutorPlan` does overwrite provider question text and metadata.
8. Questions and feedback containing a complete solution are rejected by the
   existing bounded solution guard.
9. Provider output exposes one primary question field. Deterministically clear
   multi-question output (more than one question mark) is invalid. This is a
   syntax invariant, not a semantic judgment of question quality.

## 4. Course Content authoring quality

Schema validity is necessary but not sufficient. A Tutor-enabled repository
MUST provide a small `tutor/quality-cases.yaml` authoring manifest. Each Topic
MUST have at least one positive and one negative activation case referencing a
main sketch from the repository manifest.

The deterministic validator MUST use the production schemas, loader, fact
extractor, matcher, question-applicability rules, and default DEEPEN criterion.
It fails on:

- a positive case that does not activate every declared expected Topic;
- a negative case that activates any declared forbidden Topic;
- a Topic without both positive and negative coverage;
- a Concept with no applicable question in a positive case;
- a required Indicator with no applicable question;
- too few distinct applicable questions or question kinds to satisfy mastery;
- prerequisites that cannot be reached in progression order;
- too few remaining non-recall questions, or missing required question kinds,
  to satisfy DEEPEN after a minimal mastery witness;
- loader failures, invalid references, inconsistent hashes, or an invalid
  Course Content bundle.

Independent of the quality cases, the validator also checks the whole Example
catalog: for every Example in the manifest and every Topic that the production
fact extractor and matcher activate on its main sketch, a learner who answers
every planned question successfully (production planner, the Example's
effective LEARN strategy) MUST reach Topic mastery. This fails on Topics that
are unresolved from the first turn, for example through a prerequisite Concept
that the sketch cannot probe. It does not cover exhaustion that depends on weak
answers, or post-mastery (DEEPEN) capacity outside the quality cases. The
check keeps the gate aligned with every real Example, not only with the cases
an author chose.

Question–Indicator–Objective semantic coherence is outside this gate. Authors
and later evaluation stages remain responsible for meaning, clarity, difficulty,
feedback quality, and actual learning effect.

## 5. Scenario regression contract

A Tutor Quality scenario is a small TypeScript object containing:

- stable case ID;
- action (`initial` or `dialog`);
- sketch;
- optional Course Content snapshot and progression state;
- bounded history, current question, and learner answer;
- exactly one fake-provider outcome (content or error);
- expected result/error, metadata, provider-call count, and state-commit effect.

The runner MUST use `TutorService` and, where Course Content is supplied,
`CurriculumTutorAdapter`. It MUST fake only the external provider. Assertions
remain in tests so failures show the violated invariant directly.

`TQ-REG-001` permanently covers the observed PWM failure family: the PWM sketch
must not activate `variables-and-serial`; after a strong answer an exact or
heuristically near repeated question must be replaced; and result/state metadata
must remain coherent through transition or blocked planning outcomes.

## 6. CI contract

UnoSim pull requests run a named, fast `test:tutor-quality` hard gate with no
network or real-provider dependency. The normal unit/type/doc gates remain in
force.

UnoSim-Examples pull requests validate the repository using a pinned compatible
UnoSim commit. The pin is explicit and reviewable; floating `main` is forbidden.
The gate loads the full bundle, verifies hashes, and runs the authoring quality
cases. No provider credential is present.

## 7. Deferred quality layers

> Update (2026-10-02): real-provider execution runs (real-LLM sampling) and the minimal LLM Judge are no longer deferred; they are specified normatively in `ssot_function_definition_TutorQualityEvaluation.md`. The other items below (semantic learning-support evaluation beyond the minimal Judge, human review studies, empirical learning-progress measurement, adaptive Strategy selection, broad fact-extractor expansion) stay out of scope.

Stage 1 deliberately excludes semantic learning-support evaluation, real-LLM
sampling, LLM-as-Judge, human review studies, empirical learning-progress
measurement, adaptive Strategy selection, and a broad fact-extractor expansion.
Those belong to later layers and may consume Stage 1 scenario traces and stable
case IDs without changing the deterministic contract.
