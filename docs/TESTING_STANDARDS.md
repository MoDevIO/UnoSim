# Testing Standards

## CI Timing Tolerances

### 🕒 Timing tests are inherently flaky in CI

Some tests run on shared CI runners where system load, CPU scheduling, and container overhead can add jitter. In this repository, we accept that timing-based tests can vary by **at least ±250ms**.

- The canonical reference for this tolerance is **`tests/server/timing-delay.test.ts`**.
- That test asserts that `delay(1000)` measurements are within **750ms–1250ms**, which is the guardrail we use for all timing-based assertions.

> ✅ If you adjust timing tests, keep the ±250ms window in mind and ensure CI builds remain stable.

---

## Notes

### Heavy stress tests

The multi-instance Arduino CLI stress test is disabled in the regular pipeline
because it performs concurrent real compilations and is comparatively slow. Run
it explicitly when validating runner isolation and cleanup:

```bash
RUN_HEAVY_TESTS=1 ./run-tests.sh
```

Without the variable, the standard pipeline remains unchanged. The test itself
is selected through `RUN_HEAVY_TESTS=1` (or `true`) and is reported as skipped
otherwise.

- Do **not** use `npx playwright test --update-snapshots` or similarly destructive flags in CI; snapshot changes must be reviewed explicitly.
- When modifying timing-sensitive tests, ensure they still pass on low-end CI hosts by running:
  1. `npm run check`
  2. `npm run test:fast`
  3. `./run-tests.sh`
