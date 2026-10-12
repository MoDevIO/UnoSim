import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INPUT_LIMITS, TEST_RUN_ID_PATTERN } from "@shared/input-limits";
import {
  assertCalibrationBuildArtifacts,
  createCalibrationRunId,
  effectiveCapacityForPhase,
  getClassroomOutcomeCounts,
  parseCalibrationArgs,
  runCalibration,
  type CalibrationDependencies,
} from "../../scripts/calibrate-capacity";
import type { EffectiveCapacityConfiguration } from "../../scripts/capacity-scenario-runner";

describe("capacity calibration CLI", () => {
  it("counts a classroom with 40 successes and 160 SYSTEM_BUSY clients correctly", () => {
    const clients = [
      ...Array.from({ length: 40 }, () => ({ started: true, runtimeStartedAtMs: 1, completedAtMs: 2, operationErrorCodes: [], errors: [] })),
      ...Array.from({ length: 160 }, () => ({ started: false, runtimeStartedAtMs: null, completedAtMs: null, operationErrorCodes: ["SYSTEM_BUSY"], errors: [] })),
    ];
    expect(getClassroomOutcomeCounts(clients as never)).toEqual({ requested: 200, started: 40, successful: 40, rejected: 160, failed: 0, incomplete: 0 });
  });
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
    expect(effectiveCapacityForPhase(base, 40, 8, 200, 330_000)).toMatchObject({ simulationQueueTimeoutMs: 330_000 });
  });

  it("is documented as a review-only workflow with stable artifact names", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const documentation = fs.readFileSync(path.resolve(process.cwd(), "docs/CAPACITY_MODEL.md"), "utf8");
    expect(packageJson.scripts?.["capacity:calibrate"]).toBe("tsx scripts/calibrate-capacity.ts");
    expect(documentation).toContain("npm run capacity:calibrate -- --expected-users 200");
    expect(documentation).toContain("capacity-calibration.json");
    expect(documentation).toContain("capacity-calibration.md");
    expect(documentation).toContain("capacity.env");
    expect(documentation).toContain("Calibrate -> Review -> Apply");
    expect(documentation).toContain("60-second active duration");
  });

  it("documents the build preconditions in order for host calibration", () => {
    const sequence = /npm ci\n\s*npm run build\n\s*npm run build:sandbox\n\s*npm run capacity:calibrate -- --expected-users/;
    for (const file of ["docs/INSTALL_SERVER.md", "docs/CAPACITY_MODEL.md"]) {
      const documentation = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(documentation, file).toMatch(sequence);
    }
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
      verifyBuildArtifacts: () => undefined,
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
      ownedContainerCount: () => 0,
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

  it("measures a bounded intermediate candidate for a normal CPU bracket", async () => {
    const measured: number[] = [];
    const cpuByCandidate: Record<number, number> = { 20: 30, 40: 57, 60: 84, 80: 94, 50: 70 };
    const result = await runCalibration({
      expectedUsers: 100,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      outputDir: "capacity-test-results/test-bracket",
      skipClassroom: true,
      skipStartupTuning: true,
      dryRun: false,
      verbose: false,
    }, {
      verifyBuildArtifacts: () => undefined,
      collectHostProbe: async () => ({
        required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 20 },
        optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
        safetySignals: { cpuAvailable: true, memoryAvailable: true },
      }),
      collectDockerProbe: async () => ({ clientVersion: "29", serverVersion: "29", architecture: "x64", cpus: 20, memoryBytes: 16_000_000_000, storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "img", digest: null }, runningContainers: [] }),
      measureDockerControlLatency: async () => [],
      startBackend: async () => ({ baseUrl: "http://127.0.0.1:1234", stop: async () => undefined }),
      ownedContainerCount: () => 0,
      runScenario: async (options) => {
        measured.push(options.clientCount);
        const cpu = cpuByCandidate[options.clientCount] ?? 50;
        return {
          scenario: options.scenario,
          holdDurationMs: options.holdDurationMs,
          arrivalWindowMs: options.arrivalWindowMs ?? 0,
          clients: [],
          statusHistory: [],
          runtimeConfiguration: {
            simulationMaxConcurrent: options.clientCount,
            sandboxStartMaxConcurrent: options.clientCount,
            simulationAdmissionMax: Math.max(25, options.clientCount),
            simulationQueueTimeoutMs: 60_000,
            sandboxStartSlotTimeoutMs: 30_000,
            dockerControlTimeoutMs: 2_000,
            compileMaxConcurrent: 19,
          },
          lifecycleDockerPeak: options.clientCount,
          pollingDockerPeak: options.clientCount,
          activePeak: options.clientCount,
          queuePeak: 0,
          admissionPeak: Math.max(25, options.clientCount),
          sandboxStartPeak: options.clientCount,
          sandboxStartWaitingPeak: 0,
          startupSlotWaitMs: [],
          startupDurationMs: [],
          queueWaitMs: [],
          hostSamples: [{ atMs: 1, cpuPercent: cpu, loadAverage: 2, availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, runningDockerContainers: options.clientCount, capacityDockerContainers: options.clientCount }],
          errors: [],
          cleanup: { backendExited: true, remainingCapacityContainers: 0, activeSimulationCount: 0, queueWaiting: 0, admissionCurrent: 0, sandboxStartActive: 0, sandboxStartWaiting: 0 },
        };
      },
    });
    expect(measured).toEqual([20, 40, 60, 80, 50]);
    expect(result.recommendations.simulationMaxConcurrent.value).toBe(50);
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
      verifyBuildArtifacts: () => undefined,
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
      verifyBuildArtifacts: () => undefined,
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
  describe("calibration run IDs", () => {
    it("matches the central test-run-ID pattern and length limit", () => {
      const runId = createCalibrationRunId();
      expect(runId).toMatch(TEST_RUN_ID_PATTERN);
      expect(runId.length).toBeLessThanOrEqual(INPUT_LIMITS.webSocket.maxTestRunIdChars);
    });

    it("stays within the limit for the longest realistic timestamp and a canonical UUID", () => {
      const runId = createCalibrationRunId(() => 9_999_999_999_999, () => "00000000-0000-4000-8000-000000000000");
      expect(runId).toBe("cap_9999999999999_00000000-0000-4000-8000-000000000000");
      expect(runId).toMatch(TEST_RUN_ID_PATTERN);
      expect(runId.length).toBeLessThanOrEqual(INPUT_LIMITS.webSocket.maxTestRunIdChars);
    });

    it("distinguishes runs by timestamp and by UUID", () => {
      const uuid = "11111111-1111-4111-8111-111111111111";
      const other = "22222222-2222-4222-8222-222222222222";
      const ids = new Set([
        createCalibrationRunId(() => 1_000, () => uuid),
        createCalibrationRunId(() => 1_001, () => uuid),
        createCalibrationRunId(() => 1_000, () => other),
      ]);
      expect(ids.size).toBe(3);
    });

    it("rejects an ID that the backend would refuse instead of starting a doomed backend", () => {
      expect(() => createCalibrationRunId(() => 1, () => "x".repeat(INPUT_LIMITS.webSocket.maxTestRunIdChars))).toThrow(/Calibration run ID must match/);
      expect(() => createCalibrationRunId(() => 1, () => "not url safe/..")).toThrow(/Calibration run ID must match/);
    });
  });

  describe("built-application preflight", () => {
    const withTempDir = (run: (dir: string) => void | Promise<void>) => async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unosim-calibration-build-"));
      try { await run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    };
    const baseConfig = {
      expectedUsers: 20,
      targetCpuPercent: 75,
      maxCpuPercent: 85,
      maxUserWaitSec: 240,
      maxDurationMin: 30,
      classroomDurationSec: 60,
      skipClassroom: false,
      skipStartupTuning: false,
      verbose: false,
    } as const;

    it("accepts an existing built client index", withTempDir((dir) => {
      const indexPath = path.join(dir, "index.html");
      fs.writeFileSync(indexPath, "<!doctype html>");
      expect(() => assertCalibrationBuildArtifacts(indexPath)).not.toThrow();
    }));

    it("tells the operator to run npm run build when the client index is missing", withTempDir((dir) => {
      const indexPath = path.join(dir, "dist", "public", "index.html");
      expect(() => assertCalibrationBuildArtifacts(indexPath)).toThrow(
        /Capacity calibration requires a built application.*run npm run build\./,
      );
      expect(() => assertCalibrationBuildArtifacts(indexPath)).toThrow(indexPath);
    }));

    it("aborts before any Docker probe, control measurement, backend, or report when the build is missing", withTempDir(async (dir) => {
      const outputDir = path.join(dir, "results");
      const missingIndex = path.join(dir, "dist", "public", "index.html");
      const collectHostProbe = vi.fn();
      const collectDockerProbe = vi.fn();
      const measureDockerControlLatency = vi.fn();
      const startBackend = vi.fn();
      const runScenario = vi.fn();
      await expect(runCalibration(
        { ...baseConfig, outputDir, dryRun: false },
        {
          verifyBuildArtifacts: () => assertCalibrationBuildArtifacts(missingIndex),
          collectHostProbe,
          collectDockerProbe,
          measureDockerControlLatency,
          startBackend,
          runScenario,
        },
      )).rejects.toThrow(/requires a built application.*npm run build/);
      expect(collectHostProbe).not.toHaveBeenCalled();
      expect(collectDockerProbe).not.toHaveBeenCalled();
      expect(measureDockerControlLatency).not.toHaveBeenCalled();
      expect(startBackend).not.toHaveBeenCalled();
      expect(runScenario).not.toHaveBeenCalled();
      expect(fs.existsSync(outputDir)).toBe(false);
    }));

    it("does not require the build for a dry run, which starts no backend", withTempDir(async (dir) => {
      const verifyBuildArtifacts = vi.fn(() => { throw new Error("must not be called"); });
      const startBackend = vi.fn();
      const result = await runCalibration(
        { ...baseConfig, outputDir: path.join(dir, "results"), dryRun: true },
        {
          verifyBuildArtifacts,
          collectHostProbe: async () => ({
            required: { gitSha: "abc", gitDirty: false, nodeVersion: "v24.20.0", architecture: "x64", logicalCpus: 4 },
            optional: { physicalMemoryBytes: 16_000_000_000, loadAverage: [1], availableMemoryBytes: 8_000_000_000, swapUsedBytes: 0, iowaitPercent: 1, thermalPressure: null },
            safetySignals: { cpuAvailable: true, memoryAvailable: true },
          }),
          collectDockerProbe: async () => ({ clientVersion: "29", serverVersion: "29", architecture: "x64", cpus: 4, memoryBytes: 16_000_000_000, storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "img", digest: null }, runningContainers: [] }),
          startBackend,
        },
      );
      expect(verifyBuildArtifacts).not.toHaveBeenCalled();
      expect(startBackend).not.toHaveBeenCalled();
      expect(result.phases.active).toEqual([]);
    }));
  });
});
