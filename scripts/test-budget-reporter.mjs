import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

const TOP_TEST_COUNT = 10;

export default class TestBudgetReporter {
  constructor() {
    this.startedAt = Date.now();
    this.tests = [];
  }

  onTestCaseResult(testCase) {
    const diagnostic = testCase.diagnostic();
    const result = testCase.result();

    this.tests.push({
      name: testCase.fullName,
      file: relative(process.cwd(), testCase.module.moduleId),
      durationMs: Math.round(diagnostic?.duration ?? 0),
      state: result.state,
    });
  }

  onTestRunEnd(_testModules, unhandledErrors, reason) {
    const finishedAt = Date.now();
    const durationMs = finishedAt - this.startedAt;
    const suite = process.env.TEST_BUDGET_SUITE ?? "vitest";
    const legacyBudgetConfigured = process.env.TEST_BUDGET_MS !== undefined;
    const warningBudgetConfigured = process.env.TEST_BUDGET_WARN_MS !== undefined;
    const failureBudgetConfigured = process.env.TEST_BUDGET_FAIL_MS !== undefined;
    const twoThresholdMode = warningBudgetConfigured || failureBudgetConfigured;
    const legacyBudgetMs = Number(process.env.TEST_BUDGET_MS ?? 0);
    const warningBudgetMs = warningBudgetConfigured
      ? Number(process.env.TEST_BUDGET_WARN_MS)
      : null;
    const failureBudgetMs = failureBudgetConfigured
      ? Number(process.env.TEST_BUDGET_FAIL_MS)
      : null;
    const artifactPath =
      process.env.TEST_METRICS_FILE ?? `test-results/${suite}-metrics.json`;
    const configurationError = twoThresholdMode
      ? warningBudgetMs > 0 &&
        failureBudgetMs > 0 &&
        failureBudgetMs >= warningBudgetMs
        ? null
        : "TEST_BUDGET_WARN_MS und TEST_BUDGET_FAIL_MS müssen positiv sein; die Hard-Fail-Schwelle muss mindestens der Warnschwelle entsprechen."
      : null;
    const effectiveWarningBudgetMs = twoThresholdMode ? warningBudgetMs : null;
    const effectiveFailureBudgetMs = twoThresholdMode
      ? failureBudgetMs
      : legacyBudgetConfigured && legacyBudgetMs > 0
        ? legacyBudgetMs
        : null;
    const warningExceeded =
      !configurationError &&
      twoThresholdMode &&
      durationMs > effectiveWarningBudgetMs;
    const failureExceeded =
      !configurationError &&
      effectiveFailureBudgetMs > 0 &&
      durationMs > effectiveFailureBudgetMs;
    const budgetMs = twoThresholdMode
      ? effectiveFailureBudgetMs
      : legacyBudgetConfigured && legacyBudgetMs > 0
        ? legacyBudgetMs
        : null;
    // In two-threshold mode the legacy field represents the hard-fail limit,
    // so existing consumers continue to interpret this as a blocking failure.
    const budgetExceeded = failureExceeded;
    const counts = this.tests.reduce((result, test) => {
      result[test.state] = (result[test.state] ?? 0) + 1;
      return result;
    }, {});
    const slowestTests = [...this.tests]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, TOP_TEST_COUNT);

    const artifact = {
      schemaVersion: 1,
      suite,
      budgetMs,
      budgetExceeded,
      warningBudgetMs: effectiveWarningBudgetMs,
      failureBudgetMs: effectiveFailureBudgetMs,
      warningExceeded,
      failureExceeded,
      configurationError,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs,
      status: reason,
      counts,
      unhandledErrorCount: unhandledErrors.length,
      slowestTests,
    };

    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

    if (configurationError) {
      console.error(`Ungültige Testbudget-Konfiguration: ${configurationError}`);
      process.exitCode = 1;
    }

    if (twoThresholdMode && !configurationError) {
      console.log(
        `\nTestbudget [${suite}]: ${durationMs} ms | Warnschwelle: ${warningBudgetMs} ms | Hard Fail: ${failureBudgetMs} ms`,
      );
    } else {
      const budgetLabel = budgetMs ? `${budgetMs} ms` : "deaktiviert";
      console.log(`\nTestbudget [${suite}]: ${durationMs} ms / ${budgetLabel}`);
    }
    console.log(`Messartefakt: ${artifactPath}`);
    console.log(`Langsamste ${slowestTests.length} Tests:`);
    for (const test of slowestTests) {
      console.log(
        `  ${test.durationMs.toString().padStart(6)} ms  ${test.name}`,
      );
    }

    if (warningExceeded && !failureExceeded) {
      console.warn(
        `Testbudget-Warnschwelle überschritten: ${suite} benötigte ${durationMs} ms, Warnschwelle ${warningBudgetMs} ms, Hard-Fail-Schwelle ${failureBudgetMs} ms.`,
      );
    }

    if (failureExceeded) {
      if (twoThresholdMode) {
        console.error(
          `Testbudget-Hard-Limit überschritten: ${suite} benötigte ${durationMs} ms, erlaubt sind maximal ${failureBudgetMs} ms.`,
        );
      } else {
        console.error(
          `Testbudget ueberschritten: ${suite} benoetigte ${durationMs} ms, erlaubt sind ${budgetMs} ms.`,
        );
      }
      process.exitCode = 1;
    }
  }
}
