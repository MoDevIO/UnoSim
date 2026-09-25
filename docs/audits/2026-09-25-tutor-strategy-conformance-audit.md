# Tutor Strategy Conformance Audit

Date: 2026-09-25
Baseline: `6f3676d40fb5ce5f8eab625d035b77f2f99b9016`
Stage-A SSOT commit: `cc516953`

## Scope and conclusion

This is a read-only audit of the merged Course Content Tutor implementation
against the strengthened Course Content and LearningQuestions SSOT. No
implementation or test file was modified for this audit.

The implementation has one normalized strategy schema and resolves the
precedence metadata correctly. The conformance gap is behavioral: in the free
initial path `TutorService.generateQuestion` resolves a strategy but calls
`buildUserPrompt` without it (`server/services/tutor/tutor-service.ts:449-464`).
The free dialog path has the same problem: `generateDialogResponse` resolves a
strategy but calls `buildDialogPrompt` without it and uses hard-coded
remediation/progression/repetition behavior (`tutor-service.ts:472-503`). The
result is then decorated by `applyStrategyMetadata`, so a repository strategy
can be reported without having influenced the behavior-producing path.

The deterministic planner consumes `questionKindWeights` only as a tie-break
in `selectQuestion` (`server/services/tutor/curriculum/learning-planner.ts:257-272`).
Its remediation, clarification, progression, scaffolding, and repetition
decisions are currently fixed policy. The remaining strategy fields never
reach planner or free-Tutor guidance.

## Strategy conformance matrix

`N/A` means the field has no operational decision before an initial question
exists under the SSOT. `PASS` means the current contract is deliberately
preserved, not that schema v1 supports an alternate behavior.

| Strategy field | Planned initial | Planned dialog | Free initial | Free dialog | Existing tests | Status |
|---|---|---|---|---|---|---|
| `questionKindWeights` | PASS: `selectQuestion` ranks otherwise applicable candidates after difficulty | PARTIAL: fallback candidate selection uses weights, but scaffold/clarification/mastery branches bypass them | MISSING: `buildUserPrompt` receives no strategy | MISSING: `buildDialogPrompt` receives no strategy | `multi-topic.test.ts:55-61` tests only planner tie-break | PARTIAL |
| `sketchSpecificity` | MISSING: no planner read | MISSING: no planner read | MISSING: no free guidance | MISSING: no dialog guidance | schema-only coverage in `effective-tutor-strategy.test.ts` | MISSING |
| `repetition` | MISSING: `usedQuestionIds` is unconditional strict avoidance | MISSING: same unconditional ID policy; strategy is ignored | N/A | MISSING: `ensureDistinctDialogQuestion` always applies the same similarity threshold | repetition behavior is covered only as built-in hard-coded behavior in `tutor-service.test.ts` | MISSING |
| `remediation` | N/A | MISSING: `selectAfterRating` always calls `selectRemediation`; `chooseScaffold` always runs before question selection | N/A | MISSING: `getRemediationInstruction` is hard-coded scaffold-first | `curriculum.test.ts:96-110` tests only the default path | MISSING |
| `clarification` | N/A | MISSING: `selectClarification` always stays on the same indicator | N/A | MISSING: dialog prompt has no strategy-controlled aspect choice | no behavioral strategy test | MISSING |
| `progression` | N/A | MISSING: `selectAdvance` always tries a mastery probe before moving on | N/A | MISSING: `getProgressionInstruction` hard-codes mastery/advance behavior | `tutor-service.test.ts:278-302` tests only built-in behavior | MISSING |
| `scaffolding` | N/A | MISSING: `chooseScaffold` always prefers Topic content and has no generated-preference policy | N/A | MISSING: no strategy guidance or content/generated decision | `curriculum.test.ts:108-110` tests only content scaffold output | MISSING |
| `feedbackVerbosity` | N/A | MISSING: provider prompt does not receive the field | N/A | MISSING: provider prompt does not receive the field | no behavioral test | MISSING |
| `hintFirst` | N/A | MISSING: no strategy-controlled hint sequencing | N/A | MISSING: hard-coded prompt says to hint after weak answers | `effective-tutor-strategy.test.ts:9-30` is schema-only | MISSING |
| `adaptiveDifficulty` | PASS: `difficulty` is passed through the planner and the only schema-v1 profile is `current-contract` | PASS: same existing contract; no alternate profile is implemented | PASS: free prompt receives the existing difficulty value | PASS: same existing client/server current-contract behavior | `shared/tutor.ts:23-29,90-100` and existing difficulty tests | PASS by contract |

## Exact path findings

### Strategy resolution and metadata-only cases

- `server/services/tutor/strategy/effective-tutor-strategy.ts:60-72` correctly
  normalizes per-example, repository, and built-in candidates.
- `server/services/tutor/curriculum-tutor-adapter.ts:122-137` correctly
  resolves repository/default and per-example strategy metadata when a valid
  snapshot is present.
- `server/services/tutor/curriculum-tutor-adapter.ts:100-113` returns `null`
  when no valid Topic plan exists. This is correct Topic behavior, but it
  leaves TutorService on the free path.
- `server/services/tutor/tutor-service.ts:449-464` resolves the strategy and
  then calls `buildUserPrompt(code, context, difficulty, planningResult)`.
  The strategy does not enter the prompt. `applyStrategyMetadata` then adds
  only ID/source to the result.
- `server/services/tutor/tutor-service.ts:476-503` repeats the same issue for
  dialog. `buildDialogPrompt` and `ensureDistinctDialogQuestion` have no
  strategy input; metadata is appended after provider/planned behavior.
- `tests/server/services/tutor/strategy-precedence.test.ts:68-99` asserts the
  free path only by `strategyId` and `strategySource`; it would pass even if
  two strategies produced identical prompts and dialog behavior.
- `tests/server/services/tutor/effective-tutor-strategy.test.ts:9-71` validates
  schema values and resolution, not behavioral consumption.

### Hard-coded free-Tutor policy

- `getRemediationInstruction` (`tutor-service.ts:207-218`) always requests a
  hint/scaffold after weak answers and escalates after fixed streak lengths.
- `getProgressionInstruction` (`tutor-service.ts:220-232`) always treats rating
  5 as mastery/advance, rating 4 as brief clarification then advance, and
  rating 3 as same-path clarification.
- `ensureDistinctDialogQuestion` (`tutor-service.ts:290-307`) always applies
  the same near-duplicate threshold and chooses hard-coded remediation or
  concept-transition questions.
- `buildRemediationQuestion` and `buildConceptTransitionQuestion`
  (`tutor-service.ts:238-287`) are application-owned safety helpers, but their
  policy selection is not parameterized by the effective strategy.
- `buildUserPrompt` and `buildDialogPrompt` include difficulty and validated
  didactic data, but no application-owned translation of strategy values.

### Planner coverage

- `DefaultLearningPlanner.selectQuestion` uses only `questionKindWeights` and
  only after difficulty distance. This is a valid deterministic preference but
  not a complete strategy implementation.
- `selectRemediation` always selects a content scaffold when one exists and
  otherwise chooses a question; it does not distinguish scaffold-first from
  question-first and does not apply `scaffolding` preference.
- `selectClarification` always searches the current indicator first; it does
  not implement `new-indicator`.
- `selectAdvance` always calls `selectMasteryProbe`; it does not implement
  `advance-immediately`.
- `collectUsedQuestionIds` and related selection always enforce strict
  question-ID avoidance; `relaxed` is unused.
- `sketchSpecificity`, `feedbackVerbosity`, and `hintFirst` are not read by the
  planner. They belong in application-owned provider/dialog guidance for
  planned and free paths, while the deterministic planner handles only the
  selection decisions that have structured Topic data.
- `adaptiveDifficulty` is correctly a literal schema value; the current
  algorithm in `shared/tutor.ts` remains the single implementation with
  deltas `-6/-3/0/+2/+4`, a four-rating window, clamping, and step limits.

## Required scenario audit

| Scenario | Resolution | Behavior result | Status |
|---|---|---|---|
| Arbitrary/local sketch + repository defaultStrategy | `resolveSnapshotStrategy` can select repository default | No Topic means `planInitial` returns null; free prompt omits strategy and only result metadata identifies it | NON-CONFORMANT, metadata-only |
| Repository strategy with zero Topics | Repository default resolves; `matchCourseContent` intentionally returns null for empty topics | Free Tutor remains available but does not consume repository strategy | NON-CONFORMANT |
| Valid Topics but no Topic matches | Strategy can resolve, matcher returns no plan | Free Tutor falls back without retaining strategy behavior | NON-CONFORMANT |
| Invalid Tutor capability | Adapter resolves built-in and disables Topic planning | Free behavior is hard-coded built-in policy, not the same EffectiveTutorStrategy translation path | PARTIAL; fallback works but shared path invariant fails |
| No repository | Built-in strategy resolves | Free behavior is hard-coded application policy and not consumed through the normalized strategy path | PARTIAL |
| Per-example strategy | Correctly wins when a valid binding and applicable Topic exist | Planner receives it only for implemented weights/branches; free/no-match prompt and dialog are metadata-only | PARTIAL |
| Examples-only repository | Built-in fallback resolves | Free Tutor remains functional; shared strategy behavior path is still missing | PARTIAL |

## Smallest reasonable fix architecture

1. Resolve one `StrategyResolution` in `TutorService` per request and pass the
   normalized strategy into every behavior-producing call. Extend the planning
   extension input with that already-resolved strategy so planner metadata and
   free guidance cannot diverge.
2. Add one application-owned translation layer that maps only normalized enum
   and numeric values to trusted guidance strings and dialog policy. Pass its
   output to both initial and dialog prompts; never append repository text as
   instructions.
3. Parameterize the existing safe dialog helpers with the effective strategy:
   remediation (`scaffold-first`/`question-first`), clarification, progression,
   repetition, scaffolding preference, feedback verbosity, and hint ordering.
4. Extend deterministic planner branches only where structured Topic data gives
   a meaningful decision: weight ordering, strict/relaxed reuse, remediation
   mode, clarification aspect, progression mode, and content/generated
   scaffolding. Keep factual applicability, answerRating, difficulty, and
   anti-loop safety application-owned.
5. Add behavioral tests that compare trusted prompt guidance or deterministic
   planner output, not only strategy metadata, for repository-default,
   strategy-only, no-match, built-in, invalid-capability, two-strategy, and
   per-example cases. Add field-specific assertions for the policy branches.

No external `ttbombadil/unosim-examples` checkout was present under the local
workspace search paths, so no external repository was read or modified.
