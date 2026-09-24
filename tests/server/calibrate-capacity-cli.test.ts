import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  effectiveCapacityForPhase,
  parseCalibrationArgs,
  runCalibration,
  type CalibrationDependencies,
} from "../../scripts/calibrate-capacity";
import type { EffectiveCapacityConfiguration } from "../../scripts/capacity-scenario-runner";

describe("capacity calibration CLI", () => {
  it("raises phase admission to cover active and startup loads while keeping classroom admission explicit", () => {
    const base: EffectiveCapacityConfiguration = {
      simulationMaxConcurrent: 5,
      sandboxStartMaxConcurrent: 8,
      simulationAdmissionMax: 25,
      simulationQueueTimeoutMs: 60_000,
      sandboxStartSlotTimeoutMs: 30_000,
      dockerControlTimeoutMs: 2_000,
      compileMaxConcurrent: 19,
    };
    expect(effectiveCapacityForPhase(base, 40, 40)).toMatchObject({ simulationAdmissionMax: 40 });
    expect(effectiveCapacityForPhase(base, 60, 20)).toMatchObject({ simulationAdmissionMax: 60 });
    expect(effectiveCapacityForPhase(base, 70, 20, 200)).toMatchObject({ simulationAdmissionMax: 200 });
  });

  it("is documented as a review-only workflow with stable artifact names", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const documentation = fs.readFileSync(path.resolve(process.cwd(), "docs/CAPACITY_VALIDATION_PLAN.md"), "utf8");
    expect(packageJson.scripts?.["capacity:calibrate"]).toBe("tsx scripts/calibrate-capacity.ts");
    expect(documentation).toContain("npm run capacity:calibrate -- --expected-users 200");
    expect(documentation).toContain("capacity-calibration.json");
    expect(documentation).toContain("capacity-calibration.md");
    expect(documentation).toContain("capacity.env");
    expect(documentation).toContain("Calibrate -> Review -> Apply");
    expect(documentation).toContain("60-second active duration");
  });

  it("applies documented defaults and fixed classroom duration", async () => {
    await expect(parseCalibrationArgs([])).resolves.toMatchObject({
      expectedUsers: 200,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      skipClassroom: false,
      skipStartupTuning: false,
      dryRun: false,
      verbose: false,
    });
  });

  it("parses supported flags and rejects unknown or invalid values", async () => {
    await expect(parseCalibrationArgs([
      "--expected-users", "120",
      "--target-cpu", "70.5",
      "--max-cpu", "84",
      "--max-user-wait", "180",
      "--max-duration", "12",
      "--output-dir", "tmp/calibration",
      "--skip-classroom",
      "--skip-startup-tuning",
      "--dry-run",
      "--verbose",
    ])).resolves.toMatchObject({
      expectedUsers: 120,
      targetCpuPercent: 70.5,
      maxCpuPercent: 84,
      maxUserWaitSec: 180,
      maxDurationMin: 12,
      outputDir: "tmp/calibration",
      skipClassroom: true,
      skipStartupTuning: true,
      dryRun: true,
      verbose: true,
    });
    await expect(parseCalibrationArgs(["--unknown"])).rejects.toThrow(/Unknown option/);
    await expect(parseCalibrationArgs(["--expected-users", "0"])).rejects.toThrow(/expectedUsers/);
    await expect(parseCalibrationArgs(["--target-cpu", "85", "--max-cpu", "85"])).rejects.toThrow(/less than/);
    await expect(parseCalibrationArgs(["--expected-users"])).rejects.toThrow(/requires a value/);
  });

  it("runs probes and scenario phases in order without applying recommendations", async () => {
    const order: string[] = [];
    const phaseCapacities: Array<{ simulationMaxConcurrent: number; sandboxStartMaxConcurrent: number; simulationAdmissionMax: number }> = [];
    const runScenario = vi.fn(async (options) => {
      order.push(`scenario:${options.clientCount}`);
      return {
        scenario: options.scenario,
        holdDurationMs: options.holdDurationMs,
        arrivalWindowMs: options.arrivalWindowMs ?? 0,
        clients: [],
        statusHistory: [{ capacity: {
          simulation: { maxConcurrent: options.clientCount, active: 0 },
          sandboxStart: { maxConcurrent: options.clientCount, active: 0, waiting: 0, slotTimeoutMs: 30_000 },
          admission: { max: 200, current: 0 },
          queue: { waiting: 0, timeoutMs: 60_000 },
          compile: { maxConcurrent: 19, active: 0 },
        } }],
        runtimeConfiguration: {
          simulationMaxConcurrent: options.clientCount,
          sandboxStartMaxConcurrent: options.clientCount,
          simulationAdmissionMax: 200,
          simulationQueueTimeoutMs: 60_000,
          sandboxStartSlotTimeoutMs: 30_000,
          dockerControlTimeoutMs: 2_000,
          compileMaxConcurrent: 19,
        },
        lifecycleDockerPeak: options.clientCount,
        pollingDockerPeak: options.clientCount,
        activePeak: options.clientCount,
        queuePeak: 0,
        admissionPeak: options.clientCount,
        sandboxStartPeak: options.clientCount,
        sandboxStartWaitingPeak: 0,
        startupSlotWaitMs: [100],
        startupDurationMs: [500],
        queueWaitMs: [],
        hostSamples: [{
          atMs: 1,
          cpuPercent: 50,
          loadAverage: 2,
          availableMemoryBytes: 8_000_000_000,
          swapUsedBytes: 0,
          iowaitPercent: 1,
          runningDockerContainers: options.clientCount,
          capacityDockerContainers: options.clientCount,
        }],
        errors: [],
        cleanup: {
          backendExited: false,
          remainingCapacityContainers: 0,
          activeSimulationCount: 0,
          queueWaiting: 0,
          admissionCurrent: 0,
          sandboxStartActive: 0,
          sandboxStartWaiting: 0,
        },
      };
    });
    let stopCount = 0;
    const deps: CalibrationDependencies = {
      collectHostProbe: vi.fn(async () => {
        order.push("host");
        return {
          required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 4 },
          optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
          safetySignals: { cpuAvailable: true, memoryAvailable: true },
        };
      }),
      collectDockerProbe: vi.fn(async () => {
        order.push("docker");
        return {
          clientVersion: "29", serverVersion: "29", architecture: "x64", cpus: 4, memoryBytes: 16_000_000_000,
          storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "img", digest: null }, runningContainers: [],
        };
      }),
      measureDockerControlLatency: vi.fn(async () => {
        order.push("control");
        return [{ command: "docker info", condition: "parallel", durationsMs: [100, 120], error: null }];
      }),
      runScenario,
      startBackend: vi.fn(async (capacity) => {
        phaseCapacities.push(capacity);
        return { baseUrl: "http://127.0.0.1:1234", stop: async () => { stopCount++; } };
      }),
      now: () => 1_000,
    };

    const result = await runCalibration({
      expectedUsers: 20,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      outputDir: "capacity-test-results/test-cli",
      skipClassroom: true,
      skipStartupTuning: true,
      dryRun: false,
      verbose: false,
    }, deps);

    expect(order.slice(0, 3)).toEqual(["host", "docker", "control"]);
    expect(runScenario).toHaveBeenCalled();
    expect(result.recommendations.simulationMaxConcurrent.value).toBe(20);
    expect(result.recommendations.simulationAdmissionMax.value).toBeNull();
    expect(phaseCapacities).toEqual([
      expect.objectContaining({ simulationMaxConcurrent: 20, sandboxStartMaxConcurrent: 20, simulationAdmissionMax: 25 }),
    ]);
    expect(runScenario.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      clientCount: 20,
      requiredAdmissionMax: 25,
      expectedSimulationMaxConcurrent: 20,
      expectedSandboxStartMaxConcurrent: 20,
    }));
    expect(stopCount).toBeGreaterThan(0);
    expect(result.partial).toBe(false);
  });

  it("stops and cleans the owned backend when a scenario fails", async () => {
    const stop = vi.fn(async () => undefined);
    const result = await runCalibration({
      expectedUsers: 20,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      outputDir: "capacity-test-results/test-cli-error",
      skipClassroom: true,
      skipStartupTuning: true,
      dryRun: false,
      verbose: false,
    }, {
      collectHostProbe: async () => ({
        required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 4 },
        optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
        safetySignals: { cpuAvailable: true, memoryAvailable: true },
      }),
      collectDockerProbe: async () => ({ clientVersion: "29", serverVersion: "29", architecture: "x64", cpus: 4, memoryBytes: 16_000_000_000, storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "img", digest: null }, runningContainers: [] }),
      measureDockerControlLatency: async () => [],
      startBackend: async () => ({ baseUrl: "http://127.0.0.1:1234", stop }),
      runScenario: async () => { throw new Error("scenario failed"); },
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(result.partial).toBe(true);
    expect(result.stopReason).toBe("scenario failed");
  });

  it("writes a partial report when Docker preflight fails", async () => {
    const outputDir = path.resolve(process.cwd(), "capacity-test-results/test-preflight-error");
    const resultPromise = runCalibration({
      expectedUsers: 20,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      outputDir,
      skipClassroom: false,
      skipStartupTuning: false,
      dryRun: false,
      verbose: false,
    }, {
      collectHostProbe: async () => ({
        required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 4 },
        optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
        safetySignals: { cpuAvailable: true, memoryAvailable: true },
      }),
      collectDockerProbe: async () => { throw new Error("Docker unavailable"); },
    });
    await expect(resultPromise).rejects.toThrow("Docker unavailable");
    expect(fs.existsSync(path.join(outputDir, "capacity-calibration.json"))).toBe(true);
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, "capacity-calibration.json"), "utf8")) as { partial: boolean; stopReason: string };
    expect(report.partial).toBe(true);
    expect(report.stopReason).toBe("Docker unavailable");
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
});
