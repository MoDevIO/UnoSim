# Tutor Quality Stage 2B – Automated Semantic Evaluation & Model Benchmarking

Status: historical design specification; not normative for the current runtime.
The Stage-2B semantic implementation described here was removed in commit
`ae8e2f53f27a5c8f9dce09649b668e44081fec6b`. This document is retained for
design history and possible future review. The active evaluation path uses the
Stage-A anchor corpus and runner with an optional Minimal Judge. Do not apply
the requirements below to current implementation work unless a later approved
plan explicitly reactivates Stage 2B.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in
this document express normative requirements. Descriptive examples do not add
requirements beyond the surrounding normative text.

## 1. Purpose and boundary

Stage 2B makes semantic Tutor quality measurable enough for controlled,
repeated comparison of Tutor models, Tutor prompt revisions, and explicitly
declared Tutor strategies. It adds a calibrated semantic evaluation layer over
the secret-free transcripts and deterministic results produced by Stage 2A.

The quality layers are distinct:

| Layer | Question answered | Normative owner |
| --- | --- | --- |
| Technical executability | Did the declared evaluation run execute with valid identity and provider metadata? | Stage 2A |
| Deterministic contract conformity | Did the response satisfy application-owned structural and state invariants? | Stage 1, observed by Stage 2A |
| Semantic Tutor quality | Was the response factually sound, grounded, diagnostic, precise, instructionally useful, and appropriately progressive for the declared situation? | Stage 2B |
| Actual learning effect | Did a real learner acquire, retain, or transfer knowledge because of the Tutor interaction? | Outside Stage 2B |

Stage 2B MUST NOT infer semantic quality from technical success alone. It MUST
NOT convert a deterministic pass into a semantic pass. It MUST NOT describe a
semantic benchmark result as evidence of actual learning effect.

Stage 2B is an evaluation facility, not a production decision maker. It MAY
produce evidence for a later human decision, but it MUST NOT automatically
select a production model, modify a Tutor prompt or strategy, or feed benchmark
results back into a running Tutor.

## 2. Relationship to Stage 1 and Stage 2A

The Stage-1 and Stage-2A SSOTs remain authoritative within their scopes.
Stage 2B MUST consume their outputs without weakening or reinterpreting their
contracts.

In particular:

- Stage 1 continues to own deterministic instructional-integrity rules and PR
  hard gates.
- `TutorService` continues to own validation, repair, planning application,
  and state commit.
- `CurriculumTutorAdapter` continues to own Course Content matching and
  progression.
- the configured `LLMProvider` continues to own provider transport and parsing.
- Stage 2A continues to own Tutor invocation, credentials, provider-call
  accounting, run identity, raw/final transcript capture, and deterministic
  invariant observation.
- Stage 2B owns only semantic-corpus selection, Judge orchestration, semantic
  evaluation artifacts, calibration evidence, comparison, and reporting.

Stage 2B MUST NOT duplicate provider transport, call `TutorService` by an
independent path, reimplement credential handling, recalculate Stage-1 rules,
or create a competing Stage-2A transcript format. A Stage-2B evaluation MUST
reference immutable Stage-2A inputs by evaluation identity and transcript
identity or digest.

A Stage-2A transcript with a non-completed execution status MAY be represented
in a Stage-2B report for denominator and reliability accounting, but it MUST
NOT receive a semantic quality score. A deterministic invariant violation MUST
remain visible as its own result even when semantic evaluation is possible.

## 3. Semantic evaluation unit and evidence boundary

The smallest Stage-2B evaluation unit is one declared Tutor situation backed
by one Stage-2A sample. It contains only the evidence needed to assess the
declared rubric dimensions:

- the sketch and its revision or digest;
- the Tutor question to which the learner responded;
- the synthetic learner answer;
- the Tutor feedback and follow-up question under evaluation;
- the bounded prior dialog needed to assess diagnosis, progression, or
  repetition;
- relevant Course Content, phase, Strategy, difficulty, and progression
  metadata;
- the Stage-2A execution status and Stage-1 invariant results;
- explicitly declared reference evidence allowed by the semantic corpus.

### 3.1 Frozen Pre-Turn Context

A **Frozen Pre-Turn Context** is the versioned, immutable situation immediately
before the Tutor response being compared. A controlled semantic comparison
MUST start each Tutor variant from the same Frozen Pre-Turn Context. It MUST
include, at minimum:

- the identical preceding Tutor question;
- the identical synthetic learner answer, bound to that exact question;
- the identical sketch and digest;
- the identical Course Content revision and application-owned Strategy,
  phase, and progression state;
- the identical relevant dialog history and ordering.

The evaluated output is the Tutor reaction to that shared context. A learner
answer MUST NOT be silently applied to a different or newly generated question
from one Candidate. Each answer MUST retain Stage-2A's explicit binding to the
declared preceding question.

If variants have already diverged before the compared turn, the inputs are not
a controlled single-turn comparison. The benchmark MUST reset to a valid
shared Frozen Pre-Turn Context or label the comparison `invalid-comparison`;
it MUST NOT compare the resulting reactions as if their conditions matched.
Freely diverging, extended multi-turn trajectories are outside the Stage-2B
core and remain a possible Stage-2C concern.

The primary subject of Tutor-quality evaluation is the normalized final Tutor
response that the application would present after `TutorService` validation,
repair, and plan application. The parsed raw provider result MAY be inspected
to explain provider behavior or a repair, but a defect present only in the raw
result MUST NOT be attributed to the user-visible Tutor response. Conversely,
application repair MUST NOT erase the raw Stage-1 violation recorded by
Stage 2A. Reports MUST keep these two observations separately attributable.

The unit MUST distinguish application-owned metadata from Tutor-model text.
The Judge MUST NOT attribute an application-owned plan decision to the Tutor
model unless the benchmark question explicitly evaluates the rendered use of
that plan.

Evidence that is not present in the evaluation unit MUST NOT be silently
assumed. External factual knowledge MAY be used only when the Judge contract
explicitly permits it and records that policy. Repository-owned sketch and
Course Content evidence takes precedence over a Judge's unsupported prior.

Human outcome labels, candidate model names, provider names, leaderboard
positions, and earlier Judge decisions are not evaluation evidence and MUST
not be exposed to the Judge unless a separately declared calibration protocol
requires a specific item. Human-authored factual reference notes MAY be
provided as reference evidence when the protocol declares this in advance;
the associated human score or verdict MUST remain hidden.

The evidence object MUST label repository/sketch evidence, reviewed factual
reference evidence, and permitted external knowledge as distinct sources.
External knowledge MAY be permitted only by the versioned case evidence
contract. It MUST NOT substitute for absent evidence when making a Critical
Semantic Failure claim.

## 4. Semantic quality model

Each rubric dimension MUST be evaluated separately. An implementation MAY use
a versioned ordinal or categorical scale, but it MUST always support
`not-assessable` and `abstained` in addition to substantive results. It MUST
preserve the evidence and uncertainty for each result.

Every dimension record MUST distinguish `assessed`, `not-assessable`, and
`abstained`. Only `assessed` carries a substantive rubric outcome.
`not-assessable` means the case contract lacks the evidence needed for that
dimension; `abstained` means the dimension was intended to be assessable but
the Judge could not support a verdict. Neither state is a neutral or passing
quality result.

### 4.1 Factual correctness

**Meaning:** Claims about Arduino/C++, electronics, program behavior, and the
learner's answer are correct in the declared context.

**Permitted evidence:** the sketch, language and platform semantics, declared
Course Content, the question-answer pair, and reviewed factual reference notes.

**Insufficient evidence:** confidence, fluent wording, agreement with the
learner, or a generally plausible statement without support in the actual
context.

**Uncertainty:** if correctness depends on omitted hardware, library behavior,
or context, the dimension MUST be `not-assessable` or the Judge MUST abstain
and name the missing evidence. It MUST NOT guess the setup.

### 4.2 Sketch/code grounding

**Meaning:** Feedback and the follow-up question accurately refer to code,
symbols, types, values, control flow, and behavior that exist in or follow from
the current sketch.

**Permitted evidence:** exact sketch text, trusted extracted context, Course
Content references, and the bounded dialog.

**Insufficient evidence:** a generic Arduino explanation, mention of a token
that happens to occur in the sketch, or a plausible code pattern not present
in the sketch.

**Uncertainty:** ambiguous aliases, hidden library code, or missing execution
context MUST be reported. The Judge MUST not invent an implementation to make
the response appear grounded.

### 4.3 Learner-answer diagnosis

**Meaning:** The Tutor correctly identifies what the learner understands, what
is incomplete, and what is mistaken relative to the actual question.

**Permitted evidence:** the preceding Tutor question, the learner answer, the
sketch, relevant prior dialog, and reviewed reference interpretations.

**Insufficient evidence:** whether the Tutor is encouraging, whether it repeats
the learner's words, or whether its next question is independently useful.

**Uncertainty:** a terse or poorly phrased answer MUST receive the most
charitable interpretation supported by its content. If two materially
different interpretations remain plausible, the Judge MUST record the
ambiguity rather than label the answer wrong without qualification.

### 4.4 Precision

**Meaning:** Terminology and causal explanations preserve distinctions that
matter in the current teaching situation, such as `unsigned long` versus
`long`, timestamp versus duration, or value range versus storage size.

**Permitted evidence:** exact declarations and operations in the sketch,
language/platform semantics, the teaching objective, and reference notes.

**Insufficient evidence:** a broadly correct topic label or an explanation
whose gist is right while it erases a distinction being tested.

**Uncertainty:** imprecision MUST be classified by its consequence. A local
wording issue that does not alter meaning is minor; terminology that can induce
a wrong mental model is major or critical according to Section 5.

### 4.5 Instructional usefulness

**Meaning:** The response gives the learner actionable information or a
productive next reasoning step tied to the identified understanding gap.

**Permitted evidence:** specificity of feedback, connection between diagnosis
and follow-up, opportunity for the learner to reason, and relevance to the
declared objective.

**Insufficient evidence:** warmth, length, praise, stylistic polish, or factual
correctness by itself.

**Uncertainty:** when the learner's prior knowledge is not represented, the
Judge MUST limit its claim to usefulness for the declared state and MUST NOT
generalize to all learners.

### 4.6 Scaffolding

**Meaning:** The response supplies enough support to move the learner forward
while preserving meaningful learner work and avoiding an unrequested complete
solution.

**Permitted evidence:** the diagnosed gap, hint specificity, decomposition,
use of prior understanding, Course Content phase, and the work left for the
learner.

**Insufficient evidence:** shortness, use of a question mark, withholding all
feedback, or merely avoiding a code block.

**Uncertainty:** when the appropriate support level depends on unknown learner
history, the Judge SHOULD state the dependency and avoid a definitive extreme
rating.

### 4.7 Dialogic progression

**Meaning:** The follow-up advances, deepens, transfers, or appropriately
remediates the learner's reasoning instead of resetting or circling without a
pedagogical reason.

**Permitted evidence:** bounded dialog history, current and previous questions,
learner answers, phase/Strategy metadata, and declared Concept/Indicator
progression.

**Insufficient evidence:** different surface wording, a new variable name, or
an increase in apparent complexity without a new reasoning demand.

**Uncertainty:** progression cannot be established from an isolated turn with
no relevant predecessor. In that case the dimension MUST be `not-assessable`,
not presumed successful.

### 4.8 Non-repetition

**Meaning:** The Tutor does not ask for substantially the same explanation,
prediction, or reasoning already demonstrated, unless repetition is explicitly
justified as remediation, retrieval, or transfer.

**Permitted evidence:** semantic intent, required reasoning, targeted Concept
or Indicator, learner evidence, and bounded prior questions.

**Insufficient evidence:** lexical difference alone, a different question ID,
or passing the bounded Stage-1 repetition heuristic.

**Uncertainty:** close cases MUST identify the shared reasoning demand and any
legitimate new demand. A Judge that cannot distinguish repetition from a valid
transfer MUST abstain for this dimension.

### 4.9 Difficulty appropriateness

**Meaning:** The reasoning demand and amount of support fit the declared phase,
difficulty, objective, and evidence in the learner answer.

**Permitted evidence:** configured difficulty, LEARN/DEEPEN/EXPAND phase,
prerequisites, prior answers, Course Content, and the conceptual steps required
by the follow-up.

**Insufficient evidence:** response length, vocabulary difficulty alone, or a
Judge's assumed learner profile not present in the scenario.

**Uncertainty:** the result MUST be scoped to the synthetic learner state. When
prerequisite evidence is absent, the Judge MUST mark the dimension
`not-assessable` or abstain rather than inventing competence.

## 5. Weakness and critical-failure taxonomy

Severity and rubric dimension are orthogonal. One issue MAY affect several
dimensions, but it MUST be represented once as a semantic issue with explicit
dimension references rather than counted repeatedly as independent failures.

### 5.1 Critical semantic failure

A **Critical Semantic Failure** is a response defect that makes the Tutor turn
unsafe as instructional evidence or directly teaches, reinforces, or proceeds
from a materially false understanding. Critical failures are non-compensatory:
high results in other dimensions MUST NOT erase, average away, or relabel them.

The taxonomy MUST include at least:

- `factually-wrong-feedback`: materially false domain feedback;
- `correct-answer-rejected`: an answer supported as correct by the declared
  evidence is treated as wrong or corrected toward a false claim;
- `false-sketch-claim`: a materially false assertion about the current sketch;
- `invented-sketch-property`: reliance on code, state, behavior, or hardware
  properties absent from the evidence;
- `contract-breaking-complete-solution`: a contextually complete solution that
  violates the Tutor contract, including a solution not caught by the bounded
  deterministic guard;
- `semantic-contradiction`: feedback contains mutually incompatible claims or
  contradicts its own diagnosis in a way that impairs learning;
- `false-premise-question`: the follow-up requires the learner to accept a
  materially false premise.

The mere presence of one of these labels is insufficient. Every reported
critical failure MUST cite the specific Tutor claim or question, the contrary
evidence, and why the consequence is material. If that proof is unavailable,
the Judge MUST abstain from the critical label.

### 5.2 Major weakness

A **Major Weakness** materially reduces the turn's instructional usefulness or
can create a misleading mental model, but the available evidence does not show
one of the unacceptable failures in Section 5.1. Examples include important
terminological imprecision, failure to address the learner's central
misconception, repeated questioning after demonstrated understanding, or a
substantially mismatched difficulty.

A major weakness MUST include evidence, affected dimensions, and its likely
instructional consequence. It remains separately visible in reports even when
other dimensions are strong.

### 5.3 Minor weakness

A **Minor Weakness** is localized and does not change the core factual account,
diagnosis, reasoning demand, or productive next step. Examples can include a
non-material terminology shortcut or an avoidable but harmless redundancy.

Minor weaknesses MUST NOT be promoted to major or critical merely because a
preferred ideal wording exists. Conversely, fluent wording MUST NOT downgrade
a material defect.

The first Stage-2B version MUST NOT assign arbitrary cross-dimension weights or
severity penalties. Any future weighting is a rubric-versioned decision and
MUST preserve the unweighted dimension and issue records.

## 6. Semantic Corpus and Gold Corpus

### 6.1 Corpus contract

The **Semantic Corpus** is a repository-owned, versioned set of semantic
evaluation situations. It MUST have a stable corpus ID, an integer version,
stable case IDs, and a canonical digest. A semantic change to a case, its
allowed evidence, expected interpretation, or human reference MUST increase
the corpus version. Formatting-only changes MAY retain the version only when
canonical parsed content and its digest remain unchanged.

A **Gold Case** is a Semantic Corpus case whose factual interpretation and
human labels have been reviewed under the human-reference process in
Section 10. Not every Semantic Corpus case has to be a Gold Case, but only Gold
Cases MAY be used to claim Judge calibration.

Each case MUST declare:

- stable case ID and scenario purpose;
- sketch reference and digest;
- Course Content/Strategy context or explicit absence;
- Tutor question and bounded prior dialog;
- Frozen Pre-Turn Context components or a resolvable immutable reference and
  digest;
- deterministic synthetic learner answer and answer-category label;
- expected factual interpretation of that answer;
- acceptable range of Tutor diagnoses, feedback approaches, and follow-ups;
- known semantic failure patterns;
- rubric dimensions that are assessable and any known evidence limitations;
- Human Reference status; for Gold Cases, labels, evidence, notes, review
  status, and provenance;
- case revision or containing corpus version.

The expected interpretation MUST describe meaning and constraints, not mandate
one exact Tutor sentence. Gold Cases MUST allow substantively equivalent
feedback and questions. A model MUST NOT lose credit merely for differing from
a preferred formulation.

Human reference material MUST NOT be used as a hidden Tutor prompt. Case
authors MUST distinguish reference facts that a Judge may see from human
outcome labels that remain blinded.

Each Semantic Case MUST declare its evaluation role and exposure state. The
roles MUST distinguish at least:

- `development`: available for Tutor, prompt, or Strategy improvement;
- `calibration`: used to establish or assess human/Judge agreement;
- `held-out-evaluation`: reserved from targeted Candidate optimization before
  the declared evaluation.

A case MAY move between roles only through a versioned Corpus/Protocol change
that records its prior role and exposure. A Candidate deliberately changed in
response to a case result MUST NOT use that case as independent held-out
evidence for that Candidate. Reports MUST disclose role, exposure, and
contamination for the evaluated case set.

Exposure MUST be recorded per Candidate identity, including whether the case
definition, Tutor output, Human Reference, or Judge result was available before
the declared evaluation and whether it informed a targeted change. The record
MUST distinguish at least `unexposed`, `case-known`, `outcome-exposed`,
`used-for-targeted-change`, and `unknown`. The status `used-for-targeted-change`
disqualifies the case as independent held-out evidence for that Candidate.
`unknown` MUST NOT be presented as uncontaminated held-out evidence.
Any role or exposure-status change MUST increment the relevant Corpus or
Protocol version, preserve the earlier record, and appear in evaluation
identity and reporting.

Comparative or ranking claims about generalization SHOULD use suitable
`held-out-evaluation` cases. A benchmark containing only `development` and/or
`calibration` cases MAY be reported as a Development Benchmark or Calibration
Benchmark, but MUST NOT be called an unbiased generalization result.

### 6.2 Factual Reference Bundle

A **Factual Reference Bundle** is a versioned, case-scoped collection of
reviewed factual statements and their provenance, included only when needed to
evaluate that case. It MAY contain checked Arduino/C++ semantics, derivations
from the concrete sketch, or hardware/API semantics required by the case. It
is reference evidence, not an ideal Tutor answer.

Gold Cases SHOULD include a Factual Reference Bundle when technical facts are
material to their Human Reference or likely Critical Semantic Failures. A
bundle MUST exclude Human outcome labels, preferred Judge verdicts, and desired
ranking positions. Its facts, sources, review state, and digest MUST be
versioned with the case.

Judge evidence MUST distinguish:

- repository/sketch evidence;
- reviewed factual reference evidence;
- permitted external knowledge, if any.

A Critical Semantic Failure based on a technical fact MUST be supported by
repository/sketch evidence or reviewed factual reference evidence. The Judge
MUST NOT issue such a failure solely because it believes it has relevant
external knowledge. If the required fact is not secured by the case's allowed
evidence contract, the Judge MUST use `not-assessable` or abstain for the
affected judgment.

### 6.3 Initial reference cases

The initial Gold Corpus MUST conceptually cover these cases before Stage 2B is
used for comparative claims:

1. **`TQ-SEM-001` — `INPUT_PULLUP`:** a substantively correct learner answer
   MUST NOT be falsely corrected. The reference records acceptable paraphrases
   and the observed failure mode `correct-answer-rejected`.
2. **`TQ-SEM-002` — `millis()` / `delay()`:** a correct answer MUST be
   recognized without needless strictness; a follow-up MAY deepen the
   non-blocking timing concept when it adds a real reasoning demand.
3. **`TQ-SEM-003` — `lastReport`:** diagnosis and follow-up MUST preserve the
   concrete timestamp semantics of the variable rather than describing it as
   an unspecified time value.
4. **`TQ-SEM-004` — `unsigned long`, `millis()`, and overflow:** terminology
   MUST be sufficiently precise, and progression MUST add reasoning about type
   or overflow instead of semantically repeating an already answered timing
   question.
5. **`TQ-SEM-005` — matrix `int` versus `byte`:** the Tutor MUST distinguish a
   real conceptual/type misconception from harmless phrasing and diagnose the
   actual error accurately.

These descriptions reserve IDs and semantic intent. They are not complete
Gold Cases until all fields in Sections 6.1 and 6.2 applicable to the case have
human-reviewed values.

## 7. Synthetic learner answers

Stage 2B initially uses deterministic, versioned learner answers. A case MUST
label the answer category and bind the answer to the exact preceding Tutor
question, as required by Stage 2A.

The Semantic Corpus SHOULD cover at least:

- fully correct;
- partially correct;
- typical misconception;
- terminology confusion;
- correct but poorly phrased;
- explicit "I do not know";
- off-topic;
- unexpectedly strong or extending beyond the expected answer.

The category label is scenario metadata, not a verdict the Judge may blindly
copy. The human reference MUST still explain the case-specific interpretation.

Stage 2B MUST NOT require a free-running Student LLM. If a later experiment
uses generated learner text, it is a separately declared input source and does
not replace the deterministic corpus or its calibration role.

## 8. Semantic Judge contract

The **Judge Model** is a calibrated measurement instrument, not a source of
truth. Its output is evidence subject to schema validation, uncertainty,
calibration, and human challenge.

Every Judge invocation MUST declare and record:

- a fixed Judge model ID; `auto` or an unresolved alias is forbidden;
- provider ID and returned model ID;
- Judge prompt revision and effective-template digest;
- Judge parameters that can affect output;
- rubric ID and version;
- evidence-policy revision;
- input artifact references and their digests;
- call timing, token/cost data when supplied, and call accounting.

A missing or mismatched returned Judge model makes the semantic evaluation
`invalid`; it is not a semantic weakness of the Tutor model.

The Judge MUST receive an allow-listed evidence object rather than an arbitrary
Stage-2A artifact or environment. Candidate model and provider identity MUST
be blinded whenever they are not logically required. The Judge MUST NOT see
ranking context, prior leaderboard positions, candidate labels with quality
connotations, or results from other candidates.

### 8.1 Judge output schema

The schema MUST be application-owned and versioned. The Judge MUST NOT add,
remove, rename, or redefine rubric dimensions or severity levels. At minimum,
one absolute-evaluation result contains:

- schema version and evaluation identity;
- semantic evaluation status;
- one record per required rubric dimension with outcome, assessability,
  uncertainty, concise rationale, and cited evidence locations;
- zero or more semantic issues with severity, taxonomy code, affected
  dimensions, cited evidence, and materiality rationale;
- a dedicated list of Critical Semantic Failures;
- an `abstain` reason and missing-evidence description when applicable;
- no undeclared overall learning-effect or production recommendation.

Machine validation MUST reject missing required dimensions, unknown taxonomy
codes, references to absent evidence, free-form schema extensions, or malformed
statuses. A schema-invalid Judge result has semantic evaluation status
`invalid`; it MUST NOT be repaired into a substantive verdict without a
separately recorded bounded retry policy.

### 8.2 Uncertainty and abstention

The Judge MUST abstain for a dimension or the full evaluation when evidence is
insufficient, materially ambiguous, internally inconsistent, or outside the
declared rubric competence. Abstention MUST be reported, not coerced into a
middle score.

Every abstention MUST identify why no supported conclusion is possible and
which evidence would be needed. Confidence without supporting evidence MUST
not override an abstention condition. The representation and scale of
confidence remain rubric-versioned open questions; false numerical precision
is forbidden.

Judge rationales exist for audit and error analysis. They are not themselves
proof of correctness. Evidence citations and agreement with human references
provide the basis for trust.

## 9. Absolute and pairwise evaluation

### 9.1 Rubric-based absolute evaluation

Every semantically evaluated sample SHOULD receive a rubric-based absolute
evaluation. Absolute evaluation is the primary source for dimension-specific
results, weakness taxonomy, and Critical Semantic Failures. It allows a model
to be compared with the declared standard rather than only with another model.

Absolute Evaluation is the canonical source of sample-level Critical Semantic
Failures. A pairwise Judge MAY flag a potential additional critical issue, but
that observation MUST either be reconciled against an Absolute Evaluation or
retained as a separate comparative observation. It MUST NOT silently create a
second canonical failure or double-count the same defect. Any unresolved
disagreement between Absolute and Pairwise Evaluations MUST remain visible in
the artifacts and report. Stage 2B does not prescribe an automatic
reconciliation algorithm.

Absolute results MUST preserve dimension-level observations and MAY NOT be
reduced to an opaque total. If a future rubric defines an aggregate, its
formula and weights MUST be versioned and the component results MUST remain
available.

### 9.2 Blinded pairwise evaluation

Pairwise evaluation SHOULD be used to compare Baseline and Candidate outputs
for the same case and declared learner input when relative differences are
important or when it serves as a calibrated cross-check of absolute results.
It MUST NOT replace factual correctness checks or hide Critical Semantic
Failures.

The pairwise schema MUST support at least:

- `a-better`;
- `b-better`;
- `equivalent`;
- `both-problematic`;
- `cannot-determine`.

It MUST also contain cited comparative evidence, relevant dimensions, and any
potential critical-failure observations for either response. These are
comparative observations and do not replace or silently augment the canonical
sample-level Critical Semantic Failure records from Absolute Evaluation.

Candidate identities MUST be blinded behind neutral labels. A/B position MUST
be randomized with a recorded seed or deterministically balanced across the
benchmark. The protocol MUST use pair-balanced order, such as equivalent
numbers of A/B and B/A presentations, and MUST report order-conditioned
outcomes. An unresolved reversal under swapped order is disagreement, not a
vote that may be silently discarded.

Pairing rules, including how repeated samples are matched, MUST be declared
before execution. A pairwise result MAY corroborate a ranking but MUST NOT by
itself create a ranking from one sample.

## 10. Human reference and Judge calibration

### 10.1 Human reference

A Human Reference is a reviewed case-level interpretation, not an ideal Tutor
script. Reviewers MUST assess the declared evidence and rubric rather than
personal style preference. Each Gold Case MUST record reviewer provenance in a
privacy-preserving form, review status, disagreements, adjudication notes, and
the rubric/corpus version used.

Critical labels SHOULD receive independent human review before they become
calibration truth. When reviewers disagree on facts, diagnosis, or severity,
the case MUST remain disputed or be adjudicated with explicit reasoning; a
simple hidden majority MUST NOT erase the disagreement.

### 10.2 Agreement and disagreement

Calibration MUST compare Judge results with Human References at the dimension,
severity, critical-failure, abstention, and pairwise-outcome levels where each
is applicable. It MUST report the number of assessable cases and disagreements,
not only one aggregate agreement value.

Disagreement analysis MUST distinguish at least:

- Judge error;
- disputed or underspecified Human Reference;
- insufficient evidence supplied to the Judge;
- rubric ambiguity;
- schema or orchestration defect.

Calibration MUST NOT tune labels after seeing a candidate's desired ranking.
Changes to cases, references, rubric, Judge prompt, or evidence policy require
new versioned calibration evidence.

Human References SHOULD be authored and reviewed before the benchmark variants
are evaluated. A reference changed after reviewers inspect model outputs MUST
receive a new corpus version, disclose that exposure, and MUST NOT be used to
retroactively rewrite the original benchmark result.

### 10.3 Calibration validity

Each Judge configuration MUST have one explicit `calibrationStatus` for a
declared scope:

- `uncalibrated`: the configuration lacks sufficient Human Reference
  evidence. It MAY produce technical and exploratory semantic observations,
  but MUST NOT support automatic ranking or validated superiority claims.
- `provisional`: Human Reference and agreement evidence exists, but the
  empirical basis is limited or does not cover all claimed dimensions and
  failure types. It MAY support internal exploratory comparison only; reports
  MUST prominently state the uncovered scope and calibration limitations.
- `calibrated`: the predeclared Calibration Policy is satisfied for the
  stated dimensions, failure types, and corpus scope. It MAY support automated
  comparative claims only within that scope.

The status MUST be bound to a `calibrationIdentity` containing at least the
Judge model/provider and output-affecting parameters, Judge prompt
revision/digest, rubric version, evidence-policy revision, Semantic/Gold Corpus
version, and Calibration Policy version.
It MUST also reference the immutable Human Reference set and calibration
evidence artifact identities/digests used to establish the status.
Any material change to those inputs makes the old identity inapplicable to the
new configuration. Existing reports retain their historical status and
identity; the new configuration starts `uncalibrated` until evaluated.

`calibrationStatus` is metadata about the measurement instrument. It MUST NOT
be folded into a Tutor semantic score, and it MUST be reported independently
from `semanticEvaluationStatus`.

The Judge MUST be recalibrated after an output-affecting Judge model/parameter
change, Judge prompt or digest change, rubric change, material evidence-policy
change, semantic Gold Corpus change, or Human Reference/calibration evidence
change. Results from incompatible calibration identities MUST NOT be pooled as
though they came from one instrument.

Only `calibrated` results MAY support an automated ranking or validated
superiority claim, and only for the scope named by that calibration identity.
`uncalibrated` results MUST be labeled exploratory. `provisional` results MAY
support internal exploratory comparisons but MUST NOT be presented as validated
ranking or superiority claims. Calibration sufficiency is established by a
predeclared policy; its empirical thresholds remain open and MUST be reported,
not silently invented by an implementation.

Human reviewers remain able to challenge any Judge result. Corrections MUST be
versioned and MUST NOT mutate already published benchmark artifacts in place.

## 11. Benchmark experiment design

### 11.1 Model benchmarking

A Tutor-model benchmark MUST hold constant, for Baseline and Candidate:

- Semantic Corpus ID/version and selected cases;
- Stage-2A evaluation scenario inputs and sketch digests;
- the same versioned Frozen Pre-Turn Context for every paired case;
- Course Content and revision;
- Tutor prompt revision and digest;
- Tutor Strategy and phase/state inputs;
- temperature, difficulty, and all relevant provider parameters;
- deterministic synthetic learner inputs;
- per-case sample count and budget policy;
- semantic rubric, Judge configuration, and evaluation protocol.

The primary varied factor is Tutor Model ID. Provider MAY differ only when a
model cannot otherwise be accessed, and that confound MUST be declared and
reported. Fixed Tutor model IDs are required; `auto` is forbidden.

Tutor model and provider identity MUST be hidden from the Judge where possible.
The benchmark report MUST retain their real identities outside the blinded
Judge payload for reproducibility.

### 11.2 Prompt and Strategy experiments

The same infrastructure MAY compare a Tutor prompt Baseline with a Candidate,
a Strategy Baseline with a Candidate, or another explicitly declared Tutor
variant. A single-factor experiment MUST change only the declared factor.

If more than one factor changes, the benchmark MUST be declared multifactorial
before execution and MUST report the combinations separately. It MUST NOT be
presented as isolating the effect of one factor without an appropriate design.

Test-case-specific Tutor prompt tuning is forbidden unless the Tutor prompt and
the affected Semantic Corpus receive explicit new versions and the resulting
contamination is disclosed. A Candidate tuned on the Gold Corpus MUST NOT be
described as an unbiased generalization result on that same corpus.

### 11.3 Baseline and Candidate

Every comparative benchmark MUST name one reproducible Baseline and at least
one Candidate. For each variant it MUST record:

- UnoSim Git SHA;
- Course Content revision;
- Stage-2A corpus/evaluation identity;
- Semantic Corpus ID/version;
- Tutor model and provider;
- Tutor prompt revision/digest;
- Tutor Strategy and declared variant parameters;
- Judge model and provider;
- Judge prompt revision/digest;
- rubric and evidence-policy versions;
- all relevant parameters and sample counts.

A Candidate result is comparable only when the experiment manifest declares
the intended differing fields and all other controlled fields match. Any
unplanned mismatch makes the comparison `invalid-comparison`, not evidence for
either variant.

### 11.4 Comparability status

Every Baseline/Candidate comparison MUST have an independent
`comparabilityStatus`:

- `fully-comparable`: all manifest fields declared as controlled match and
  only the explicitly varied factor differs;
- `qualified-comparison`: one or more documented confounds remain, such as a
  different provider, unsupported parameter, or unavoidable execution
  condition; results MAY be reported but MUST NOT be described as isolating
  the declared factor;
- `invalid-comparison`: an undeclared or material difference prevents a
  supported comparison.

Comparability status MUST be derived as deterministically as possible from
the experiment manifest, resolved artifact identities, and declared provider
capabilities. The manifest MUST declare controlled fields, the varied factor,
and permitted confounds before execution. Semantic scores and Judge verdicts
MUST NOT influence comparability classification.

`comparabilityStatus` is independent of semantic evaluation status and
semantic scores. An `invalid-comparison` MUST NOT produce a ranking,
superiority claim, or pooled comparative estimate. A `qualified-comparison`
MUST report each confound prominently and MAY support only a qualified
descriptive comparison. The report MUST retain both comparability status and
its evidence.

## 12. Repeated sampling and uncertainty

One LLM output is an observation, not a model benchmark. A comparative claim
MUST use repeated Tutor samples per case and variant. The same declared sample
allocation MUST be used for Baseline and Candidates unless an explicitly
justified design states otherwise.

Reports MUST include, per case, variant, dimension, and overall where
applicable:

- requested, attempted, valid, and semantically evaluated sample counts;
- not-run, invalid, and technical-failure counts;
- deterministic invariant-violation counts;
- Judge invalid, technical-failure, and abstention counts;
- Critical Semantic Failure counts and rates with explicit denominators;
- dimension-result distributions;
- major and minor weakness counts;
- pairwise outcome distributions where used;
- dispersion or uncertainty suitable for the eventual analysis method.

No model rank or Baseline/Candidate superiority claim MAY be derived from a
single Tutor sample. The minimum sample count and statistical confidence
method remain open until supported by empirical variance data.

Missing or failed samples MUST remain in technical-reliability denominators.
They MUST NOT be converted to low semantic scores or silently removed from the
reported sample flow. Semantic denominators MUST include only samples eligible
for that semantic measure and MUST be stated explicitly.

## 13. Aggregation, critical-failure policy, and ranking

### 13.1 Non-compensatory critical-failure reporting

Critical Semantic Failures MUST be reported as a separate count and rate at
case, failure-type, variant, and benchmark levels. The report MUST show both
the number of affected samples and the number of failure instances.

Averages or favorable pairwise results MUST NOT conceal the presence of a
Critical Semantic Failure. Any summary of a model with observed critical
failures MUST display that fact adjacent to its semantic quality results.

Stage 2B does not yet prescribe a universal exclusion threshold. A benchmark
MAY declare a pre-registered decision policy, but the threshold and rationale
MUST be explicit and MUST NOT be chosen after viewing Candidate results.

Only Critical Semantic Failures from Absolute Evaluation are included in the
canonical Critical Semantic Failure counts and rates. Pairwise-only potential
failures MUST be counted separately as comparative observations until they
are reconciled into an Absolute Evaluation; they MUST NOT inflate canonical
failure rates on their own.

### 13.2 Required result families

A benchmark report MUST keep at least these result families separate:

- semantic dimension quality and weakness distributions;
- Critical Semantic Failure rate;
- deterministic invariant failure rate;
- semantic repetition rate;
- technical reliability for Tutor execution and Judge execution;
- Tutor and Judge latency;
- Tutor and Judge provider-call counts;
- tokens and monetary cost when supplied by the providers.

Unavailable token or cost information MUST be reported as unavailable. It MUST
NOT be estimated or invented unless a separately versioned and disclosed cost
model is adopted later.

### 13.3 Ranking and leaderboards

A ranking MUST NOT consist only of one opaque total score. Any ordered view
MUST expose the component results, denominators, calibration identity,
uncertainty, and critical failures.

Separate report views MAY address:

- Tutor Quality;
- Quality / Latency;
- Quality / Cost when cost data is available.

The calculation and normalization for each view MUST be declared and versioned
before it is used. Models for which the selected statistical method does not
support a clear distinction MUST be reported as not clearly distinguishable;
the presentation MUST NOT force a total order.

Automated ranking claims MUST use `calibrationStatus: calibrated` for the
relevant scope and repeated samples as required by Section 12. A
`fully-comparable` result MAY support an unqualified factor comparison. A
`qualified-comparison` MAY be shown as qualified descriptive evidence only,
with confounds adjacent to the result; it MUST NOT be presented as an isolated
factor effect. An `invalid-comparison` MUST NOT produce a ranking or
superiority claim. A single sample MUST NOT support a ranking. Unavailable
cost data prevents a Quality / Cost view, but does not by itself invalidate a
separately supported Tutor Quality or Quality / Latency view.

## 14. Status axes

Stage 2B adds semantic status without collapsing existing Stage-2A axes.
Every evaluated sample MUST preserve:

1. `executionStatus` from Stage 2A: `completed`, `invalid`,
   `technical-failure`, or `not-run`;
2. `invariantViolations` from Stage 2A as an unchanged array;
3. `semanticEvaluationStatus` from Stage 2B;
4. `criticalSemanticFailures` as an independent array;
5. `rubricResults` as independent per-dimension records.

`semanticEvaluationStatus` is one of:

- `completed`: all required assessable dimensions have valid Judge results;
- `partially-completed`: at least one dimension is valid and at least one is
  `not-assessable` or `abstained`;
- `abstained`: no substantive semantic verdict was issued because the Judge
  abstained on the complete unit;
- `invalid`: the sample identity, evidence contract, returned model metadata,
  or Judge output schema is missing or inconsistent;
- `judge-technical-failure`: provider error, timeout, or exhausted Judge-call
  budget prevented semantic evaluation;
- `not-evaluated`: Stage-2A eligibility or Stage-2B preflight prevented a Judge
  call, or the case contract has no assessable rubric dimensions.

`semanticEvaluationStatus: completed` does not mean all rubric results are
positive and does not mean no critical failure exists. Conversely, a critical
failure is a semantic finding, not a technical status.

Samples whose Stage-2A `executionStatus` is not `completed` MUST have
`semanticEvaluationStatus: not-evaluated`, unless the purpose is an explicitly
separate evaluator robustness test that cannot enter Tutor-quality aggregates.

Every Benchmark Run MUST report the `calibrationStatus` and
`calibrationIdentity` of every Judge configuration whose results contribute
to the run. When exactly one Judge configuration is used, a run-level
`calibrationStatus` MAY mirror that configuration. With multiple Judge
configurations, their statuses MUST remain separately attributable and MUST
NOT be collapsed into a single scalar status without a separately versioned
aggregation policy.

Every Benchmark Run MUST report the `comparabilityStatus` of every
Baseline/Candidate comparison. A benchmark-level comparability summary MAY be
derived for reporting, but it MUST NOT replace, weaken, or collapse the
individual comparison statuses.

These are independent metadata axes. Neither calibration nor comparability
status may be encoded as a semantic score or overwrite sample execution,
invariant, or semantic evaluation status. A result may therefore be
semantically assessed while its Judge configuration is uncalibrated or its
model comparison is invalid; the corresponding claim restrictions still
apply.

An invalid comparison MUST be expressed through its `comparabilityStatus`,
not by rewriting otherwise valid sample-level `semanticEvaluationStatus`
values.

## 15. Reproducibility and identity

Every Benchmark Run has a unique run ID and a stable
`semanticEvaluationIdentity`. The identity MUST be a digest of canonical,
allow-listed metadata including at least:

- all referenced Stage-2A evaluation identities and transcript digests;
- UnoSim Git SHA;
- Course Content revisions and sketch digests;
- Stage-2A corpus ID/version and scenario/sample selection;
- Semantic Corpus ID/version and canonical digest;
- selected case IDs, case roles/exposure states, Frozen Pre-Turn Context
  digests, and Factual Reference Bundle digests where applicable;
- Tutor model, provider, prompt revision/digest, Strategy, and parameters;
- Judge model, provider, prompt revision/digest, and parameters;
- rubric, output-schema, evidence-policy, and Calibration Policy versions;
- calibration identity/status and calibration evidence digests;
- declared experiment comparability inputs;
- absolute/pairwise protocol, blinding method, ordering seed, and pairing rule;
- the declared comparability status and the evidence used to derive it;
- requested sample counts and all call/safety limits.

The run ID MUST additionally contain or reference a UTC start time and a
collision-resistant suffix. Timestamps identify an invocation but MUST NOT be
the sole input to comparison identity.

Canonical identity MUST treat declared sets and unordered collections
consistently. Before canonical serialization, semantically unordered
collections such as sets of case IDs, Stage-2A identities/transcript digests,
Course Content revisions, and model variant IDs MUST be duplicate-free and
sorted by ascending UTF-8 byte order of their canonical string values. Fields
whose order has meaning MUST remain ordered, including dialog turns, ordered
history, ordered experiment factors where declared, and the actual A/B position
presented to a Judge. When unordered items are represented by linked records,
the complete records MUST be sorted by their canonical key so identities,
transcript digests, revisions, and other associated values remain linked; they
MUST NOT be sorted as independent parallel collections. The randomized order
seed and balancing protocol MUST also be retained. Thus logically identical
manifests MUST yield the same stable identity even if unordered inputs were
supplied in a different order.

Any material identity field that is missing, unresolved, or inconsistent makes
the affected evaluation or comparison `invalid`. Benchmark artifacts MUST
record their identity and references so that a reviewer can trace a semantic
result to the exact secret-free Stage-2A transcript.

## 16. Bias and contamination controls

The benchmark protocol MUST minimize avoidable measurement bias:

- blind Tutor model and provider identities from the Judge where possible;
- use neutral candidate labels;
- randomize and pair-balance A/B order with a recorded method and seed;
- withhold ranking context and previous leaderboard positions;
- prevent results from one candidate from becoming evidence for another;
- prevent Judge outputs from changing Tutor prompts, strategies, samples, or
  later Judge instructions within the same Benchmark Run;
- version and disclose any case-specific tuning or corpus exposure;
- keep development, calibration, and held-out evaluation cases explicitly
  labeled with exposure history.

The report MUST state whether Tutor Model and Judge Model are identical, share
a model family, share a provider, or have another plausible dependency. Such
overlap does not automatically invalidate a run, but it is a visible risk and
MUST be considered in calibration and interpretation.

Judge prompt authors and corpus authors SHOULD avoid cues that reveal expected
candidate rank. A model's prose style, verbosity, or self-identification MUST
not be used as a proxy for model identity or semantic quality.

There MUST be no self-improvement feedback loop during the same benchmark. A
new prompt, strategy, reference, rubric, or Judge configuration informed by a
run creates a new declared Candidate or benchmark identity.

## 17. Cost, call, and safety bounds

Every Stage-2B invocation MUST declare hard finite maxima before any provider
call for at least:

- number of Tutor variants/models;
- number of scenarios;
- Tutor samples per scenario/variant and total Tutor samples;
- Stage-2A Tutor-provider calls;
- absolute Judge calls;
- pairwise Judge calls, including order-balanced repetitions;
- total external provider calls across Tutor and Judge paths.

Judge calls count toward the total provider-call budget. Model listing,
preflight, retry, and generation calls count according to the same all-external-
calls principle as Stage 2A and MUST be reported separately by purpose. The
orchestrator MUST stop before a call would exceed any applicable budget.

Concrete maxima are an implementation and operations decision that MUST be
reviewed against provider limits and cost evidence; this SSOT does not invent
their values. An implementation without finite enforced maxima is
non-conformant.

Stage-2A credential rules remain authoritative. Credentials, Authorization
headers, arbitrary provider envelopes, and `process.env` MUST NOT enter Judge
inputs, semantic artifacts, logs, reports, or errors. Tutor and Judge
credentials MAY be distinct, but each MUST be obtained only through the
approved Stage-2A-style environment-variable boundary.

Retries, if supported, MUST be bounded, counted, and recorded with their
reason. A retry MUST NOT overwrite the original failed attempt or be selected
because its semantic verdict is more favorable.

## 18. Machine-readable artifacts

Artifact schemas MUST be versioned, allow-listed, bounded, and secret-free.
Stage 2B MUST produce or explicitly represent these artifact types:

1. **Semantic sample evaluation:** reference to one Stage-2A transcript,
   identities, Judge metadata, calibration status/identity, semantic status,
   dimension results, issues, canonical critical failures, comparative
   observations when applicable, uncertainty, evidence citations, timing, and
   call usage.
2. **Pairwise evaluation:** references to both candidate transcripts, blinded
   ordering metadata, outcome, comparative evidence, order-balance group, and
   Judge metadata.
3. **Aggregate model report:** sample flow, dimension distributions, failure
   rates, reliability, latency, calls, available token/cost data, and
   uncertainty for one Tutor variant.
4. **Benchmark comparison report:** experiment manifest, Baseline/Candidate
   identities, `comparabilityStatus` and evidence, case roles/exposure,
   absolute and pairwise summaries, `calibrationStatus` and identity, bias
   disclosures, and any ranking view.

Artifacts MUST refer to Stage-2A transcripts by immutable identity and digest;
they SHOULD avoid duplicating complete transcript content. If evidence excerpts
are copied for audit, their source location and digest MUST be retained.

Raw Judge output MAY be retained only in a bounded, secret-free diagnostic
field when needed for audit. It MUST NOT override the validated application-
owned semantic schema.

Generated evaluation artifacts are disposable run data. They MUST NOT be
committed automatically and MUST use caller-selected output storage or bounded
artifact retention consistent with Stage 2A.

## 19. Human-readable report

The human report MUST explain the evidence rather than present only a rank. For
each variant it MUST show:

- observed strengths by rubric dimension;
- major and minor weaknesses with representative evidence;
- Critical Semantic Failures by type and affected case;
- uncertainty, abstentions, disagreement, and calibration limitations;
- calibration status and identity, selected corpus roles, and exposure or
  contamination disclosures;
- comparison status and documented confounds for each Baseline/Candidate
  comparison;
- requested, valid, and semantically evaluated observation counts;
- deterministic violations and technical failures as separate categories;
- latency, provider calls, and available Tutor/Judge token and cost data;
- whether compared variants are statistically not clearly distinguishable;
- model-family/provider overlap between Tutor and Judge;
- exact Benchmark Run, corpus, rubric, Tutor, and Judge identities.

Representative examples MUST be traceable and MUST not be selected solely to
support a preferred conclusion. The report SHOULD link machine-readable
artifacts for audit.

Terms such as "best", "winner", or "improved" MAY be used only when the
predeclared analysis supports that claim, calibration is valid, critical
failures remain visible, and uncertainty is stated. Semantic quality MUST NOT
be described as measured learning gain.

## 20. Non-goals for Stage 2B

Stage 2B explicitly excludes:

- measuring actual learning effect with real students;
- requiring an autonomous or free-running Student LLM;
- automatic production-model selection or deployment;
- automatic Tutor prompt optimization;
- automatic Tutor Strategy optimization;
- a self-modifying Tutor or within-run feedback loop;
- online learning from production dialogs;
- persistent learner profiles or personal longitudinal data;
- changing Stage-1 hard gates or deterministic rules;
- changing Stage-2A execution, identity, credential, or transcript contracts;
- broadening the fact extractor or Course Content semantics;
- treating Judge output as ground truth without human calibration.

Stage 2B MAY run manually or in a non-blocking evaluation workflow. It MUST NOT
become a normal PR hard gate until a separately reviewed policy defines stable
calibration, budgets, reliability, and failure handling. This SSOT does not
authorize such a policy.

## 21. Future boundary: Stage 2C

Stage 2C could later investigate multi-turn simulated learners, declared
learner personas, longer Tutor trajectories, learning-trajectory evaluation,
and controlled empirical studies. Those topics require new validity,
simulation, privacy, and causal-inference contracts.

This boundary is not an implementation request. Stage 2B MUST remain usable
with deterministic synthetic learner answers and bounded transcript evidence.

## 22. Normative terminology

**Tutor Model:**
The fixed model ID whose Tutor response is generated through the normal
Stage-2A `TutorService`/`LLMProvider` path and evaluated as a benchmark variant.

**Judge Model:**
The fixed model ID used as a calibrated semantic measurement instrument. It is
not a truth source and does not participate in Tutor generation.

**Semantic Corpus:**
The versioned collection of semantic evaluation situations, evidence policy,
synthetic learner inputs, expected interpretations, and reference metadata.

**Gold Case:**
A Semantic Corpus case with reviewed human factual interpretation and labels
that is eligible for Judge calibration.

**Human Reference:**
The reviewed, evidence-backed interpretation and labels for a Gold Case,
including acceptable response range, known failures, disagreement, and
adjudication notes; it is not one required ideal answer.

**Rubric Dimension:**
One independently reported aspect of semantic Tutor quality defined in
Section 4, with its own evidence, result, and uncertainty.

**Critical Semantic Failure:**
A non-compensatory, evidence-backed semantic defect that makes a turn unsafe as
instructional evidence or materially teaches, reinforces, or builds on a false
understanding.

**Absolute Evaluation:**
Assessment of one Tutor sample against the fixed semantic rubric and evidence,
independent of another candidate's quality.

**Pairwise Evaluation:**
A blinded comparison of two comparable Tutor samples under the outcomes and
order controls defined in Section 9.2.

**Baseline:**
The fully identified reference Tutor variant against which one or more
Candidates are compared under controlled conditions.

**Candidate:**
A fully identified Tutor variant whose declared differing factor is compared
with the Baseline.

**Benchmark Run:**
One bounded, uniquely identified execution of a predeclared experiment
manifest over selected Stage-2A samples and Stage-2B evaluation protocols.

**Calibration:**
The versioned process and evidence used to compare a Judge configuration with
Human References, analyze disagreement, and determine the scope in which its
measurements may support comparative claims.

**Calibration Status:**
The scoped state `uncalibrated`, `provisional`, or `calibrated` for one
calibration identity, as defined in Section 10.3.

**Comparability Status:**
The independent benchmark classification `fully-comparable`,
`qualified-comparison`, or `invalid-comparison`, derived from controlled
experiment fields and declared confounds.

**Frozen Pre-Turn Context:**
The versioned, immutable question, learner answer, sketch, Course Content,
Strategy, phase, progression state, and relevant ordered history shared by
variants immediately before the Tutor response being compared.

**Factual Reference Bundle:**
A versioned, case-scoped set of reviewed technical facts and provenance that
may support semantic evaluation but contains no human outcome labels or desired
ranking positions.

**Case Exposure Record:**
A Candidate-specific, versioned record of which case artifacts and outcomes
were available before evaluation and whether they informed targeted changes.

**Development Case:**
A Semantic Case permitted for targeted Tutor, prompt, or Strategy improvement.

**Calibration Case:**
A Semantic Case assigned to human/Judge agreement assessment and Judge
calibration.

**Held-Out Evaluation Case:**
A Semantic Case reserved from targeted Candidate optimization for the declared
evaluation; targeted use of its outcome for Candidate changes ends its
independent held-out status for that Candidate.

## 23. Open questions

The following decisions lack sufficient empirical evidence and MUST remain
explicit rather than being hidden in an implementation default:

1. the exact per-dimension rubric scale and representation of confidence;
2. whether and how dimensions may be weighted in any aggregate view;
3. the minimum repeated-sample count by case and experiment type;
4. the statistical uncertainty, interval, and multiple-comparison methods;
5. the number, diversity, and aggregation method of Judge Models;
6. concrete human/Judge agreement and calibration-sufficiency thresholds;
7. the minimum number, composition, refresh policy, and governance of cases in
   development, calibration, and held-out evaluation roles. The role model,
   exposure record, and disqualification after targeted use are resolved by
   Sections 6.1 and 16;
8. the ranking method and conditions for partial orders or equivalence groups;
9. the treatment of provider and model-family dependence between Tutor and
   Judge;
10. cost normalization across providers, currencies, cached tokens, and
    changing price schedules;
11. operational hard-limit values for models, scenarios, samples, retries, and
    calls;
12. whether pairwise order reversal uses the same Judge context or independent
    calls;
13. how contested Human References are admitted, revised, or retired;
14. when, if ever, a stable Stage-2B signal may participate in a non-blocking
    release policy.

Resolving an open question requires evidence, an explicit normative update,
and any necessary corpus, rubric, or protocol version change. Implementations
MUST NOT silently resolve these questions through undocumented constants.
