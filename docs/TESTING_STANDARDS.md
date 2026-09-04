# Testing Standards

## CI Timing Tolerances

### 🕒 Timing tests are inherently flaky in CI

Some tests run on shared CI runners where system load, CPU scheduling, and container overhead can add jitter. In this repository, we accept that timing-based tests can vary by **at least ±250ms**.

- The canonical reference for this tolerance is **`tests/server/timing-delay.test.ts`**.
- That test asserts that `delay(1000)` measurements are within **750ms–1250ms**, which is the guardrail we use for all timing-based assertions.

> ✅ If you adjust timing tests, keep the ±250ms window in mind and ensure CI builds remain stable.

---

## Coverage-Hotspots

Folgende Dateien sind aktuell die größten Hotspots und sollten gezielt mit Tests abgedeckt werden:

| Datei | Aktuelle Coverage | Ziel | Verantwortung |
|-------|------------------|------|---------------|
| `client/src/hooks/use-compile-and-run.ts` | ~65% | >80% | Frontend-Logik |
| `server/routes/simulation.ws.ts` | ~55% | >70% | WebSocket-Lifecycle |
| `server/services/arduino-compiler.ts` | ~60% | >75% | Compiler-Logik |
| `server/services/execution-manager.ts` | ~45% | >70% | Sandbox-Ausführung |
| `client/src/hooks/useArduinoSimulatorPage.tsx` | ~50% | >75% | ViewModel-Komposition |

**Maßnahme 1.10:** Diese Coverage-Ziele sind dokumentiert und sollten vor größeren Refactorings (Phase 2) erreicht werden.

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

- Do **not** use `npx playwright test --update-snapshots` or similarly destructive flags in CI; snapshot changes must be reviewed explicitly.
- When modifying timing-sensitive tests, ensure they still pass on low-end CI hosts by running:
  1. `npm run check`
  2. `npm run test:fast`
  3. `./run-tests.sh`
