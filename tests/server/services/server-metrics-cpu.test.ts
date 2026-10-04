import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let metrics: typeof import("../../../server/services/server-metrics");
let now: number;
let cpu: NodeJS.CpuUsage;

beforeEach(async () => {
  vi.resetModules();
  metrics = await import("../../../server/services/server-metrics");
  now = 1_000;
  cpu = { user: 0, system: 0 };
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(process, "cpuUsage").mockImplementation(() => ({ ...cpu }));
});

afterEach(() => vi.restoreAllMocks());

describe("process CPU sampling", () => {
  it.each([
    { user: 900_000, system: 50_000, expected: 95 },
    { user: 1_800_000, system: 200_000, expected: 200 },
  ])("converts microseconds to elapsed time: $expected percent", ({ user, system, expected }) => {
    expect(metrics.getProcessMetrics().cpuPercent).toBe(0);
    now = 2_000;
    cpu = { user, system };
    const sampled = metrics.getProcessMetrics();
    expect(sampled.cpuPercent).toBe(expected);
    const alerts = metrics.evaluateObservabilityAlerts({
      compileMetrics: metrics.compileMetricsTracker.getMetrics(),
      compileQueueDepth: 0,
      runnerQueueDepth: 0,
      runnerCapacity: 1,
      processMetrics: sampled,
    });
    expect(alerts.map(({ code }) => code)).toContain("process_cpu_high");
  });

  it("keeps a finite value and the complete interval for same-timestamp polls", () => {
    metrics.getProcessMetrics();
    cpu = { user: 50_000, system: 0 };
    expect(metrics.getProcessMetrics().cpuPercent).toBe(0);
    now = 2_000;
    cpu = { user: 1_000_000, system: 0 };
    expect(metrics.getProcessMetrics().cpuPercent).toBe(100);
    expect(metrics.getProcessMetrics().cpuPercent).toBe(100);
  });

  it("retains the last valid sample through a backwards wall-clock adjustment", () => {
    metrics.getProcessMetrics();
    now = 2_000;
    cpu = { user: 950_000, system: 0 };
    expect(metrics.getProcessMetrics().cpuPercent).toBe(95);
    now = 1_999;
    cpu = { user: 1_000_000, system: 0 };
    expect(metrics.getProcessMetrics().cpuPercent).toBe(95);
    now = 3_000;
    cpu = { user: 1_900_000, system: 0 };
    expect(metrics.getProcessMetrics().cpuPercent).toBe(95);
  });
});
