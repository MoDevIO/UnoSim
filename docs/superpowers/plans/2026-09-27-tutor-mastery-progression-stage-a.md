# Implement mastery-driven Tutor progression Stage A

## Scope

Implement the approved mastery-progression contract from SSOT commit
`fdd641bbae30ceae8347f9835620c3d1274462d9` in the isolated worktree only.
Preserve schema-v1 compatibility, capability-scoped fallback, the existing
free-Tutor safety contract, Course revision/session pinning, and all protected
unrelated areas.

## Tasks

1. Audit the approved SSOT and current implementation; record gaps and
   unresolved implementation rulings in the execution ledger.
2. Add failing schema/data-model tests for Tutor manifest v2, Topic v2,
   extensions, phase strategies, and v1 compatibility; implement strict
   normalization and capability-scoped loading.
3. Add failing planner tests for Topic mastery-domain classification,
   probeable/unresolved/content-exhausted outcomes, multi-topic precedence,
   LEARN/DEEPEN/EXPAND transitions, deepening evidence, and retention; then
   implement the deterministic state machine.
4. Add phase-strategy and extension-flow tests; implement phase-specific
   effective strategy selection and bounded extension guidance.
5. Thread server-owned progression state through Tutor planning/session
   boundaries and add the minimum additive API/client state needed for the
   visible Tutor phase and blocked diagnostics, without exposing evidence or
   teacher-controlled instructions.
6. Add regression coverage for free Tutor behavior, revision/context reset,
   invalid capability isolation, strategy precedence, hidden-source and
   security invariants; run all focused suites.
7. Run the complete release gates, review the diff and protected worktrees,
   then create focused logical commits and open (but do not merge) a PR only
   if every required gate passes.

## Verification gates

- `npm run check`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:coverage`
- `npm run build`
- `npm run check:docs`
- `npm run sonar`
- `git diff --check`
- focused Tutor/Course Content/strategy/session/API/client suites
- Playwright; Docker/Arduino only when affected by the implementation
