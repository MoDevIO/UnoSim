import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

const TOP_TEST_COUNT = 10;

function readBudgetConfiguration(env) {
  const twoThresholdMode = env.TEST_BUDGET_WARN_MS !== undefined || env.TEST_BUDGET_FAIL_MS !== undefined;
  const legacyBudgetConfigured = env.TEST_BUDGET_MS !== undefined;
  const legacyBudgetMs = Number(env.TEST_BUDGET_MS ?? 0);
  const warningBudgetMs = env.TEST_BUDGET_WARN_MS === undefined ? null : Number(env.TEST_BUDGET_WARN_MS);
  const failureBudgetMs = env.TEST_BUDGET_FAIL_MS === undefined ? null : Number(env.TEST_BUDGET_FAIL_MS);
  let configurationError = null;
  if (twoThresholdMode && (warningBudgetMs <= 0 || failureBudgetMs <= 0 || failureBudgetMs < warningBudgetMs)) {
    configurationError = "TEST_BUDGET_WARN_MS und TEST_BUDGET_FAIL_MS müssen positiv sein; die Hard-Fail-Schwelle muss mindestens der Warnschwelle entsprechen.";
  }
  let effectiveFailureBudgetMs = null;
  if (twoThresholdMode) effectiveFailureBudgetMs = failureBudgetMs;
  else if (legacyBudgetConfigured && legacyBudgetMs > 0) effectiveFailureBudgetMs = legacyBudgetMs;
  const budgetMs = effectiveFailureBudgetMs;
  return { twoThresholdMode, warningBudgetMs: twoThresholdMode ? warningBudgetMs : null, effectiveFailureBudgetMs, budgetMs, configurationError };
}

function summarizeBudget(durationMs, configuration) {
  const { twoThresholdMode, warningBudgetMs, effectiveFailureBudgetMs, configurationError } = configuration;
  const warningExceeded = !configurationError && twoThresholdMode && durationMs > warningBudgetMs;
  const failureExceeded = !configurationError && effectiveFailureBudgetMs > 0 && durationMs > effectiveFailureBudgetMs;
  return { warningExceeded, failureExceeded };
}

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
    const configuration = readBudgetConfiguration(process.env);
    const { twoThresholdMode, warningBudgetMs, effectiveFailureBudgetMs, budgetMs, configurationError } = configuration;
    const artifactPath =
      process.env.TEST_METRICS_FILE ?? `test-results/${suite}-metrics.json`;
    const effectiveWarningBudgetMs = warningBudgetMs;
    const { warningExceeded, failureExceeded } = summarizeBudget(durationMs, configuration);
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
        `\nTestbudget [${suite}]: ${durationMs} ms | Warnschwelle: ${warningBudgetMs} ms | Hard Fail: ${effectiveFailureBudgetMs} ms`,
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
        `Testbudget-Warnschwelle überschritten: ${suite} benötigte ${durationMs} ms, Warnschwelle ${warningBudgetMs} ms, Hard-Fail-Schwelle ${effectiveFailureBudgetMs} ms.`,
      );
    }

    if (failureExceeded) {
      if (twoThresholdMode) {
        console.error(
          `Testbudget-Hard-Limit überschritten: ${suite} benötigte ${durationMs} ms, erlaubt sind maximal ${effectiveFailureBudgetMs} ms.`,
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
