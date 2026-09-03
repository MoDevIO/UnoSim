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
    const budgetMs = Number(process.env.TEST_BUDGET_MS ?? 0);
    const artifactPath =
      process.env.TEST_METRICS_FILE ?? `test-results/${suite}-metrics.json`;
    const budgetExceeded = budgetMs > 0 && durationMs > budgetMs;
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
      budgetMs: budgetMs || null,
      budgetExceeded,
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

    const budgetLabel = budgetMs > 0 ? `${budgetMs} ms` : "deaktiviert";
    console.log(`\nTestbudget [${suite}]: ${durationMs} ms / ${budgetLabel}`);
    console.log(`Messartefakt: ${artifactPath}`);
    console.log(`Langsamste ${slowestTests.length} Tests:`);
    for (const test of slowestTests) {
      console.log(
        `  ${test.durationMs.toString().padStart(6)} ms  ${test.name}`,
      );
    }

    if (budgetExceeded) {
      console.error(
        `Testbudget ueberschritten: ${suite} benoetigte ${durationMs} ms, erlaubt sind ${budgetMs} ms.`,
      );
      process.exitCode = 1;
    }
  }
}
