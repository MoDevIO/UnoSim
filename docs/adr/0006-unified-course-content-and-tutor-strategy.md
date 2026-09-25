# ADR 0006: Unified Course Content and repository-controlled Tutor strategy

- Status: Accepted
- Date: 2026-09-24
- Owners: UnoSim maintainers and platform operators

## Context

UnoSim has two valuable but separate mechanisms:

1. External Examples already select a public GitHub repository and ref,
   resolve the ref to an immutable commit SHA, and cache validated snapshots.
2. The Tutor curriculum pilot loads structured topics from a separate source,
   matches them to typed sketch facts, and plans didactic steps before the
   LLM.

The separate Tutor source permits Examples and Tutor content to drift apart.
Lecturers also need to control examples, topics, questions, misconceptions,
mastery criteria, scaffolds, ordering, and questioning strategy from one
course-owned repository without rebuilding UnoSim.

## Decision

Course Content is one public repository/ref selection with two optional
capabilities:

~~~text
Course Content selection: repository + ref
                 |
          server resolves ref
                 |
      immutable Course revision (repository + SHA)
             /                         \
        Examples                    Tutor capability
                                      /        \
                                  topics    strategy
                                      \        /
                                   deterministic planner
                                           |
                                           LLM
~~~

The existing External Examples source-selection, GitHub ref resolver, secure
fetcher, cache, last-known-good semantics, and browser preference are extended
to carry the optional Tutor capability. No independent Tutor network, source,
ref picker, or revision authority is introduced.

The server loads and validates a complete immutable snapshot before activating
the Examples capability. Tutor validation is a separate capability-scoped
transaction within that revision. A Tutor-only failure leaves valid Examples
active and disables the entire Tutor repository capability. No partial Tutor
bundle can activate. Example-specific Tutor metadata is authored in an
optional terminal annotation in the declared main `.ino` file, extracted at
the server boundary, and carried separately from cleaned Example source.

Every Tutor request receives one normalized EffectiveTutorStrategy. The
repository strategy and the built-in built-in-default strategy use the same
normalization and planner interface. The system/security prompt remains
application code.

## Manifest and content format

Existing root manifest.json schema v1 remains the Examples-only format and
continues to work unchanged. Root schema v2 keeps the Examples fields and may
reference tutor/manifest.yaml.

The Tutor manifest enumerates only explicit topic and strategy files, each with
an ID, safe relative path, and SHA-256 digest. Empty topic or strategy lists
are valid. Example-level Tutor metadata is an optional validated annotation
containing embedded topics, a primary topic, a strategy, and bounded
`learningObjectives`. It is not a raw prompt and cannot override sketch
applicability. The complete UTF-8 annotation block is limited to 16 KiB before
YAML parsing. Manifest-level per-Example Tutor bindings are not the canonical
authoring mechanism and are not part of the published schema-v2 contract.

Tutor topics own learning content: concepts, prerequisites, objectives,
misconceptions, indicators, mastery, questions, content-specific scaffolds,
and concept order. Strategies own selection and response policy: question-kind
weights, remediation, clarification, progression, scaffolding, feedback,
repetition, hint behavior, and bounded adaptive-difficulty profile.

The generic topic model removes the pilot's literal one-topic assumption.
Pilot response-policy fields are compatibility input only and cannot override
the normalized strategy.

## Built-in strategy

The built-in strategy is normative UnoSim teaching policy:

| Field | Value |
|---|---|
| ID | built-in-default |
| Question weights | recall 10, concept 25, application 35, prediction 15, transfer 15 |
| Sketch specificity | prefer |
| Repetition | strict near-duplicate avoidance |
| Weak answers | scaffold-first remediation |
| Partial answers | same-indicator clarification |
| Strong answers | mastery-then-advance |
| Scaffolding | prefer content scaffolds |
| Feedback | short |
| Hint-first | enabled |
| Adaptive difficulty | existing LearningQuestions contract |

The weights are new normative built-in policy. They are not described as
weights already implemented by the pilot planner. Adaptive difficulty retains
the existing LearningQuestions contract, including rating deltas
-6/-3/0/+2/+4, the existing rating window, clamp, and step limits.

### Strategy is behavior, not metadata

Every normal Tutor request uses exactly one EffectiveTutorStrategy before the
planner, prompt, or dialog behavior is produced. This includes planned and
free Tutor requests, arbitrary/local sketches, strategy-only repositories,
Topic mismatches, Examples-only repositories, no repository, and invalid Tutor
capability fallback. Topic selection answers what should be learned; strategy
selection answers how it should be taught. Reaching the free Tutor path does
not reset a valid repository defaultStrategy to built-in-default.

For a valid active Example, a defined embedded Example strategy wins; otherwise the
validated Tutor manifest defaultStrategy wins; otherwise built-in-default wins.
For an arbitrary/local sketch, the repository defaultStrategy is therefore
still effective. A response that reports repository `strategySource` and
`strategyId` without having consumed that strategy in the behavior-producing
path is non-conformant.

The strategy fields have operational semantics in the Course Content and
LearningQuestions SSOTs. Question-kind weights are deterministic preferences,
not frequency guarantees. Closed enum values control specificity, repetition,
remediation, clarification, progression, scaffolding, feedback verbosity, and
hint sequencing in both planned and free paths. Schema-version-1
`current-contract` delegates adaptive difficulty to the existing contract and
cannot redefine deltas. All guidance is application-owned text derived from
normalized data; the repository cannot provide prompt instructions.

## Strategy safety boundary

Repository strategies use a strict versioned schema with closed enums and
bounded numbers. They cannot contain or control:

- system/user/assistant roles or any prompt/system prompt field;
- raw prompt templates or arbitrary template execution;
- JavaScript, executable expressions, or arbitrary regular expressions;
- URLs, external resources, or network instructions;
- security, privacy, provider, Mermaid, response-validation, or editor rules.

Repository text is untrusted structured data and reaches only validated
didactic User-context paths.

## Selection and fallback

Strategy precedence is deterministic:

1. embedded Example strategy;
2. Tutor manifest default strategy;
3. built-in strategy.

Topic precedence is deterministic:

1. applicable embedded Example primary topic;
2. other applicable embedded Example topics;
3. fact-matched repository topics;
4. free Tutor path when no topic applies.

The current sketch remains factual authority. Embedded topics never force a
question whose requirements do not match current sketch facts. Validated
Example learning objectives are additional didactic emphasis in both planned
and free Tutor paths; they do not replace Topic objectives, change strategy
semantics, or authorize invented sketch facts.

The fallback matrix is:

| Condition | Examples | Tutor repository content | Tutor strategy |
|---|---|---|---|
| no Course repository | built-in | none | built-in |
| valid Examples-only repository | repository | none | built-in |
| valid topics without strategy | repository | topics | built-in |
| valid strategy without topics | repository | none | repository strategy |
| valid topics and strategy | repository | topics and strategy | repository strategy |
| invalid Tutor descriptor/manifest/file/reference | repository if core valid | none; whole Tutor bundle disabled | built-in |
| unavailable current immutable Tutor snapshot | repository if core valid | none unless exact same revision is cached | built-in |

Diagnostics include a safe fallback reason. Tutor content from a different
revision is never substituted for the active revision.

## Browser override governance

The existing browser-scoped repository/ref override remains supported. It is
the single Course Content override, so it affects both Examples and Tutor for
that browser. It is stored only as a non-sensitive personal preference and
does not modify the operator default or another user's browser. This ADR does
not add lecturer locks, roles, or governance controls.

## Revision and session consistency

Ref resolution and revision authority remain server-side. Browser-provided
repository/ref/revision/example metadata is untrusted. The server validates or
derives the immutable Course context and verifies any example/revision claim
against the selected snapshot before Tutor content is used.

An active Tutor dialog is pinned to its Course revision. Updating a moving ref
may activate revision B for new contexts while an existing dialog remains on
revision A. Course source, revision, or example-context changes reset the
dialog. A missing revision B falls back to the built-in Tutor; it never uses
Tutor content cached for A.

The current opaque-session store is process-local in-memory state with a
one-hour TTL and therefore assumes the current single-backend topology.
Horizontal multi-instance deployment requires shared Tutor-session state or an
explicitly designed equivalent such as sticky-session guarantees.

## Migration

The old independently configured Tutor source is removed. The old Tutor source
environment variables are explicit startup tombstones and cannot be silently
ignored or combined with Course Content. Operators move the files into the
Course Content repository and continue using the existing Examples source/ref
configuration names.

ADR 0004 remains in the tree as superseded pilot history. ADR 0005 remains
authoritative for browser-scoped Examples selection and ref resolution.

## Consequences

Positive consequences:

- one repository and one immutable revision explain all active course content;
- existing Examples repositories remain usable;
- Tutor remains fully functional without repository Tutor data;
- Tutor security and system policy stay in application code;
- revision consistency becomes testable and diagnosable.

Costs and constraints:

- the Examples snapshot loader and cache must carry optional Tutor data;
- the Tutor API must carry validated Course context and safe metadata;
- the browser must reset Tutor context when Course content changes;
- Tutor content authors must maintain strict manifests, hashes, and bounded
  schemas.

## Rejected alternatives

- **Separate Tutor repository:** rejected because it creates split-brain
  revision and browser configuration semantics.
- **Tutor as a monolithic root validation dependency:** rejected because one
  optional Tutor typo would unnecessarily disable valid Examples.
- **Raw client-provided SHA as authority:** rejected because request metadata is
  untrusted and could select unrelated repository content.
- **Repository-controlled system prompt:** rejected because it would turn
  lecturer content into an unrestricted prompt-injection boundary.
- **Lecturer-lock/role controls in this feature:** deferred to a separate
  governance decision.
