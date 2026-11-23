# Tutor Quality – Stage 1: Deterministic Quality Foundation

Status: normative for deterministic Tutor quality gates.

> Extension (2026-11-06): section 8 specifies the additional gates for
> LearningQuestions 3.10; they are implemented as deterministic tests (listed in
> section 8). The central TODO list is LearningQuestions section 21.

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

With the aspect flow (section 9) the planner owns aspect, level, assignment and
place, and the provider owns the wording of the question for that assignment.

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
10. A question the application puts in place of the provider's question (a Topic
    question, a hint or a fallback) MUST NOT refer to a sketch element it does
    not name ("der betrachteten Variable", "dieser Wert", "der Variable"). The
    reference counts as named when the question contains a name the sketch
    declares, quotes code, or asks the learner to pick the element first. A
    replacement that fails is dropped: the learner receives the provider's
    question, and no progression state is committed for the dropped question.
    The provider's own question is not rejected by this rule, because no
    better question is available at that point. This is a bounded wording
    rule (`question-concreteness.ts`), not a judgment of meaning.

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
- a Topic question that refers to a sketch element it does not name
  (`question-silent-reference`, the wording rule of invariant 10 without a
  sketch: only quoted code or a learner selection names the element);
- a Topic question given as a `template`: nothing fills its slots before
  delivery (`question-template-unfilled`);
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

Question–Indicator–Objective semantic coherence is outside this gate. Apart
from the wording rule above, authors and later evaluation stages remain
responsible for meaning, clarity, difficulty, feedback quality, and actual
learning effect.

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

`TQ-REG-003` permanently covers the observed unclear Topic question: on a
temperature controller sketch that activates `variables-and-serial` through its
serial output alone, the Topic question "Welche Rolle spielt der Datentyp der
betrachteten Variable im aktuellen Sketch?" must not reach the learner, and no
turn of the dialog delivers a question with an unnamed reference.

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

## 8. Learning-support gates

The authoritative didactic contract is
[LearningQuestions 3.10](ssot_function_definition_LearningQuestions.md#310-antwortversuche-klärung-musterantwort-und-überspringen),
with the central TODO list in section 21. These requirements extend the
existing hard gate when the feature is implemented; they are not claims about
the current gate's coverage.

The deterministic tests MUST exercise:

- separate answer-attempt and clarification counters bound to one server-owned
  question/session/context; complete numeric answers such as `1` count;
- no skip before two successful learner-requested clarifications, skip
  available after the second, including with zero answer attempts;
- no reference-answer access before three answer attempts, voluntary access
  after the third, further attempts allowed, no forced extra attempts after a
  correct answer and no solution revealed by skipping;
- no rating, Difficulty change or positive mastery/deepening evidence from
  clarification, hints, reference-answer viewing or skipping;
- retained identity and counters across rewording and the history sliding
  window; correct reset/invalidation on new dialog or material context change;
- no extra counting on duplicate requests, technical retry, failure, abort or
  conflicting concurrent actions; no cross-session state or forged unlocks;
- preservation of the question until an explicit permitted transition,
  meaningful open completion if no next question exists, and no automatic
  advance merely because a second answer was weak;
- action-specific output validation: intentional clarification/retry is not
  rejected as an accidental repeated question; an authorized reference answer
  is not rejected as a solution leak; normal questions and hints still cannot
  reveal the sought answer or provide a replacement sketch;
- reference applicability to actual code, board and question assumptions;
  old schemas and content without references remain usable.

Implemented in `tests/server/routes/tutor-learning-support.routes.test.ts`
(HTTP), `tests/server/services/tutor/learning-support.test.ts`,
`learning-support-planning.test.ts`, the IT06.4 cases in
`answered-question-context.test.ts` and `question-quality-regressions.test.ts`,
`tests/client/tutor-learning-support.test.tsx` and `e2e/tutor-learning.spec.ts`.

These cases use the real production state machine, schemas and planner with
only the provider faked. Route tests additionally exercise the real HTTP
boundary. UI tests prove that learner-visible actions, explanations of
unavailable actions, focus and assistance status match server state.

The existing invariants 4/5 and 8/9 apply to newly selected questions and
regular question/feedback output. Their planned, explicit exceptions are
question-preserving retry/clarification and an authorized reference-answer
action under LearningQuestions R-SUP-7. These exceptions must not disable the
guards globally. Fake-provider tests prove the protocol, not correct grading
by a real model; the complementary live/HTTP requirements are in
[TutorQualityEvaluation section 15](ssot_function_definition_TutorQualityEvaluation.md#15-planned-learning-support-and-http-dialog-evaluation-not-implemented).

## 9. Aspect flow

Status: implemented, on by default. The learner can switch it off in the Tutor
settings ("Nach Aspekten des Sketches fragen", stored in the browser as
`unoTutorAspectPlanning`); every request then carries `aspectPlanning: false`
and the switch applies from the next question. While it is off, or for Course
Content without aspect files
([CourseContent 7.1](ssot_function_definition_CourseContent.md#71-aspect-files)),
the Topic catalog plans as before.

With the switch on and aspect files present:

1. **Detection.** The application detects the aspects of the current sketch
   from its syntax tree, without macro expansion: variables, expressions,
   branching, loops, functions, arrays, scope, serial, pins, timing,
   program flow and diagrams (the `if`, `while` and `for` statements an
   activity diagram can be drawn for). Each aspect has places ("sites": function, lines, a quotable
   code text, the identifiers that name it, the features it offers) and a
   weight. A site id does not contain line numbers.
2. **Planning.** The planner is deterministic: the same sketch, answers and
   ratings give the same sequence of aspect, level, assignment and site.
   - The first question of a session probes the heaviest aspect with
     assignments on level 2 (explain).
   - A rating of 4 or 5 raises the level by one; on level 3 or 4 the aspect
     counts as shown. A rating of 3 keeps the level and takes another site,
     or another assignment when no other site fits. A rating of 1 or 2 keeps
     the question open; after the second weak answer the level drops by one
     once the question is closed.
   - An aspect is left when it is shown, otherwise after three questions;
     with learning potential (the last rating is better than the one before,
     or the level just rose and the aspect is not shown) up to five. After an
     aspect is shown exactly one level 4 question may follow within that cap.
   - The next aspect is chosen in this order: the aspect the learner chose
     to deepen, the aspect in progress, the aspects the teacher listed for
     the Example (`aspects` of the annotation, in their order), then the
     heaviest open one. The learner's choice travels with each request
     (`aspectFocus`: an aspect id, `null` to clear it), is kept in the
     session and applies from the next question that is planned; choosing an
     aspect that was finished on this sketch opens it again. The Tutor
     offers the aspects as a list above the question, with "Automatik" as
     the default. Choosing an aspect asks about it at once: the client sends
     the support action `skip` with `refocus: true` and the chosen
     `aspectFocus`, which leaves the open question without the two
     clarifications a plain skip needs (section 8); the left question adds
     no rating and counts for the cap. While the next question is held
     until "Weiter", and for "Automatik", no request is sent. Each planned
     question carries the aspects the learner can choose from
     (`aspectChoices`) and the chosen one.
   - The diagram aspect exists only when the request can show a diagram, and
     keeps the statements the application can draw. It asks about statements
     other aspects ask about too, so it is planned only when the learner
     chose it, the teacher listed it or one of its questions is in progress;
     it is always offered in the list. Each of its assignments shows a
     diagram.
   - A new aspect starts on level 3 when the mean of the last three ratings
     is at least 4, on level 1 when it is at most 2, otherwise on level 2.
   - Clarification, hints, reference answers and skipping add no rating; a
     skipped question counts for the cap.
   - The Topic catalog does not plan. A teacher's focus runs first; the
     aspect flow follows, unless the Example sets `afterFocus: free`.
   - When every aspect with assignments is handled the plan reports
     `content-exhausted` and the free Tutor continues.
3. **Competence.** The competence per aspect (highest level passed, shown or
   not, recent ratings) is kept in the session's progression state, apart
   from the counters of the current sketch. Another sketch (fewer than half
   of the earlier sites remain) starts the counters anew and keeps the
   competence; an aspect shown before starts on level 3 with one confirming
   question. After an edit a level 1 or 2 question whose site is gone is
   dropped without counting; a level 3 or 4 question stays.
4. **Wording.** The prompt names aspect, level, task and site of the
   assignment. For a dialog turn the application plans the follow-up on a copy
   of the session state for each rating from 3 to 5 and the prompt carries the
   assignment per rating, so one provider call yields the rating and the final
   follow-up question. The provider's question is delivered when it contains
   an identifier of the site or the site's code; otherwise the assignment's
   fallback question, filled with the site, is delivered. Invariant 10 holds
   for both. The session state is committed as in invariant 2.
   An assignment of level 4 that asks for two parts (a change and its
   observation) makes the question name both, with "erstens" and "zweitens".
5. **Diagram.** For a question whose assignment carries `graphic: activity`,
   and when the client negotiated the classic UML profile, the application
   builds the activity diagram itself: the control statement of the site
   (`if` with `else if` and `else`, `while`, `for`; branches with or without
   braces; a `return` ends its path), with runs of plain statements as one
   action each. The diagram follows the UML notation: a decision node is
   an empty diamond, each outgoing edge carries its condition as a guard in
   brackets and the edge taken otherwise is `[sonst]`; a loop is drawn the
   same way. The provider's proposal is not used and no further provider
   call is made. The diagram passes the same validation and rendering as a
   provider proposal; the validator accepts this variant (`excerpt:
   "statement"`) only when it equals what the application builds for the
   scope. A statement that holds `break`, `continue`, `switch`, `do`, code
   after a `return` or an empty loop body gets no application-built diagram;
   the provider's proposal is then handled as before.
   With `graphic: activity-error` the application changes exactly one place
   of that diagram, always the same for the same statement: the first
   ordered comparison is reversed; without one, the branches of the first
   decision change places. The diagram's title says that it holds an error,
   the prompt tells the provider what was changed (for the rating only), and
   the question asks to find it. Such an assignment is planned only when the
   request can show the diagram (negotiated profile, renderer available) and
   the statement can be drawn; otherwise the flow plans as if the
   assignment did not exist.

The deterministic tests are `aspect-detector.test.ts`, `aspect-planner.test.ts`,
`aspect-flow.test.ts` and `uml/excerpt.test.ts` under `tests/server/services/tutor/`: each aspect
with a positive and a negative sketch, each rule of the planner as a case, and
the flow through `TutorService` with only the provider faked.

Not yet covered by the flow: questions that connect two aspects and the
overview at the end, and question identity across an edit in the
learning-support store.
