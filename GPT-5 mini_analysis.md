**Executive Summary**
- **Scope**: Backend services (~5.3k LOC), Frontend styles (~13.2k LOC), Unit-tests (~46.3k LOC), Shared (~1.2k LOC).
- **Goal**: Reduce cognitive load by improving modularization, removing fragile tests, and centralizing shared logic/styles.

**Service Decoupling (Findings & Recommendations)**
- **Current grouping**: `server/services` is organized mainly by technical responsibility (sandbox execution, parsing, batching, registry, docker helper). This mixes runtime orchestration, IO parsing, telemetry and low-level process control rather than being grouped by business/domain concepts.
- **Implication**: Hard to reason about domain flows (simulation lifecycle vs telemetry vs parsing). Large manager classes accumulate mixed responsibilities (I/O, lifecycle, file operations, batching).
- **Top 3 most complex files (cyclomatic / LOC proxy)**
  - **`server/services/sandbox-runner.ts`**: Very large (~1.4k LOC). Responsibilities: process lifecycle, state machine, Docker/local execution, I/O routing, buffering, timers, filesystem cleanup, batcher orchestration. Split recommended.
  - **`server/services/registry-manager.ts`**: Large (~588 LOC). Responsibilities: registry collection, debouncing, telemetry heartbeat, wait-mode queueing, cleanup logic. Contains heavy state + timers.
  - **`server/services/arduino-output-parser.ts`**: Complex branching and regex parsing for many protocol variants.

- **Suggested decomposition (SandboxRunner)**
  - ProcessController: spawn/exec, signal handling, timeouts, socket destruction, make kill/stop/pause/resume deterministic.
  - IOProcessor / ParserRouter: hold parsing (use `ArduinoOutputParser`) + routing of parsed events to registries/batchers; pure functions where possible.
  - BatchManagerFactory: create/start/stop PinStateBatcher and SerialOutputBatcher; expose telemetry hooks; separate lifecycle from runner.
  - FilesystemManager: temp-dir creation, mark/cleanup/retry logic.
  - SimulationStateMachine: small focused state machine (transitions, guards) with well-defined hooks (onEnter/onExit) and minimal side-effects.

- **RegistryManager split**
  - RegistryStore (pure data store + compute hash + cleanup helpers)
  - RegistrySync (debounce/wait mode + sendNow throttle + telemetry heartbeat)
  - TelemetryAggregator (collect telemetry from batchers and expose metrics)

- **ArduinoOutputParser**
  - Keep parser file but move regex patterns and protocol definitions into a small ProtocolSpec object; unit-test parser thoroughly as pure functions; keep side-effect free.

**Style Audit (Findings & Recommendations)**
- **Findings**:
  - Many hardcoded color hex codes and style values embedded in component code (examples: [client/src/components/features/arduino-board.tsx](client/src/components/features/arduino-board.tsx), [client/src/components/features/settings-dialog.tsx](client/src/components/features/settings-dialog.tsx)).
  - Tailwind is used (see `tailwind.config.ts`) but arbitrary values (`bg-[#22c55e]`) and inline styles are common.
  - SVG fill/stroke and dynamic color logic implemented ad-hoc inside components (DOM attribute writes), causing duplicated color logic and mixing presentation with behaviour.
  - No automated dead-css detection visible in repo. Large style LOC (~13.2k) roughly equals app logic — suggests duplication and drift.

- **Recommendations**:
  - Centralize palette & tokens in `tailwind.config.ts` and/or CSS variables (`:root`) and migrate hardcoded hex values to tokens (e.g., `--brand-teal`, `--success`, `--danger`). Replace `bg-[#22c55e]` with `bg-success` or Tailwind token classes.
  - Extract SVG theming utilities or small `useBoardTheme()` helper so SVG DOM changes use tokens rather than ad-hoc hex literals.
  - Run an unused-css scan (PurgeCSS / Tailwind JIT purge) and remove legacy `.css` rules; add linting step to detect hardcoded colors and px values.
  - Considering current Tailwind usage, keep utility-first for most UI; adopt CSS-in-JS only for tightly-coupled dynamic styling where runtime tokens are needed (SVG color computation). Do NOT migrate entire codebase to CSS-in-JS — Tailwind is already a better fit.

**Test Fragility (Findings & Examples)**
- **High-level**: Tests are numerous and assert implementation details (process signals, exact spawn args, internal prototype methods), causing fragility during refactors.
- **Concrete examples**:
  - [tests/server/services/sandbox-runner.test.ts](tests/server/services/sandbox-runner.test.ts) — asserts `spawn` call arguments and expects `runProc.kill('SIGSTOP')` / `SIGCONT` / `SIGKILL`. These will break if process control is refactored to a ProcessController abstraction.
  - Tests spy on internals: e.g. `vi.spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli')` in [tests/arduino-compiler.test.ts](tests/arduino-compiler.test.ts) — tightly couples tests to internal method names.
  - Multiple tests assert plumbing-level behavior (exact `stdin.write(...)` invocation), e.g. [tests/server/services/sandbox-runner.test.ts](tests/server/services/sandbox-runner.test.ts) expecting `runProc.stdin.write("test input\n")`.

- **Recommendation**:
  - Refactor tests toward boundary/integration testing: assert messages and externally-observable side-effects (WebSocket messages, registry updates, telemetry output) rather than exact internal calls or signals.
  - Introduce small integration tests that exercise the system through the public API (e.g., `runSketch()` and check the `onOutput`, `onIORegistry` callbacks) using mocked child_process behavior but avoid asserting on internal method names.
  - Replace prototype spies with dependency injection (pass a Compiler interface) and mock that interface in tests. Then assert high-level contract (compile success/failure) only.
  - Create a test audit: mark existing brittle unit tests and convert 30–50% into higher-level integration tests; keep a trimmed set of low-level unit tests for pure utilities (parsers, tokenizers, hashing functions).

**Shared Logic (Duplication & Opportunities)**
- **Findings**:
  - There is a single `shared/schema.ts` that defines `IOPinRecord`, `WSMessage` zod schema, parser message types and basic validation. Frontend imports use `@shared/schema` — good reuse.
  - Minimal duplication found for core types; however, color/presentation tokens and some validation logic live in client components rather than shared module.

- **Recommendations**:
  - Move pure validation, DTOs and WS message shapes into `shared/` (already done for many). Expand `shared/` to include:
    - `ui-tokens.ts` (TypeScript token definitions) and a small `theme.json` used by both server-side rendering and client to keep colors consistent.
    - `validators` (Zod schemas) for any request/response shapes currently re-implemented in multiple places.
  - Avoid moving UI-only styling into `shared` — keep visual tokens minimal and stable.

**Roadmap: Reducing Cognitive Load (High-level, prioritized)**
- **Phase 1 — Stabilize & Encapsulate (2–3 wks)**
  - Introduce `ProcessController` and move all spawn/exec/kill/socket-destruction logic there. Replace direct `spawn`/`execSync` calls in `sandbox-runner.ts` with calls to `ProcessController` (small refactor with compatibility layer).
  - Extract `IOProcessor` that routes parsed messages → registry/batchers; keep `ArduinoOutputParser` as pure function module.
  - Add DI seams: accept Batchers/Compiler/Filesystem helpers as constructor params for `SandboxRunner` to simplify testing.

- **Phase 2 — Split Big Managers (2–3 wks)**
  - Split `SandboxRunner` into focused modules listed above and create a thin orchestrator that composes them.
  - Split `RegistryManager` into store + sync + telemetry.
  - Create `telemetry` submodule and move batchers there.

- **Phase 3 — Tests & CI (1–2 wks)**
  - Audit tests: tag brittle tests, convert to integration tests at public API boundaries, remove tests asserting private method names or exact spawn args.
  - Add contract tests for parsers (pure unit tests), registry hashing, and telemetry aggregator.

- **Phase 4 — Styles Cleanup (1–2 wks)**
  - Centralize color tokens in `tailwind.config.ts` and CSS variables. Replace hardcoded hexes in components with tokens.
  - Run PurgeCSS/Tailwind purge and remove unused rules; add linter rule to detect hardcoded hex in components.

**Top 5 Hotspots (Immediate refactor targets)**
1. **[server/services/sandbox-runner.ts](server/services/sandbox-runner.ts)** — single largest file (≈1.4k LOC): split into ProcessController, IOProcessor, BatchManagerFactory, FilesystemManager, and a small state machine. Priority: High.
2. **[server/services/registry-manager.ts](server/services/registry-manager.ts)** — (~588 LOC): separate store, sync/debounce, telemetry aggregation. Priority: High.
3. **[server/services/arduino-output-parser.ts](server/services/arduino-output-parser.ts)** — parsing complexity and many regex branches; keep pure and harden with unit tests. Priority: Medium-High.
4. **[server/services/serial-output-batcher.ts](server/services/serial-output-batcher.ts)** — budget/accumulator logic and queue handling; extract into `telemetry/serial` and add focused tests for token-bucket behavior. Priority: Medium.
5. **[client/src/components/features/arduino-board.tsx](client/src/components/features/arduino-board.tsx)** — heavy inline SVG manipulation, many hardcoded hex colors and dynamic DOM style writes; centralize tokens and extract theming logic. Priority: Medium.

**Quick Wins (next 1–2 days)**
- Add a small `ProcessController` wrapper and route current `spawn/execSync` calls through it (keeps behavior identical but creates a seam for tests).
- Extract `ArduinoOutputParser` tests as pure unit-tests (cover edge cases for protocol fragments). These are cheap to add and reduce downstream breakage.
- Add Tailwind tokens for the 10 most used colors (grep results show many repeats). Replace in 10–15 places.

**Appendix: Example fragile tests to convert**
- `tests/server/services/sandbox-runner.test.ts` — assertions on exact `spawn` args and `SIGSTOP`/`SIGCONT`/`SIGKILL` calls; convert to asserting public callback behavior (`onOutput`, `onIORegistry`, `onExit`) and allow ProcessController to be mocked.
- `tests/arduino-compiler.test.ts` — `spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli')` → inject `Compiler` interface and mock it.

-- End of report --
