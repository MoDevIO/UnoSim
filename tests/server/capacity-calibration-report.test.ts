import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderCalibrationMarkdown,
  renderCapacityEnv,
  writeCalibrationArtifacts,
} from "../../scripts/capacity-calibration-report";
import type { CalibrationRunResult } from "../../scripts/calibrate-capacity";

const temporaryDirectories: string[] = [];

function fixture(): CalibrationRunResult {
  return {
    schemaVersion: 1,
    policyVersion: "1",
    policy: { expectedUsers: 200, targetCpuPercent: 75, maxCpuPercent: 85, maxUserWaitSec: 240, maxDurationMin: 30, classroomDurationSec: 60 },
    fingerprint: {
      gitSha: "abc123",
      gitDirty: false,
      host: {
        required: { gitSha: "abc123", gitDirty: false, nodeVersion: "v24.20.0", architecture: "arm64", logicalCpus: 10 },
        optional: { physicalMemoryBytes: 32_000, loadAverage: [1], availableMemoryBytes: 16_000, swapUsedBytes: null, iowaitPercent: null, thermalPressure: null },
        safetySignals: { cpuAvailable: true, memoryAvailable: true },
      },
      docker: {
        clientVersion: "29", serverVersion: "29", architecture: "aarch64", cpus: 10, memoryBytes: 25_000,
        storageDriver: "overlay2", daemonHealthy: true, image: { reference: "unosim-sandbox:latest", id: "sha256:image", digest: "sha256:digest" }, runningContainers: [],
      },
      effectiveCapacity: {
        simulationMaxConcurrent: 5, sandboxStartMaxConcurrent: 8, simulationAdmissionMax: 25,
        simulationQueueTimeoutMs: 60_000, sandboxStartSlotTimeoutMs: 30_000, dockerControlTimeoutMs: 2_000, compileMaxConcurrent: 9,
      },
      measurementQueueTimeoutMs: 330_000,
    },
    plan: { activeCandidates: [20, 40], startupCandidates: [8, 12], classroomDurationSec: 60 },
    phases: {
      dockerControl: [],
      active: [],
      startup: [{
        requested: 20,
        stable: true,
        startupSlotWaitP95Ms: 8_000,
        startupSlotWaitMaxMs: 8_000,
        startupDurationP95Ms: 10_000,
        cpuP95Percent: 40,
        iowaitP95Percent: 1,
        minAvailableMemoryBytes: 16_000,
        failures: 0,
        timeouts: 0,
        startupSlotWaitSamplesComplete: true,
        startupSlotWaitSampleCount: 20,
      }],
      classroom: null,
    },
    recommendations: {
      simulationMaxConcurrent: { value: 40, status: "recommended", confidence: "HIGH", measuredBasis: ["40 measured"], warnings: [] },
      sandboxStartMaxConcurrent: { value: 20, status: "recommended", confidence: "HIGH", measuredBasis: ["20 measured"], warnings: [] },
      simulationAdmissionMax: { value: 200, status: "recommended", confidence: "HIGH", measuredBasis: ["200 admitted"], warnings: [] },
      simulationQueueTimeoutMs: { value: null, status: "infeasible", confidence: "MEDIUM", measuredBasis: ["technical 300000ms", "UX 240000ms"], warnings: ["infeasible"] },
      sandboxStartSlotTimeoutMs: { value: 30_000, status: "recommended", confidence: "HIGH", measuredBasis: ["p99 8000ms"], warnings: [] },
      dockerControlTimeoutMs: { value: null, status: "out-of-range", confidence: "HIGH", measuredBasis: ["p99 40000ms"], warnings: ["out-of-range"] },
      compileMaxConcurrent: { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: [] },
    },
    safetyEvents: [],
    partial: false,
    stopReason: null,
    cleanup: { backendExited: false, remainingCapacityContainers: 0, activeSimulationCount: 0, queueWaiting: 0, admissionCurrent: 0, sandboxStartActive: 0, sandboxStartWaiting: 0 },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("capacity calibration reports", () => {
  it("renders versioned reproducibility and recommendation sections", () => {
    const result = fixture();
    const markdown = renderCalibrationMarkdown(result);
    expect(markdown).toContain("schemaVersion: 1");
    expect(markdown).toContain("policyVersion: 1");
    expect(markdown).toContain("abc123");
    expect(markdown).toContain("overlay2");
    expect(markdown).toContain("technical 300000ms");
    expect(markdown).toContain("Classroom measurement queue timeout: 330000ms");
    expect(markdown).toContain("infeasible");
    expect(markdown).toContain("No production configuration was changed");
  });

  it("emits only directly measured recommended values in the unapplied env fragment", () => {
    const env = renderCapacityEnv(fixture());
    expect(env).toContain("SIMULATION_MAX_CONCURRENT=40");
    expect(env).toContain("SANDBOX_START_MAX_CONCURRENT=20");
    expect(env).not.toContain("SIMULATION_ADMISSION_MAX=200");
    expect(env).toContain("SIMULATION_ADMISSION_MAX omitted: classroom admission validation not completed successfully");
    expect(env).toContain("SANDBOX_START_SLOT_TIMEOUT_MS=30000");
    expect(env).not.toContain("clientWatchdogMs");
    expect(env).not.toContain("CLIENT_WATCHDOG");
    expect(env).not.toContain("SIMULATION_QUEUE_TIMEOUT_MS=");
    expect(env).not.toContain("DOCKER_CONTROL_TIMEOUT_MS=");
    expect(env).not.toContain("COMPILE_MAX_CONCURRENT=");
    expect(env).toContain("review");
  });

  it("emits admission only after a successful classroom envelope validation", () => {
    const result = fixture();
    result.phases.classroom = {
      scenario: "classroom",
      holdDurationMs: 60_000,
      arrivalWindowMs: 5_000,
      clients: [],
      statusHistory: [],
      runtimeConfiguration: { ...result.fingerprint.effectiveCapacity, simulationAdmissionMax: 200 },
      lifecycleDockerPeak: 70,
      pollingDockerPeak: 70,
      activePeak: 70,
      queuePeak: 130,
      admissionPeak: 200,
      sandboxStartPeak: 20,
      sandboxStartWaitingPeak: 50,
      startupSlotWaitMs: Array.from({ length: 200 }, () => 0),
      startupDurationMs: [],
      queueWaitMs: [],
      hostSamples: [],
      errors: [],
      cleanup: {
        backendExited: true,
        remainingCapacityContainers: 0,
        activeSimulationCount: 0,
        queueWaiting: 0,
        admissionCurrent: 0,
        sandboxStartActive: 0,
        sandboxStartWaiting: 0,
      },
      queueP50Ms: 1,
      queueP95Ms: 2,
      queueP99Ms: 3,
      queueMaxMs: 4,
      startupSlotWaitP50Ms: 1,
      startupSlotWaitP95Ms: 2,
      startupSlotWaitP99Ms: 3,
      startupSlotWaitMaxMs: 4,
      completed: 200,
      failed: 0,
      fairness: { starvation: false, reorderPercentage: 0, outliers: 0 },
      requested: 200,
      admitted: 200,
      started: 200,
      successful: 200,
      rejected: 0,
      incomplete: 0,
      authoritativeSandboxStartWaitSamplesExpected: 200,
      authoritativeSandboxStartWaitSamplesComplete: true,
    };
    const env = renderCapacityEnv(result);
    expect(env).toContain("SIMULATION_ADMISSION_MAX=200");
    expect(env).toContain("SANDBOX_START_SLOT_TIMEOUT_MS=30000");
  });

  it("omits admission and queue proposals for a rejected or truncated classroom", () => {
    const result = fixture();
    result.phases.classroom = {
      scenario: "classroom",
      holdDurationMs: 60_000,
      arrivalWindowMs: 5_000,
      clients: [],
      statusHistory: [],
      runtimeConfiguration: { ...result.fingerprint.effectiveCapacity, simulationAdmissionMax: 200 },
      lifecycleDockerPeak: 40,
      pollingDockerPeak: 40,
      activePeak: 40,
      queuePeak: 160,
      admissionPeak: 200,
      sandboxStartPeak: 8,
      sandboxStartWaitingPeak: 32,
      startupSlotWaitMs: [],
      startupDurationMs: [],
      queueWaitMs: [],
      hostSamples: [],
      errors: [],
      cleanup: { ...fixture().cleanup },
      queueP50Ms: 100_000,
      queueP95Ms: 120_000,
      queueP99Ms: 150_000,
      queueMaxMs: 180_000,
      startupSlotWaitP50Ms: null,
      startupSlotWaitP95Ms: null,
      startupSlotWaitP99Ms: null,
      startupSlotWaitMaxMs: null,
      requested: 200,
      admitted: 200,
      started: 40,
      successful: 40,
      rejected: 160,
      failed: 0,
      incomplete: 0,
      completed: 40,
      authoritativeSandboxStartWaitSamplesExpected: 200,
      authoritativeSandboxStartWaitSamplesComplete: false,
      fairness: { starvation: true, reorderPercentage: null, outliers: 0 },
    };
    const env = renderCapacityEnv(result);
    expect(env).toContain("SIMULATION_ADMISSION_MAX omitted");
    expect(env).toContain("SIMULATION_QUEUE_TIMEOUT_MS omitted");
    expect(env).toContain("SANDBOX_START_SLOT_TIMEOUT_MS omitted: authoritative sandbox-start semaphore samples incomplete");
    expect(env).not.toMatch(/^SIMULATION_ADMISSION_MAX=200$/m);
    expect(env).not.toMatch(/^SIMULATION_QUEUE_TIMEOUT_MS=/m);
  });

  it("writes JSON, Markdown, and env artifacts from the same result", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "unosim-calibration-report-"));
    temporaryDirectories.push(directory);
    const paths = await writeCalibrationArtifacts(fixture(), directory);
    expect(await fs.readFile(paths.jsonPath, "utf8")).toContain('"schemaVersion": 1');
    expect(await fs.readFile(paths.markdownPath, "utf8")).toContain("Capacity Calibration");
    expect(await fs.readFile(paths.envPath, "utf8")).toContain("SIMULATION_MAX_CONCURRENT=40");
  });
});
