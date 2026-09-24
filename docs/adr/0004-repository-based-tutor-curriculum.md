# ADR 0004: Repository-based Tutor curriculum (historical pilot)

- Status: Superseded by ADR 0006
- Date: 2026-09-11
- Scope: historical single-topic pilot

## Context

UnoSim first implemented a pilot that loaded one memory-and-data-types topic
from a separately configured, pinned HTTPS source. The pilot established the
useful boundaries that remain part of the current architecture:

- strict data-only YAML;
- explicit manifests and file hashes;
- bounded downloads and reference validation;
- typed sketch facts and deterministic topic matching;
- deterministic planning before the LLM;
- normalized didactic context rather than repository prompts;
- free Tutor fallback when the curriculum is unavailable or inapplicable.

The separate Tutor source created a second repository/ref/revision authority.
That split is no longer permitted.

## Decision history

This pilot decision is retained as historical evidence only. The normative
successor is
[0006-unified-course-content-and-tutor-strategy.md](0006-unified-course-content-and-tutor-strategy.md),
which moves optional Tutor content into the same Course Content repository and
immutable revision as Examples.

The current contract generalizes the pilot to multiple topics and strategies,
introduces EffectiveTutorStrategy with one built-in fallback, and keeps
Examples valid when the optional Tutor capability is absent or invalid.

The in-tree curriculum/ files remain fixtures and authoring examples. They
are not a second production source.

## Pilot components retained as implementation guidance

~~~text
SketchFactExtractor
  -> TopicMatcher
  -> LearningPlanner
  -> TutorService
  -> LLMProvider
~~~

The planner remains deterministic. The LLM may evaluate and formulate within
the application-owned Tutor contract, but it does not own curriculum policy.

## Pilot security boundaries retained

- HTTPS and operator allowlists;
- no redirects, private/reserved destinations, or IP literals;
- full immutable revisions and per-file hashes;
- bounded files, bytes, IDs, text, and dependency graphs;
- no URLs, prompt roles, arbitrary regexes, or executable rules in content;
- no repository text in the server system prompt;
- all-or-nothing activation of a Tutor bundle;
- free Tutor fallback when no validated plan is available.

## Consequences

Existing pilot-specific configuration variables are obsolete and are explicit
startup tombstones. Operators migrate content into the configured Course
Content repository; they do not configure a second Tutor repository.

Future implementation details MUST follow the Course Content SSOT and ADR 0006.
