import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestBudgetReporter from "../../scripts/test-budget-reporter.mjs";

type Metrics = {
  schemaVersion: number;
  suite: string;
  budgetMs: number | null;
  budgetExceeded: boolean;
  warningBudgetMs: number | null;
  failureBudgetMs: number | null;
  warningExceeded: boolean;
  failureExceeded: boolean;
  configurationError: string | null;
  durationMs: number;
  counts: Record<string, number>;
  slowestTests: Array<Record<string, unknown>>;
};

describe("TestBudgetReporter", () => {
  let tempDir: string;
  let metricsPath: string;
  let originalExitCode: typeof process.exitCode;
  let originalEnv: Record<string, string | undefined>;

  const envKeys = [
    "TEST_BUDGET_MS",
    "TEST_BUDGET_WARN_MS",
    "TEST_BUDGET_FAIL_MS",
    "TEST_BUDGET_SUITE",
    "TEST_METRICS_FILE",
  ];

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "test-budget-reporter-"));
    metricsPath = path.join(tempDir, "metrics.json");
    originalExitCode = process.exitCode;
    originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.exitCode = undefined;
    delete process.env.TEST_BUDGET_MS;
    delete process.env.TEST_BUDGET_WARN_MS;
    delete process.env.TEST_BUDGET_FAIL_MS;
    process.env.TEST_BUDGET_SUITE = "unit-coverage-test";
    process.env.TEST_METRICS_FILE = metricsPath;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  function runReporter(durationMs: number): Metrics {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000 + durationMs);

    const reporter = new TestBudgetReporter();
    reporter.onTestCaseResult({
      diagnostic: () => ({ duration: 12.4 }),
      result: () => ({ state: "passed" }),
      fullName: "example test",
      module: { moduleId: path.join(process.cwd(), "tests/example.test.ts") },
    } as never);
    reporter.onTestRunEnd([], [], "passed");
    return JSON.parse(readFileSync(metricsPath, "utf8")) as Metrics;
  }

  it("preserves the legacy pass behavior under budget", () => {
    process.env.TEST_BUDGET_MS = "60000";

    const metrics = runReporter(50_000);

    expect(process.exitCode).toBeUndefined();
    expect(metrics.budgetMs).toBe(60_000);
    expect(metrics.budgetExceeded).toBe(false);
  });

  it("preserves the legacy hard-fail behavior over budget", () => {
    process.env.TEST_BUDGET_MS = "60000";

    const metrics = runReporter(60_001);

    expect(process.exitCode).toBe(1);
    expect(metrics.budgetExceeded).toBe(true);
  });

  it("does not flag a run below the warning threshold", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(59_000);

    expect(process.exitCode).toBeUndefined();
    expect(metrics.warningExceeded).toBe(false);
    expect(metrics.failureExceeded).toBe(false);
    expect(metrics.budgetMs).toBe(70_000);
    expect(metrics.budgetExceeded).toBe(false);
  });

  it("warns but passes for the historical 60,970 ms run", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(60_970);

    expect(process.exitCode).toBeUndefined();
    expect(metrics.warningExceeded).toBe(true);
    expect(metrics.failureExceeded).toBe(false);
    expect(metrics.budgetExceeded).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Warnschwelle 60000 ms"),
    );
  });

  it("hard-fails above the failure threshold", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(70_001);

    expect(process.exitCode).toBe(1);
    expect(metrics.warningExceeded).toBe(true);
    expect(metrics.failureExceeded).toBe(true);
    expect(metrics.budgetExceeded).toBe(true);
  });

  it("allows the exact hard-fail boundary", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(70_000);

    expect(process.exitCode).toBeUndefined();
    expect(metrics.warningExceeded).toBe(true);
    expect(metrics.failureExceeded).toBe(false);
  });

  it("allows the exact warning boundary without warning", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(60_000);

    expect(process.exitCode).toBeUndefined();
    expect(metrics.warningExceeded).toBe(false);
    expect(metrics.failureExceeded).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("rejects invalid threshold configuration", () => {
    process.env.TEST_BUDGET_WARN_MS = "70000";
    process.env.TEST_BUDGET_FAIL_MS = "60000";

    const metrics = runReporter(50_000);

    expect(process.exitCode).toBe(1);
    expect(metrics.configurationError).toContain("Hard-Fail-Schwelle");
  });

  it("retains existing metric fields and writes the new threshold fields", () => {
    process.env.TEST_BUDGET_WARN_MS = "60000";
    process.env.TEST_BUDGET_FAIL_MS = "70000";

    const metrics = runReporter(60_970);

    expect(metrics).toMatchObject({
      schemaVersion: 1,
      suite: "unit-coverage-test",
      warningBudgetMs: 60_000,
      failureBudgetMs: 70_000,
      durationMs: 60_970,
      counts: { passed: 1 },
      slowestTests: [{ name: "example test", durationMs: 12 }],
    });
    expect(metrics).toHaveProperty("budgetExceeded");
    expect(metrics).toHaveProperty("startedAt");
    expect(metrics).toHaveProperty("finishedAt");
  });
});
