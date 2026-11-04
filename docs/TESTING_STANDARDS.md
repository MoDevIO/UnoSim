# Testing Standards

Status: current

## Dead-code checks: full graph and production graph

`./run-tests.sh --knip-gate-only` runs **both** Knip profiles. The complete
test pipeline uses the same gate; CI first runs its regression tests with
`npm run test:knip`. A full-graph pass alone does not prove production use.

| Profile | Roots and purpose | Reviewed findings |
|---|---|---|
| Full graph | Application, tools, tests and configuration; dependencies and all normal Knip checks | `quality/knip-baseline.txt` (empty) |
| Production graph | Browser/server/worker entry points, real CLI commands and public contracts; tests are not roots | `quality/knip-production-baseline.txt` (empty) |

In `knip.json`, `!` suffixes mark production entry/project patterns. Test
patterns have no production suffix; the Vitest/Playwright plugins also exclude
their test roots in production mode. Application CSS remains in the project
so Knip follows its imports too. The emulator workspace uses its manifest
exports as the public API. The remote-control type module remains an explicit
contract root. Internal helpers, including `shared/worker-protocol.ts` and
`server/config.ts`, are reached through real imports and are not
blanket entry points. Add new CLI roots explicitly when introducing a command;
do not mark whole source directories as entries to silence findings.
`scripts/capacity-validation-config.ts` is such a root: the capacity shell
scripts import it through `node -e`, which Knip cannot follow.

The production pass checks files, exports, types, enum/namespace members,
duplicate exports and unresolved imports. Dependency checks remain in the full
graph because development tools legitimately use development dependencies.
`--no-config-hints` suppresses configuration suggestions: roots needed for
production can be redundant in the full graph. It does not suppress code
findings. Unknown diagnostic sections, malformed output, inconsistent counts,
tool errors and invalid/missing baselines fail closed.

The initial production inventory on 2026-11-02 contained **32 findings**; all
are resolved and both baselines are empty. Retired code went together with
its exclusive tests: the four compile/simulation/telemetry adapter hooks (their
tests now run against `useCompileAndRun`, the path the page uses), the
single-file registry wrapper (its tests run through the project parser), the
schema-v1 curriculum manifest and a duplicate Course Content root schema.
The lazily loaded library rules are collected in
`client/src/lib/library-rules.ts`, whose static imports Knip follows. Fixture parsers moved to `tests/utils/`, rule R-COR-1 into
its gate test, and the client checks incoming WebSocket messages against the
server-to-client schema. Every gate run prints remaining findings; new findings
block CI. The baseline records exact paths and symbols without line numbers
and is never updated by the gate. Adding an ignore or baseline record just to
obtain a green result is not a cleanup.

**Bounded exception in the production profile:** seven test hooks that need
module state (singleton and cache resets, test logging, a store observer) carry
the JSDoc tag `@internal`. The production profile skips such exports; the full
profile still reports one that no test uses. No other code may use the tag.
`tests/scripts/knip-internal-exports.test.mjs` reads the TypeScript AST of all
application, server, shared, script and emulator sources and pins exactly these
seven names with their reasons. It accepts the tag only on a named
`export function` or a single-name `export const`, once per declaration; a
default export, an export list, a re-export of a hook, a multiple declaration,
a class or a tag outside a top-level JSDoc fails, as does any eighth hook.

An entry point hides its own unused exports. Only real application, worker,
CLI and public-contract files are entries; `server/config.ts` is no entry,
because `server/index.ts` imports it.

`tests/scripts/knip-production.test.mjs` runs the installed Knip against a
small project using the real repository configuration. It verifies both sides:
tests cannot keep a retired file, an unused export/type or an internal
protocol helper alive, an `@internal` test hook is no production finding but an
unused one is still reported, while actual application/worker/CLI consumers and
public package exports remain reachable. The gate tests additionally execute
the shell pipeline against controlled output, including new findings after a
successful full check, exact known enum members, malformed output and tool
failures. CI retains the raw gate log in its clean-room artifacts.

## Pin capability reference and registry tabs

`packages/avr-emulator/tests/boards/pin-reference.test.ts` checks bus and
interrupt mappings against hand-checked pinned-core/MCU expectations, including
Nano analog-only pins, ATtiny USI master roles, and Mega PCINT helper limits.
`tests/client/io-registry-tabs.test.tsx` verifies the shared source-detail state,
full file/line navigation targets, empty registries, runtime additions, and
board changes. `tests/client/pin-infos.test.tsx` covers the compact reference,
search, restrictions and nonprogrammable contacts.

`e2e/pin-infos.spec.ts` checks the real board menu, reference updates, usage
source state, the single sticky header/Pin column, and overflow at 100 % and
150 % font scale in a narrow panel. It expands the initially minimized output
panel before interacting with the registry. The UI uses existing semantic
colors, central typography, AppTab/TabBar, and UnifiedScrollArea; no prototype
CSS is copied into the application.

## CI Timing Tolerances

### 🕒 Timing tests are inherently flaky in CI

Some tests run on shared CI runners where system load, CPU scheduling, and container overhead can add jitter. In this repository, we accept that timing-based tests can vary by **at least ±250ms**.

- The canonical reference for this tolerance is **`tests/server/timing-delay.test.ts`**.
- That test asserts that `delay(1000)` measurements are within **750ms–1250ms**, which is the guardrail we use for all timing-based assertions.

> ✅ If you adjust timing tests, keep the ±250ms window in mind and ensure CI builds remain stable.

### Unit-suite wall-clock budget

The local application pass (`test:unit:app`) warns at **75 seconds** and fails
above **120 seconds**. It includes `unit-client`, `unit-node` and
`unit-node-http`; the emulator has its own pass and budget below. Local HTTP
listener tests stay serial within their project while the remaining Node
tests stay file-parallel. The budget is a wall-clock guard, not a per-test
timeout.

In CI, `clean-room-unit` distributes the same application projects over two
independent runners using Vitest `--shard=1/2` and `--shard=2/2`. Every file
runs in exactly one shard, including the serial HTTP files. Each shard keeps
the existing 75 s warning / 120 s failure budget. The required check
**Clean-room reproducibility** keeps its name and requires both shards and
the parallel `clean-room-checks` job to pass. That job checks types, dead
code, Tutor quality, the complete emulator unit suite and the build. The
short required result check uses `always()` and accepts only `success` from
both dependencies: failed, cancelled or skipped work fails the check rather
than leaving it skipped. The expensive jobs remain cancellable. Matrix
fail-fast is disabled to retain diagnostics from both runners. The local
`test:unit` and coverage commands are unchanged.

Reason for the split (2026-11-02): on the same merged commit `fc95db873`, the
unsharded application pass took 121.097 s (all 3,937 tests passed; budget
failed) and 114.263 s on retry. PR attempts also exceeded the limit at
120.687 s and 123.8 s. The old unchanged main took 106.909 s on the same day,
compared with about 77 s on 2026-10-30. This supports an environmental
influence but does not explain the complete difference between commits.
Sharding provides capacity instead of repeatedly raising the shared limit.
The actual headroom on GitHub must be measured after the first updated run;
local timings are not a substitute for that measurement.

Both shards upload separate JSON metrics even after a failure. The
clean-room checks job uploads Tutor/emulator metrics; the coverage job uploads both
application and emulator coverage metrics. The reporter keeps its existing
fields and adds all file timings (`files`) and the ten slowest files
(`slowestFiles`), including environment creation, harness preparation,
setup, imports and tests/hooks. These are per-file costs; parallel file
costs must not be added to infer suite wall time. This makes setup/import
regressions visible even when individual test bodies are fast.

ESLint ignores `local-temp/`, the Git-ignored directory for local review
evidence, just as it ignores `temp/`. Generated probes there are outside the
TypeScript projects; tracked application code and tests remain linted.

References: [failed main attempt](https://github.com/MoDevIO/UnoSim/actions/runs/41325984087/attempts/1),
[successful retry](https://github.com/MoDevIO/UnoSim/actions/runs/41325984087/attempts/2),
[Vitest sharding](https://vitest.dev/guide/improving-performance.html#sharding),
[GitHub status conditions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).

### Emulator coverage pass

`npm run test:coverage` runs the Vitest project `unit-emulator`
(`packages/avr-emulator/tests/`) in a second coverage pass with its own
budget (`unit-emulator-coverage`, warning 60 s, hard fail 120 s) and report
directory `coverage/emulator/`. V8 block coverage instruments the avr8js
interpreter as well and slows emulation down by an order of magnitude, which
would otherwise consume the shared unit-coverage budget. `npm run test:unit`
runs the same split without coverage: `test:unit:app` (budget `unit`, warning
75 s, hard fail 120 s) and `test:unit:emulator` (budget `unit-emulator`,
warning 45 s, hard fail 90 s). The emulator corpus grows with every board and
must not eat the budget of the application tests; the combined unit pass had
only 0.8 s of headroom before the Mega corpus was added. The coverage guard
validates both `lcov` files and requires at least 90 % line coverage for
`packages/avr-emulator/src/`; Sonar reads both reports.

### Application coverage pass

The application pass of `npm run test:coverage` (`unit-client`, `unit-node`,
`unit-node-http`; budget `unit-coverage`) has a warning at 100 s and a hard
fail at 150 s. It was 75 s / 120 s until 2026-10-25. Measured on the GitHub
runners, 14 runs: 78 s to 120 s; on 2026-10-25 every run was between 115.8 s
and 119.97 s, one run on 2026-10-23 failed at 125 s, while the same pass takes
41 s on an Apple M2 Pro. The suite grew by about 600 tests since the old limit
was set (3,658 tests), V8 coverage costs roughly 50 % more than the plain pass
(`test:unit:app`, 80 s on the runner, limits unchanged), and no single test
dominates: the three slowest files take about a third of the summed file time
(compile tests with a faked CLI at roughly 150 ms per compile). The new limit
keeps 25 % headroom over the slowest run seen; no test was removed or skipped.
A run that approaches 150 s is the signal to split the pass, not to raise the
limit again.

Emulator tests should keep simulated time short: about 1 ms of simulated time
costs roughly 1 ms of wall time without coverage and 5–25 ms with it.

### Runtime reference corpus

`tests/fixtures/runtime-corpus/` holds the cases that decide whether the
emulation behaves like the board: `probes/<case>/` (sketch, `case.json`,
`expected.<board>.txt`) and precompiled `hex/<board>/<case>.hex`, so the unit
gate (`unit-emulator`, `packages/avr-emulator/tests/runtime-corpus.test.ts`)
needs no toolchain. Every case belongs to exactly one class, and a pass proves
exactly that much:

| `provenance` | Source of the expectation | A pass proves |
|---|---|---|
| `hardware` | recorded once on a real board (`recordedOn`) | agreement with the board |
| `derived` | derived independently of the emulator (datasheet, core source, calculation; stated in `basis`) | agreement with that derivation, not with hardware |
| `regression` | emulator output, reviewed for plausibility | only that nothing changed |

Expectations compare serial port 0 line by line (CRLF read as LF).
Tolerances apply only to time values, each with a pattern, a width and a
reason in `case.json`; the ±250 ms of the wall-clock tests above does not
apply to emulator cases. `npm run fixtures:runtime` rebuilds the HEX files with
the pinned toolchain; the toolchain gate
(`tests/integration/runtime-corpus-fixtures.test.ts`) fails when a rebuild
differs from the checked-in bytes, in which case fixtures and core version are
updated together. Serial output of a case must fit in its `simMs` (at 115200
baud about 11 characters per simulated millisecond).

The corpus is split into shards (`packages/avr-emulator/tests/runtime-corpus-*.test.ts`)
so that Vitest spreads it over its workers. It runs in `npm run test:unit`
but not in the emulator coverage pass (`UNOSIM_SKIP_CORPUS=1` in
`test:coverage`): it adds no coverage of `src/` and costs minutes under V8
instrumentation. The toolchain gate rebuilds every fixture; its budget is
300 s (`test:integration`).

Within the toolchain gate two files run at a time (`maxWorkers: 2`): the
corpus runs next to the remaining files. The shared library directory is
provisioned once in `tests/global-setup.toolchain.ts`, never by the files
themselves. A third worker saved 3 s, since the compiles already keep the CPU
busy. Tests within a
file run concurrently, bounded by the project's `maxConcurrency: 6`. The
corpus file compiles through `CorpusBuildCache` (`scripts/runtime-fixtures.ts`):
asynchronous `arduino-cli` calls (a synchronous call would serialize the
concurrent tests), one temporary sketch copy per case and one build cache per
run, passed only to the started processes as `ARDUINO_BUILD_CACHE_PATH`. Core
artifacts are reused within the run. The first compile of each FQBN runs alone
and builds the core. The others wait for it, since concurrent cold compiles
replaced the core archive while another compile linked against it (lto1:
"resolution sub id ... not in object file", seen once in a full pipeline run).
The corpus adds no entries to the user's global cache, and
`dispose()` removes the cache after all running compiles, also after failures.
A compile is killed after 100 s, before its 120 s test timeout. `--jobs` is
left at its default: with six concurrent cases, values 0, 1 and 2 differed by
less than 5 %. The built-in example and library catalog files run their tests
with `describe.concurrent`; every compile there has its own build directory.

Measured locally on 2026-11-03 (battery, load 8–10): the gate took 295 s and
301 s before, and 167 s, 172 s and 168 s in three consecutive runs after this
change. The corpus file went from 148 s to 60–69 s, the library catalog from
53 s to 24–28 s and the built-in examples from 34 s to 16–17 s. CI took
125–142 s before; its new duration is not yet measured.

An independent verification on the same date, with Node 24.20.0, 10 logical
CPUs and AC power, passed all 12 files three times in **127.824 s, 129.351 s
and 131.222 s**: 162 tests passed and the same one skipped per run, with no
unhandled errors. The corpus file took 50.871 s, 49.070 s and 49.555 s,
including setup and imports; every run started with a new empty corpus cache.
These are separate measurements, not a controlled comparison with the older
battery/load results. A failure-path check also confirmed that cleanup waits
for an active compile after another case fails, preserves the parent's
environment and removes the shared cache. No corpus scratch directories
remained after the three runs. The existing pin-map test's global cache use
is separate from the corpus cache.

With two files at a time, the gate took 80.7 s, 80.3 s and 78.6 s in three
consecutive runs (AC power, same date; 121.6 s serial in the pipeline run just
before). The first CI run with serial files and concurrent tests took 100.6 s.

The Docker gate stays serial. Running its contract files two at a time saved
33 s, but one of six runs failed in a file that asserts timing windows. With
those files kept serial, it saved only 7 s, too little for a second project.

### Browser emulation (M1)

`e2e/browser-emulation.spec.ts` runs the whole path in a real browser against a
real compile: Uno in the Web Worker, serial output and input, pause, resume
and stop with their system lines, the diagnostic for input before
`Serial.begin()`, reset without compiling again, a run that continues while the
connection is lost, and the host-mock fallback. The engine is chosen with the
`localStorage` key of File → Settings → "Simulation engine" (`unoSimulationEngine`).
The test server serves the pre-built `dist/public`. Playwright runs a fresh
production build before starting its test server, for both local and CI runs.
This also refreshes board SVGs and compiled workers after a pull; an existing
`dist` directory is not evidence that it matches the current source. The test
server is owned by the run and never reuses an already running application.
Keep port 3000 free for direct Playwright runs; `run-tests.sh` handles this in
its pre-flight stage. No separate manual build is required before the E2E step.

Playwright runs two projects against the one server. Tests tagged
`@server-runs` run sketches in the server's stateful sandbox pool (host-mock
engine), or load the server with many clients. They form the `server-runs`
project, one test at a time. All other tests use the browser emulation, the
local default. The `browser` project runs them file by file in parallel
workers (`workers: 4` in total). A new test that starts a server-side run gets
the tag. `snapshotPathTemplate` keeps the screenshot baselines' names
without the project name. Locally the 84 tests took 61–63 s in three runs
without retries, against 203 s serial.

---

## Coverage-Hotspots

Folgende Dateien sind aktuell die größten Hotspots und sollten gezielt mit Tests abgedeckt werden:

| Datei | Aktuelle Coverage | Ziel | Verantwortung |
|-------|------------------|------|---------------|
| `client/src/hooks/use-compile-and-run.ts` | 85,5% | >80% | Compile→Start-Orchestrierung |
| `server/routes/simulation.ws.ts` | ~55% | >70% | WebSocket-Lifecycle |
| `server/services/arduino-compiler.ts` | ~60% | >75% | Compiler-Logik |
| `server/services/execution-manager.ts` | ~45% | >70% | Sandbox-Ausführung |
| `client/src/hooks/useArduinoSimulatorPage.tsx` | ~50% | >75% | ViewModel-Komposition |

**Aktueller Coverage-Hinweis:** Die extrahierten Hooks liegen bei mindestens 94,0%
Statement-Coverage; der Orchestrator liegt bei 85,5%. Die Größenabweichungen
des UI-Adapters und des Orchestrators sind im Phase-2.1-Plan dokumentiert.

---

## Hook-Namenskonvention

UnoSim verwendet **camelCase** für alle Hooks:

- ✅ Korrekt: `useCompileAndRun`, `useArduinoSimulatorPage`
- ❌ Falsch: `use_compile_and_run`, `use-arduino-simulator-page`

Diese Konvention gilt für alle neuen und bestehenden Hooks im Projekt.

---

## Notes

### Heavy stress tests

The multi-instance Arduino CLI stress test is disabled in the regular pipeline
because it performs concurrent real compilations and is comparatively slow. Run
it explicitly when validating runner isolation and cleanup:

```bash
RUN_HEAVY_TESTS=1 ./run-tests.sh
```

The test is an opt-in production-like check: it starts two real SandboxRunner
instances concurrently, verifies that their serial output cannot cross over,
and checks that temporary sketch directories are removed. It uses real timers
because Docker/Arduino-CLI process events must continue while the test waits.
The test has a 120-second per-test budget to accommodate two local compilations;
this is a diagnostic gate, not a substitute for the fast deterministic tests.

Without `RUN_HEAVY_TESTS=1` (or `true`), the regular pipeline deliberately skips
this resource-intensive check and reports it as skipped. This keeps every local
default run fast while still making the stronger isolation check reproducible on
developer machines and in a dedicated CI job.

### Sandbox contract gate

The current sandbox contract is defined in [`SECURITY.md`](SECURITY.md).
Changes to Docker sandbox flags, runner lifecycle, gateway assumptions or
container resource limits must run the documented Phase-3.5 gates, including
`npm run test:security:inputs`, `npm run test:docker`,
`RUN_HEAVY_TESTS=1 ./run-tests.sh`, `./check-leaks.sh --cleanup`,
`npm audit --omit=dev`, `npm run check`, and `npm run check:docs`.

Sandbox contract tests must stay additive and must not use real secrets, weaken
security defaults, or open public host bindings.

- Do **not** use `npx playwright test --update-snapshots` or similarly destructive flags in CI; snapshot changes must be reviewed explicitly.
- When modifying timing-sensitive tests, ensure they still pass on low-end CI hosts by running:
  1. `npm run check`
  2. `npm run test:fast`
  3. `./run-tests.sh`

## Verfügbarkeit von Beispielen

Regressionstests für Beispiele simulieren ausgehende GitHub-Antworten
deterministisch. Die Commit-Auflösung prüft die SHA-Repräsentation, das separate
256-Byte-Limit, Header-/Token-Grenzen, Abbruch und bestehende Quota-Regeln.
API-Tests prüfen den eingebauten Katalog ohne externe Provideraufrufe.
`e2e/examples-availability.spec.ts` hält nur den gemeinsamen Katalog zurück oder
antwortet dort mit HTTP 503. Der lokale Katalog und die Blink-Datei werden vom
echten Testbackend geladen; anschließend wird der Code im Monaco-Editor geprüft.
Ein weiteres Szenario prüft Retry und Wiederherstellung ohne Editorwechsel oder
doppelten lokalen Abruf. Unit-Tests decken außerdem HTTP 429, leere Teilergebnisse,
den umgekehrten Teilausfall und verspätete Antworten nach Auswahlwechsel ab.
Ein echter GitHub-Ausfall ist keine Voraussetzung für diese Tests.
