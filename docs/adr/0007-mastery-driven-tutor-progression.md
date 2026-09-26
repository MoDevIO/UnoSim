# ADR 0007: Mastery-driven Tutor progression

- Status: Proposed
- Date: 2026-09-26
- Owners: UnoSim maintainers and platform operators

## Context

The unified Course Content contract already separates reusable Topics from the
EffectiveTutorStrategy and uses deterministic concept-level mastery criteria
inside the curriculum planner. The current contract does not yet define a
Topic-level didactic phase, a session-local mastery latch, or a bounded path
from demonstrated Topic understanding to transfer and extension.

The Tutor must be able to deepen learning after deterministic Topic mastery and
offer a bounded program extension without becoming an autonomous code editor,
an unrestricted workflow engine, or a persistent learner model.

## Decision

UnoSim defines three application-owned phases for an active applicable Topic:

1. `LEARN` — gather and verify Topic understanding;
2. `DEEPEN` — use the mastered Topic through application, prediction, transfer,
   changed examples, and small conceptual variations;
3. `EXPAND` — offer a bounded extension direction while leaving all program
   changes to the learner.

The concerns remain distinct:

- Topic answers **WHAT** is learned;
- EffectiveTutorStrategy answers **HOW** the Tutor teaches;
- didactic phase answers **WHERE** the learner is in the bounded progression.

No repository may define another phase name, encode a phase only as a
strategy ID, or provide a workflow/expression language.

## Deterministic mastery

The application, not the LLM, decides mastery. Existing concept-level Topic
criteria remain authoritative:

- a successful probe is a valid rated observation whose `answerRating` meets
  the concept's `successRatingAtLeast`;
- `minimumSuccessfulProbes` counts those successful observations;
- every `requiredIndicators` entry needs a successful observation tied to that
  indicator;
- `minimumDistinctQuestionKinds` counts distinct kinds among successful
  observations;
- `recentWeakAnswersAllowed` applies to the existing trailing weak-answer
  streak after the latest non-weak observation; a weak answer means an
  `answerRating` of `1` or `2`.

One rated turn is associated with one question, concept, indicator, and kind. It
may count in each relevant aggregate but cannot satisfy multiple indicator IDs.
A rating of 5 is evidence only and never bypasses the configured criteria.
After each valid rated turn, the application reevaluates mastery against the
accumulated evidence. Mastery evidence and `effectiveDifficulty` remain
separate; adaptive difficulty does not declare mastery or replace a criterion.

Topic mastery is true when every concept with at least one currently applicable
question in the active Topic satisfies its concept criteria. A Topic with no
applicable concept is not mastered. Mastery is latched per Topic, session, and
Course revision; later weak answers do not erase the latch while the Topic and
sketch context remain valid. A context change that invalidates the Topic ends
the active state. If that Topic is selected again in a new sketch context, it
starts in LEARN.

## Phase transitions

`LEARN -> DEEPEN` occurs immediately when the application observes the Topic's
mastery transition from false to true. It requires no special user control and
no second LLM decision.

Teacher-authored `learningObjectives` remain additional emphasis in all three
phases. They may guide question, deepening, and extension direction, but never
define mastery, activate a Topic, or select a strategy.

The default `DEEPEN -> EXPAND` criterion is two successful post-mastery probes,
each rated at least 4, including at least one transfer probe, with no trailing
weak probe. Deepening evidence starts at the LEARN-to-DEEPEN transition.
Topics may later configure bounded equivalents using only fixed question kinds,
bounded integers, and the existing trailing-weak semantics.

When the sketch changes, UnoSim re-extracts facts and reruns normal Topic
precedence. A newly selected primary Topic starts in LEARN with independent
mastery evidence. A listed extension never activates a Topic by itself.

## Post-mastery strategy selection

LEARN retains the existing precedence:

1. valid embedded Example strategy;
2. repository `defaultStrategy`;
3. `built-in-default`.

A future versioned Tutor manifest may contain only the fixed optional entries
`phaseStrategies.deepen` and `phaseStrategies.expand`. For DEEPEN and EXPAND,
the precedence is:

1. valid embedded Example strategy;
2. the configured strategy for the fixed phase;
3. repository `defaultStrategy`;
4. `built-in-default`.

An absent phase entry falls back to the already effective LEARN strategy.
Phase entries reference strategies directly and cannot chain. Unknown or
invalid references invalidate the complete Tutor capability under the existing
capability-scoped fallback rule. This supports, for example, precision policy
in LEARN and exploration policy after mastery without creating circular
strategy transitions.

## Topic extensions

A Topic may declare at most eight extensions. Each extension contains only:

```yaml
topic: functions
objective: Repeated behavior can be moved into a function.
```

The target must be a safe Topic ID in the same validated Tutor bundle. The
objective is bounded teacher-authored data (maximum 500 Unicode characters,
trimmed, no control characters, URLs, prompts, roles, scripts, templates, or
expressions). It is educational guidance, not activation authority.

## Session-local state and boundaries

Conceptually, the phase state is pinned to the existing opaque Tutor session
and immutable Course revision and contains the active Topic, phase, mastered
Topic IDs, per-Topic evidence, and post-mastery evidence. It remains process-
local with the current one-hour TTL. Horizontal multi-instance deployment
requires shared state or a deliberately designed equivalent such as sticky
sessions.

Course source/ref/revision/context changes reset the dialog and didactic state.
`New learning question` and `New dialog` begin a fresh didactic session in the
current validated context: history, ratings, active Topic, phase, mastery
evidence, deepening evidence, and effective difficulty reset. Configured start
difficulty, provider/model selection, and transient credential behavior retain
their existing contracts. The next request is still explicitly user initiated.

Formal phases do not exist for free Tutor without an active Topic. Arbitrary
sketches with a matching Topic use the same phase model and repository/built-in
strategy resolution as Examples.

The one-primary-question rule, current-sketch factual authority, no-full-
solution rule, no automatic editor changes, provider/privacy boundaries,
response validation, and no persistent learner profile remain unchanged.

## Consequences

Positive consequences:

- mastery and phase transitions are deterministic and testable;
- post-mastery teaching can change policy without conflating phase and
  strategy;
- Topic extensions provide bounded forward direction without forcing Topics;
- arbitrary sketches can benefit whenever a Topic is factually applicable;
- no persistent learner model or autonomous LLM request is introduced.

Costs and constraints:

- Tutor session state must carry bounded phase and evidence metadata;
- Topic and Tutor-manifest schema versions need a future extension before
  repositories can author deepening, extensions, or phase strategies;
- invalid phase/extension data disables the complete repository Tutor bundle;
- multi-instance deployment needs shared or sticky Tutor-session state.

## Rejected alternatives

- **LLM-declared mastery:** rejected because mastery must be reproducible,
  bounded, and application-controlled.
- **Phase encoded only as a strategy ID:** rejected because Topic content,
  teaching policy, and learner progression are separate concerns.
- **Strategy-to-strategy chaining:** rejected because it creates circular and
  ambiguous transitions; fixed phase entries are direct references only.
- **Activating a Topic because an extension names it:** rejected because only
  deterministic current-sketch facts authorize Topic activation.
- **Automatic program modification:** rejected because the learner must decide
  whether and how to change the sketch.
- **Persistent learner profiling:** rejected because this feature is a
  session-local didactic control loop, not grading or a long-term competence
  database.
- **Autonomous background Tutor requests:** rejected to preserve explicit user
  initiation and cost control.
