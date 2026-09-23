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
    },
    plan: { activeCandidates: [20, 40], startupCandidates: [8, 12], classroomDurationSec: 60 },
    phases: { dockerControl: [], active: [], startup: [], classroom: null },
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
    expect(markdown).toContain("infeasible");
    expect(markdown).toContain("No production configuration was changed");
  });

  it("emits only directly measured recommended values in the unapplied env fragment", () => {
    const env = renderCapacityEnv(fixture());
    expect(env).toContain("SIMULATION_MAX_CONCURRENT=40");
    expect(env).toContain("SANDBOX_START_MAX_CONCURRENT=20");
    expect(env).toContain("SIMULATION_ADMISSION_MAX=200");
    expect(env).toContain("SANDBOX_START_SLOT_TIMEOUT_MS=30000");
    expect(env).not.toContain("SIMULATION_QUEUE_TIMEOUT_MS=");
    expect(env).not.toContain("DOCKER_CONTROL_TIMEOUT_MS=");
    expect(env).not.toContain("COMPILE_MAX_CONCURRENT=");
    expect(env).toContain("review");
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
