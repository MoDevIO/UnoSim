# Course Content Repository — SSOT

Status: current
Zielrolle: feature-contract
Scope: unified repository-controlled Examples and optional Tutor content

This document is the normative contract for the single Course Content source.
It complements the detailed Examples contract in
ssot_function_definition_ExternalExamples.md and the Tutor behavior contract
in ssot_function_definition_LearningQuestions.md.

## 1. Purpose

UnoSim SHALL allow a lecturer to change Examples and optional Tutor teaching
content by updating one public GitHub repository and its configured ref. A
normal content update SHALL NOT require an UnoSim rebuild or redeployment.

For every activated Course Content context, Examples and Tutor content SHALL
be selected from the same canonical repository and the same immutable full
commit revision.

The repository may control structured educational data and bounded teaching
policy. It SHALL NOT control UnoSim's system prompt, security rules, provider
boundary, or editor behavior.

## 2. Goals and non-goals

The feature SHALL support:

- existing Examples-only repositories without changes;
- optional multi-topic Tutor content in the same repository;
- optional repository teaching strategies;
- browser-scoped Course Content repository/ref overrides;
- immutable revision snapshots, source-keyed refresh, and revision-keyed reuse;
- a complete built-in Tutor fallback when no repository or valid Tutor bundle
  is available;
- deterministic topic and strategy selection before the LLM is called.

The feature SHALL NOT add:

- a second Tutor repository or ref selector;
- private-repository credentials or GitHub write access;
- a lecturer-lock or role/governance feature;
- unrestricted repository prompts, scripts, templates, regexes, URLs, or
  executable rules;
- persistent Tutor history, learner profiles, or automatic editor changes.

## 3. Terminology

**Course Content selection** is the effective repository + ref pair selected
by server configuration or a valid browser override.

**Course revision** is the full 40-character commit SHA resolved server-side
from a Course Content selection.

**Course snapshot** is the fully loaded and validated content associated with
one repository + revision. It contains the Examples capability and may contain
a Tutor capability.

**Tutor capability** is the optional, atomically validated set of the Tutor
manifest, its referenced topics, its referenced strategies, and all validated
embedded Tutor annotations extracted from Example main files. Manifest-level
per-Example Tutor bindings are not a published authoring mechanism.

**EffectiveTutorStrategy** is the normalized strategy used by every Tutor
request. It is always present, including in built-in/free Tutor mode.

The strings source, revision, strategyId, and topicId in diagnostics are
metadata. They are never authorization credentials.

## 4. One source hierarchy

The effective Course Content selection SHALL be determined in this order:

1. the validated server/operator default repository and ref;
2. a valid browser Course Content override for that browser;
3. the server-resolved full commit SHA for that selection.

The existing External Examples selection, validation, ref resolver, SSRF
protections, caches, and browser preference remain authoritative. The Tutor
MUST consume that same selection. There is no independent Tutor source.

A browser override therefore changes both capabilities for that browser:

~~~text
one Course Content repository + ref
              |
       server resolves ref
              |
       immutable Course revision
          /              \
     Examples            Tutor
~~~

The override is a personal, non-sensitive browser preference. It MUST NOT
change the operator default, another browser's selection, or server-wide
state. Existing unoExternalExamplesSelection persistence remains supported.
The user-facing Settings label MAY become Course Content, but there remains
exactly one repository/ref selector.

## 5. Revision authority and untrusted browser metadata

Repository, ref, revision, example ID, and Tutor context values received from
the browser are untrusted request metadata. A browser-provided SHA SHALL NOT
by itself authorize or select Tutor content.

The server MUST validate or derive the immutable context before using it:

- a repository/ref pair is validated with the existing Course/Examples
  selection rules and its ref is resolved to a full SHA by the server;
- an example revision is accepted only after the server verifies that the
  revision belongs to the effective Course selection and that the requested
  example exists in that immutable snapshot;
- a new Tutor session for a non-example sketch resolves the effective Course
  selection at session start and pins the resulting server-derived revision;
- an exact revision may be reused from the revision cache only when its
  canonical repository and full SHA match the validated Course context.

Stage B MAY implement this validation with a server-issued context handle,
server-side re-resolution plus exact-revision checks, or an equivalent
mechanism. It MUST NOT treat arbitrary client-provided revision metadata as
the content authority.

## 6. Repository structure and manifest versions

The repository root contains manifest.json.

### 6.1 Root manifest schema v1

Schema v1 is the existing Examples-only format. It remains valid unchanged.
Its examples entries and optional legacy repository/ref metadata retain their
existing meaning. A v1 repository has no active repository Tutor capability
and uses the built-in Tutor strategy.

### 6.2 Root manifest schema v2

Schema v2 retains the Examples structure and adds an optional Tutor descriptor:

~~~json
{
  "schemaVersion": 2,
  "examples": [
    {
      "id": "arrays-example",
      "title": "Arrays",
      "category": "Data",
      "main": "main.ino",
      "files": [
        { "name": "main.ino", "path": "examples/arrays/main.ino" }
      ]
    }
  ],
  "tutor": {
    "manifest": "tutor/manifest.yaml"
  }
}
~~~

tutor at the root is optional. Example-specific Tutor metadata is not a root
manifest field. When present, it is authored only in the terminal structured
annotation of the Example's declared main `.ino` file. The exact existing
Examples fields remain authoritative for Examples.

The root is validated in capability-scoped phases, not as one monolithic
object:

1. parse and validate the root/core schema and Examples references;
2. if core validation succeeds, inspect the optional Tutor descriptor and
   terminal main-file annotations independently;
3. activate the Examples capability if and only if core validation succeeds;
4. activate the Tutor capability only if every Tutor descriptor, referenced
   Tutor file, hash, schema, graph, and annotation reference succeeds.

An invalid or missing optional Tutor descriptor SHALL NOT invalidate otherwise
valid Examples. A Tutor-only failure produces examples = valid and Tutor
capability = invalid, followed by the complete built-in Tutor fallback.
Unknown fields in the core Examples portion remain core validation errors.
Unknown fields in Tutor descriptors or Tutor files are Tutor validation errors
only.

Only explicitly referenced files may be fetched. Directory crawling is
forbidden. Paths must be bounded, relative, rooted below the expected tutor/
or Examples path, and free of traversal, URL, host, and query syntax.

### 6.3 Embedded Example Tutor annotation

Example-specific Tutor metadata SHALL be stored at the end of the Example's
declared main `.ino` file. It is optional and is not part of normal Example
source. The canonical block is:

~~~cpp
/* @unosim-tutor
schemaVersion: 1
topics:
  - functions
primaryTopic: functions
strategy: exploration-policy
learningObjectives:
  - Funktionen und ihren Zweck verstehen.
  - Übergabeparameter verstehen.
@end-unosim-tutor */
~~~

There SHALL be zero or one such block per Example. Only the declared main
`.ino` may contain it; secondary files and `.h` files may not define one. The
opening marker is exactly `/* @unosim-tutor` and the closing marker is exactly
`@end-unosim-tutor */`. The block MUST occur after the final C++ token of the
sketch, and only whitespace may follow its closing marker. A duplicate block,
a marker in the middle of executable source, or an unterminated block is
invalid. An annotation is optional.

The annotation payload is strict YAML core data with schema version 1 and no
additional fields:

~~~yaml
schemaVersion: 1
topics: [functions]
primaryTopic: functions
strategy: exploration-policy
learningObjectives:
  - Funktionen und ihren Zweck verstehen.
~~~

`topics` is an optional list of safe Tutor IDs. `primaryTopic` is optional but
requires `topics` and MUST be one of its values. `strategy` is an optional safe
Tutor Strategy ID. `learningObjectives` is an optional list of at most 10
teacher-authored objectives; every objective is trimmed, non-empty, at most
500 Unicode characters, and free of NUL/control characters. Objectives are
plain bounded data: Markdown, HTML, executable/template semantics, and nested
structures are not interpreted. YAML duplicate keys, custom tags, unknown
fields, unsupported schema versions, invalid IDs, and invalid bounds make the
annotation invalid.

The server extracts and validates the block at the Course Content loading
boundary. The annotation travels separately in the immutable server snapshot.
The Example API, browser/editor, compiler, and simulator receive only the
cleaned sketch source, with a normal trailing newline preserved. Removing the
block does not alter the line numbers of the actual preceding C++ program.

If a structurally recognized block has invalid YAML or schema data, the server
MUST strip/hide the block, keep the cleaned Example usable, and mark the whole
repository Tutor capability invalid. No partial repository Tutor bundle may
activate. An unterminated or otherwise malformed marker has the same safe
deterministic outcome: no teacher metadata is exposed or executed, and the
Tutor capability falls back completely when validation cannot establish a
valid annotation boundary.

## 7. Tutor manifest and Tutor bundle atomicity

The optional tutor/manifest.yaml uses schema version 1:

~~~yaml
schemaVersion: 1
defaultStrategy: socratic
topics:
  - id: arrays
    path: tutor/topics/arrays.yaml
    sha256: <64 lowercase hexadecimal characters>
strategies:
  - id: socratic
    path: tutor/strategies/socratic.yaml
    sha256: <64 lowercase hexadecimal characters>
~~~

defaultStrategy is optional. topics and strategies may each be empty; this
explicitly supports a strategy-only repository and a topics-only repository.
IDs are unique, lower-case safe IDs. File counts, individual file sizes, total
Tutor bytes, and total referenced files are bounded by server configuration.

Tutor capability validation is all-or-nothing:

- a bad Tutor manifest invalidates the whole Tutor capability;
- a missing or hash-mismatched topic or strategy invalidates the whole Tutor
  capability;
- an unknown field, unsupported schema version, duplicate ID, invalid path,
  invalid dependency, cyclic dependency, or broken question/scaffold/mastery
  reference invalidates the whole Tutor capability;
- an annotation referring to an unknown topic or strategy invalidates the
  whole Tutor capability;
- an invalid embedded annotation invalidates the whole Tutor capability but
  does not invalidate otherwise valid Examples;
- no arbitrary subset of valid Tutor files may activate.

The Examples capability remains active whenever its own core snapshot is valid.
Tutor diagnostics MUST expose the capability fallback reason without exposing
secrets or raw untrusted file contents.

## 8. Topic model

Topics describe what should be learned. A generic topic owns:

- id, title, locale, and bounded objective text;
- closed fact-based activation requirements;
- concepts and their bounded prerequisites;
- misconceptions and indicators;
- mastery requirements;
- question text/data, question kind, applicability requirements, and
  difficulty ranges;
- content-specific scaffolds and their next-question references;
- entry concepts and preferred concept order.

The supported question kinds remain exactly:
recall, concept, application, prediction, and transfer.

The current one-topic pilot assumption memory-and-data-types is removed from
the generic schema. The existing pilot fields are normalized as follows:

- concept, question, scaffold, mastery, fact-matcher, and dependency data are
  retained where valid;
- concept order remains topic content;
- response-policy fields such as rating-to-action mappings are owned by
  EffectiveTutorStrategy, not by a topic;
- any legacy pilot response-policy field is accepted only through an explicit
  compatibility normalizer and cannot override the effective strategy.

Repository text is untrusted educational data. It is bounded, control-character
checked, URL-free, and passed only as structured didactic context.

## 9. Strategy model

Strategies describe how the Tutor teaches. A strategy file uses a strict,
versioned, closed schema:

~~~yaml
schemaVersion: 1
id: socratic
questionKindWeights:
  recall: 10
  concept: 25
  application: 35
  prediction: 15
  transfer: 15
sketchSpecificity: prefer
repetition: strict
remediation: scaffold-first
clarification: same-indicator
progression: mastery-then-advance
scaffolding: prefer-content
feedbackVerbosity: short
hintFirst: true
adaptiveDifficulty: current-contract
~~~

The schema SHALL enforce:

- all five question-kind weights are present, integers in 0..100, and sum to
  100;
- closed enums for sketch specificity, repetition, remediation,
  clarification, progression, scaffolding, feedback verbosity, and adaptive
  difficulty;
- bounded IDs and no additional fields;
- no prompt, role, systemPrompt, assistantPrompt, rawPrompt, URL, executable
  expression, JavaScript, arbitrary regex, or external resource field.

Strategy values influence the behavior-producing path for every Tutor request.
They cannot make an inapplicable question eligible, override sketch facts,
remove the one-question invariant, disable response validation, or replace
application-owned safety rules. The same normalized strategy contract is used
by deterministic curriculum planning and by the free-Tutor prompt/dialogue
path; strategy metadata attached after generation is not strategy application.

The built-in strategy is normative UnoSim policy, not a claim about the
weights of the current planner. Its exact values are:

| Field | Built-in value |
|---|---|
| ID | built-in-default |
| question weights | recall 10, concept 25, application 35, prediction 15, transfer 15 |
| sketch specificity | prefer |
| repetition | strict near-duplicate avoidance |
| weak answer | scaffold-first remediation |
| partial answer | same-indicator clarification |
| strong answer | mastery-then-advance |
| scaffolding | prefer-content |
| feedback | short |
| hint-first | true |
| adaptive difficulty | current-contract |

current-contract preserves the existing LearningQuestions semantics: the rating
deltas are 1: -6, 2: -3, 3: 0, 4: +2, and 5: +4, within the existing
1..100 clamp, bounded recent-rating window, and per-step limits. These values
are inherited from the existing LearningQuestions contract; the question
weights above are new normative built-in policy and are not described as an
existing planner weighting.

### 9.1 Normative strategy behavior

Every normal Tutor request SHALL use exactly one EffectiveTutorStrategy before
the behavior-producing path runs. This includes:

1. a repository Topic with an embedded Example annotation;
2. a repository Topic without an embedded Example annotation;
3. a repository strategy with no Topics;
4. a repository with Topics when no Topic matches the current sketch;
5. an arbitrary, self-written, or local sketch;
6. an Examples-only repository;
7. no Course repository; and
8. an invalid Tutor capability fallback.

Topic planning and strategy selection are independent concerns. A Topic answers
what should be learned. An EffectiveTutorStrategy answers how the Tutor
teaches. Reaching the free-Tutor path because no Topic applies MUST NOT reset a
repository-selected strategy to built-in-default. Only an invalid Tutor
capability disables repository Topics and repository Strategies together.

The strategy precedence is:

1. an embedded Example strategy, but only when a valid active Example context
   defines that strategy;
2. the validated Tutor manifest defaultStrategy; then
3. built-in-default.

Arbitrary or local sketches have no per-example strategy and therefore use the
repository defaultStrategy when available, otherwise built-in-default.

The Topic precedence remains:

1. applicable embedded primaryTopic;
2. other applicable embedded Topics;
3. fact-matched repository Topics; then
4. no Topic, using the free Tutor path with the already selected
   EffectiveTutorStrategy.

The operational meaning of the strategy fields is:

- `questionKindWeights` are deterministic preferences among otherwise
  applicable candidate questions after factual applicability and difficulty
  constraints. In the free Tutor path they become application-owned guidance
  about preferred question kinds. They are not statistical frequency
  guarantees. A zero weight means least preferred and avoided when an
  alternative exists; it is not an absolute prohibition when only that kind
  is pedagogically and factually possible.
- `sketchSpecificity: prefer` keeps every question related to the current
  sketch while allowing one conceptual or transfer step beyond literal code;
  `strict` anchors the question directly in concrete constructs or facts in
  the sketch. Neither mode permits invented sketch facts.
- `repetition: strict` avoids semantic near-duplicates and repairs or
  regenerates a repeated question where possible; `relaxed` permits a
  meaningful revisit from a different angle while still avoiding literal or
  near-identical repetition. Core anti-loop safety applies to both.
- `remediation: scaffold-first` provides a bounded hint or scaffold before
  the next focused question after a weak answer; `question-first` prefers a
  smaller diagnostic question without an immediate content hint, while still
  allowing brief feedback that identifies the gap.
- `clarification: same-indicator` stays on the same immediate conceptual or
  code aspect with a distinct probe; `new-indicator` prefers a neighboring
  aspect of the same learning context before returning to the previous one.
  Free mode does not invent formal indicator IDs.
- `progression: mastery-then-advance` may use a consolidation or mastery probe
  after a strong answer before advancing; `advance-immediately` moves directly
  to another relevant concept or aspect where possible after the existing
  answerRating semantics identify a sufficiently strong answer.
- `scaffolding: prefer-content` prefers a valid Topic content scaffold and
  falls back to generated, application-owned scaffolding when none exists or
  no Topic plan exists; `prefer-generated` prefers generated scaffolding even
  when content scaffolds exist unless a content-specific prerequisite is
  necessary for factual correctness.
- `feedbackVerbosity: short` requests bounded concise classification or hint
  feedback; `detailed` requests a somewhat fuller explanation of the gap or
  reasoning. Both remain within existing response/input limits and never
  authorize a full solution.
- `hintFirst: true` places a bounded hint before the next question when
  assistance/remediation is appropriate; `false` prefers the next diagnostic
  question first. It is didactic sequencing, not a UI-layout setting and does
  not alter the one-primary-question rule.
- `adaptiveDifficulty: current-contract` uses the existing LearningQuestions
  adaptive-difficulty algorithm and limits. Strategy schema version 1 cannot
  redefine difficulty deltas. Future profiles require an explicit schema and
  SSOT extension.

The LLM is not required to produce a question-kind distribution matching the
configured weights. All guidance text is owned by UnoSim and is generated from
the normalized closed values; repository files never supply raw instructions.

An observed response is conformant only when `strategySource` and
`strategyId` identify the EffectiveTutorStrategy that actually influenced the
applicable planner, prompt, or dialogue behavior. Adding those fields after a
behavior has already been generated is metadata-only and is a conformance
failure.

## 10. Strategy and topic precedence

For an active Course example, strategy precedence is:

1. valid embedded tutor.strategy when there is a valid active Example context
   that defines it;
2. valid Tutor manifest defaultStrategy;
3. built-in-default.

For an arbitrary or self-written sketch without a valid Course-example
annotation, the Tutor manifest defaultStrategy and then the built-in strategy
apply. A repository defaultStrategy therefore affects arbitrary programs too.

Topic selection is:

1. applicable embedded primaryTopic;
2. other applicable embedded topics;
3. applicable topics matched from extracted sketch facts;
4. no repository topic, so use the free Tutor path without changing the
   already selected EffectiveTutorStrategy.

Embedded topics and primaryTopic are preferences, not factual authority. If
editing makes an embedded topic inapplicable, it is skipped. The matcher may
select another applicable topic; it MUST NOT force an unsupported question.

### 10.1 Example learning objectives

`learningObjectives` answer **what this learner should understand in relation
to this Example**. They are teacher-authored didactic data and do not define
how the Tutor behaves. The teaching method remains the selected
EffectiveTutorStrategy. A Topic is reusable structured curriculum knowledge;
learning objectives are Example-specific teacher emphasis; the UnoSim Tutor
system/application rules remain non-configurable.

When a valid Example annotation has learning objectives and a Topic matches,
the planned Tutor context contains the Topic plan, applicable objectives,
current sketch facts, and the EffectiveTutorStrategy. When objectives exist
but no Topic matches, the free Tutor still receives the objectives together
with the same selected EffectiveTutorStrategy. Reaching the free path MUST
NOT discard objectives.

Objectives remain subordinate to the current sketch as factual authority,
Tutor safety rules, the no-complete-solution rule, the response schema, and
the one-question contract. An objective that is unsupported by the current
sketch may guide bounded reflection, but MUST NOT cause the Tutor to invent
facts. UnoSim owns all instruction text used to present objectives to the
provider; repository objective text is never a raw prompt or instruction
channel.

## 11. Effective strategy and Tutor fallback matrix

Every Tutor request uses exactly one normalized EffectiveTutorStrategy.
There is one built-in implementation of that strategy in application code.
Repository strategies are normalized into the same type and planner path.

| Case | Examples | Tutor topics | Effective strategy | Tutor behavior |
|---|---|---|---|---|
| A. no Course repository | built-in | none | built-in-default | free sketch-based Tutor |
| B. valid Examples-only repository | repository | none | built-in-default | free sketch-based Tutor |
| C. valid topics, no strategy | repository | repository topics | built-in-default | repository topics with built-in policy |
| D. valid strategy, no topics | repository | none | repository strategy | free Tutor with repository teaching policy |
| E. valid topics and strategy | repository | repository topics | repository strategy | repository-controlled deterministic planning |
| F. invalid Tutor descriptor/manifest/file/reference | repository if core valid | none active | built-in-default | free Tutor; no partial Tutor bundle |
| G. current revision unavailable | repository if core valid | none unless exact revision cached | built-in-default | built-in fallback; never another revision |

Missing Tutor content is not an error for Examples. A topic mismatch is not a
reason to disable a valid repository strategy; the free Tutor uses the
selected strategy when no topic plan exists. An invalid Tutor bundle is
different: all repository Tutor topics and strategies are disabled together.

Diagnostics SHALL distinguish at least no-repository, no-tutor-manifest,
invalid-tutor-bundle, snapshot-unavailable, and no-matching-topic where
applicable. Diagnostics are safe metadata, not a prompt channel.

## 12. Source and session metadata

Tutor responses MAY expose the following bounded metadata:

- content source: built-in or repository;
- canonical repository, selected ref, and server-derived revision;
- strategy source: built-in or repository;
- effective strategyId;
- topicId, conceptId, questionId, indicator, and question kind where
  applicable;
- a bounded fallback reason where applicable.

strategyId identifies a teaching strategy. Scaffold identity is separate. No
credential, private URL, or raw repository payload is exposed.

For a Tutor dialog:

- an external Course example loaded from revision A uses Tutor data from A;
- a ref update to B affects only a new Course context or new dialog;
- an active dialog remains pinned to A;
- changing Course selection, revision, or example context resets the dialog;
- no dialog history may contain turns from different Tutor revisions;
- if exact revision B cannot be loaded, content from A is never substituted.

## 13. Capability status and Settings

The existing Examples catalog/source response remains the single source for
Course Content status. It MAY report:

- repository, ref, revision, stale/cache status;
- Examples capability status/count;
- Tutor capability status, topic count, strategy count, selected strategy;
- safe Tutor fallback reason.

Settings SHALL present one Course Content repository/ref selection and make the
effective revision and Tutor status understandable. It SHALL not provide a
Tutor-specific selector. Apply remains transactional and Reset returns to the
server default.

## 14. Security invariants

The following are application-owned and cannot be changed by repository data:

- server-side system/security prompt;
- no arbitrary system/user/assistant prompt roles;
- exactly one primary learning question;
- no unrestricted general chat;
- no automatic full solution or editor modification;
- current sketch as factual authority;
- Tutor privacy and transient credential rules;
- Mermaid restrictions;
- server-side provider isolation;
- response schema validation;
- HTTPS, allowlist, SSRF, redirect, path, size, count, timeout, and cache
  limits;
- immutable SHA loading and same-revision consistency.

Strategy values are bounded teaching data, not instructions. They cannot
override the system or safety prompt, the one-primary-question invariant, the
current sketch as factual authority, no-full-solution/replacement-sketch
rules, provider isolation, credential/privacy rules, Mermaid safety, response
schemas, answerRating semantics, persistent-storage rules, maximum lengths, or
validation behavior.

No Tutor YAML may contain systemPrompt, prompt, role, rawPrompt,
promptTemplate, JavaScript, executable expressions, arbitrary regexes, URLs,
or external resources. Text is data only and enters structured User-context /
DidacticBrief paths.

## 15. Migration and compatibility

The old independently configured Tutor source is removed. These environment
variables are startup tombstones and MUST fail explicitly when present:

- UNOSIM_TUTOR_CURRICULUM_SOURCE;
- UNOSIM_TUTOR_CURRICULUM_COMMIT;
- UNOSIM_TUTOR_CURRICULUM_ALLOWED_HOSTS;
- UNOSIM_TUTOR_CURRICULUM_REFRESH_MS;
- UNOSIM_TUTOR_CURRICULUM_TIMEOUT_MS;
- UNOSIM_TUTOR_CURRICULUM_MAX_MANIFEST_BYTES;
- UNOSIM_TUTOR_CURRICULUM_MAX_TOPIC_BYTES;
- UNOSIM_TUTOR_CURRICULUM_MAX_TOTAL_BYTES.

They MUST NOT be silently ignored or combined with Course Content. Operators
must migrate Tutor files into the configured Course Content repository and use
the Course repository/ref settings. UNOSIM_EXAMPLES_SOURCE and
UNOSIM_EXAMPLES_REF remain the underlying technical names for the one
selection.

The in-tree curriculum/ files are authoring/test fixtures only. They are not a
production source and do not create a second runtime content path.

## 16. Required conformance tests

Stage B SHALL test at least:

- no repository, Examples-only v1, topics-only, strategy-only, and full v2;
- invalid Tutor descriptor while Examples remain valid;
- invalid Tutor manifest, topic, strategy, missing reference, unknown field,
  bad hash, dependency cycle, and broken binding with no partial activation;
- strategy influence on question kind, remediation, clarification,
  progression, scaffolding, repetition, and bounded difficulty behavior;
- built-in strategy values through the same normalization interface;
- example binding and primary-topic precedence, code-edit fallback, and fact
  matching;
- revision A/B consistency, exact-revision cache reuse, dialog reset, and no
  stale cross-revision substitution;
- browser override affecting both capabilities without changing the server
  default;
- old Tutor source variables failing at startup;
- no repository-controlled system prompt, roles, URLs, executable content, or
  direct browser-to-GitHub access.

This SSOT is complete only when implementation and tests preserve the above
capability separation and fallback behavior.
