# Testing Standards

Status: current

## CI Timing Tolerances

### 🕒 Timing tests are inherently flaky in CI

Some tests run on shared CI runners where system load, CPU scheduling, and container overhead can add jitter. In this repository, we accept that timing-based tests can vary by **at least ±250ms**.

- The canonical reference for this tolerance is **`tests/server/timing-delay.test.ts`**.
- That test asserts that `delay(1000)` measurements are within **750ms–1250ms**, which is the guardrail we use for all timing-based assertions.

> ✅ If you adjust timing tests, keep the ±250ms window in mind and ensure CI builds remain stable.

### Unit-suite wall-clock budget

The unit budget is **55 seconds**. The current baseline contains 2,115 tests;
CI runtime depends on shared-runner load. Local HTTP listener tests run in the
serial `unit-node-http` project while the remaining Node tests stay
file-parallel. The budget is a wall-clock guard, not a per-test timeout.

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

### Browser emulation (M1)

`e2e/browser-emulation.spec.ts` runs the whole path in a real browser against a
real compile: Uno in the Web Worker, serial output and input, pause, resume
and stop with their system lines, the diagnostic for input before
`Serial.begin()`, reset without compiling again, a run that continues while the
connection is lost, and the host-mock fallback. The engine is chosen with the
`localStorage` key of File → Settings → "Simulation engine" (`unoSimulationEngine`).
The client build is the pre-built `dist/public` (see above): run
`npm run build:client` before running this spec locally.

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
