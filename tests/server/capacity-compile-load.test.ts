import { describe, expect, it, vi } from "vitest";
import { measureCompileLoad, planCompileLoad, renderCompileLoadTable } from "../../scripts/capacity-compile-load";
import type { RestCompileBatchMeasurement, RestCompileBatchOptions } from "../../scripts/capacity-rest-compile";
import { parseCalibrationArgs, runCalibration, type CalibrationDependencies } from "../../scripts/calibrate-capacity";

function batch(options: RestCompileBatchOptions, latency = 400): RestCompileBatchMeasurement {
  return {
    requested: options.requestCount, concurrency: options.concurrency, completed: options.requestCount,
    successful: options.requestCount, failed: 0, serviceUnavailable: 0,
    averageLatencyMs: latency, p50LatencyMs: latency, p95LatencyMs: latency + 100, p99LatencyMs: latency + 100, maxLatencyMs: latency + 200,
    latencyMs: Array(options.requestCount).fill(latency), results: [],
  };
}

describe("compile load plan (plan 4.12, P7.1)", () => {
  it("models single compiles, the worker pool, a class burst and the burst on an unchanged example", () => {
    expect(planCompileLoad(30, 8)).toEqual([
      { name: "serial", requests: 5, concurrency: 1, sketch: "unique" },
      { name: "pool", requests: 16, concurrency: 8, sketch: "unique" },
      { name: "class-burst", requests: 30, concurrency: 30, sketch: "unique" },
      { name: "class-burst-cached", requests: 30, concurrency: 30, sketch: "shared" },
    ]);
  });

  it("caps the burst at one REST compile batch and the pool at the burst", () => {
    expect(planCompileLoad(200, 8).find((step) => step.name === "class-burst")).toMatchObject({ requests: 64, concurrency: 64 });
    expect(planCompileLoad(4, 8).find((step) => step.name === "pool")).toMatchObject({ requests: 16, concurrency: 4 });
  });
});

describe("measureCompileLoad", () => {
  it("measures every step, warms the cache before the shared burst and drops the raw latencies", async () => {
    const calls: RestCompileBatchOptions[] = [];
    let clock = 0;
    const runBatch = vi.fn(async (options: RestCompileBatchOptions) => {
      calls.push(options);
      clock += 2_000;
      return batch(options);
    });
    const measurements = await measureCompileLoad(
      { baseUrl: "http://127.0.0.1:1", runId: "cap-1" },
      planCompileLoad(10, 8),
      { runBatch, countCompileContainers: () => 3, sampleHost: async () => ({ atMs: 0, cpuPercent: 40, loadAverage: 1, availableMemoryBytes: 1_000, swapUsedBytes: 0, iowaitPercent: 0, runningDockerContainers: 3, capacityDockerContainers: 3 }), now: () => clock },
    );

    expect(calls.map((call) => [call.requestCount, call.concurrency, call.sketch, call.sketchSeed])).toEqual([
      [5, 1, "unique", "serial"], [16, 8, "unique", "pool"], [10, 10, "unique", "class-burst"],
      [1, 1, "shared", "class-burst-cached"], [10, 10, "shared", "class-burst-cached"],
    ]);
    expect(measurements.map((m) => m.step)).toEqual(["serial", "pool", "class-burst", "class-burst-cached"]);
    expect(measurements[2]).toMatchObject({ durationMs: 2_000, successfulPerMinute: 300, p95LatencyMs: 500 });
    expect(measurements[0]).not.toHaveProperty("latencyMs");
    expect(measurements[0]).not.toHaveProperty("results");
  });

  it("renders a table row per step and a note without measurements", () => {
    const options = { baseUrl: "", runId: "x", requestCount: 30, concurrency: 30 };
    const row = { ...batch(options), step: "class-burst" as const, sketch: "unique" as const, durationMs: 4_000, successfulPerMinute: 450, compileContainerPeak: 8, cpuPeakPercent: 91.4, availableMemoryMinBytes: null };
    const { latencyMs: _l, results: _r, ...summary } = row;
    expect(renderCompileLoadTable([summary]).at(-1)).toBe("| class-burst | unique | 30 × 30 | 30 / 0 / 0 | 400 / 500 / 600 | 450 | 8 | 91 % |");
    expect(renderCompileLoadTable([])).toEqual(["Compile load: not measured."]);
  });
});

describe("calibration compile phase", () => {
  it("is measured by the CLI unless --skip-compile", async () => {
    expect((await parseCalibrationArgs([])).compilePhase).toBe("measure");
    expect((await parseCalibrationArgs(["--skip-compile"])).compilePhase).toBe("skip");
  });

  it("runs on its own backend with the effective capacity and lands in the result", async () => {
    const started: string[] = [];
    const measureCompileLoad = vi.fn(async () => []);
    const deps: CalibrationDependencies = {
      verifyBuildArtifacts: () => undefined,
      collectHostProbe: async () => ({
        required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 4 },
        optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
        safetySignals: { cpuAvailable: true, memoryAvailable: true },
      }),
      collectDockerProbe: async () => ({
        clientVersion: "29", serverVersion: "29", architecture: "x64", cpus: 4, memoryBytes: 16_000_000_000,
        storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "img", digest: null }, runningContainers: [],
      }),
      measureDockerControlLatency: async () => [],
      // No simulation phase measures anything here: the candidates fail, the compile phase still runs.
      runScenario: async () => { throw new Error("no simulation in this test"); },
      ownedContainerCount: () => 0,
      startBackend: async (_capacity, runId) => { started.push(runId); return { baseUrl: `http://127.0.0.1:1/${runId}`, stop: async () => undefined }; },
      measureCompileLoad,
      now: () => 1_000,
    };
    const result = await runCalibration({
      expectedUsers: 30, targetCpuPercent: 75, maxCpuPercent: 85, maxUserWaitSec: 240, maxDurationMin: 30, classroomDurationSec: 60,
      outputDir: "capacity-test-results/test-compile-phase", skipClassroom: true, skipStartupTuning: true, compilePhase: "measure", dryRun: false, verbose: false,
    }, deps);

    expect(measureCompileLoad).toHaveBeenCalledOnce();
    const [target, steps] = measureCompileLoad.mock.calls[0] as unknown as [{ baseUrl: string; runId: string }, unknown[]];
    expect(started).toContain(target.runId);
    expect(steps).toEqual(result.plan.compileSteps);
    expect(result.phases.compile).toEqual([]);
  });
});
