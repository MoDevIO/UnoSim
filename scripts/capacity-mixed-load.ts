import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { countClientOutcomes, runCapacityScenario } from "./capacity-scenario-runner";
import { collectDockerProbe, collectHostProbe } from "./capacity-calibration-host";

function integerEnv(name: string, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(rank / 100 * sorted.length) - 1)];
}

function summarize(measurement: Awaited<ReturnType<typeof runCapacityScenario>>, physicalMemoryBytes: number | null) {
  const cpuSamples = measurement.hostSamples
    .map(({ cpuPercent }) => cpuPercent)
    .filter((value): value is number => value !== null);
  const availableMemorySamples = measurement.hostSamples
    .map(({ availableMemoryBytes }) => availableMemoryBytes)
    .filter((value): value is number => value !== null);
  const swapSamples = measurement.hostSamples
    .map(({ swapUsedBytes }) => swapUsedBytes)
    .filter((value): value is number => value !== null);
  const minimumAvailableMemoryBytes = availableMemorySamples.length > 0 ? Math.min(...availableMemorySamples) : null;
  const finalCompileMetrics = measurement.statusHistory.at(-1)?.compileMetrics;
  const overlapSamples = measurement.statusHistory.filter((sample) =>
    (sample.capacity?.simulation?.active ?? 0) > 0
    && ((sample.compileWorkerPool?.active ?? 0) + (sample.compileWorkerPool?.queued ?? 0)) > 0,
  ).length;
  const clients = countClientOutcomes(measurement.clients);
  const restCompiles = measurement.restCompiles;

  return {
    simulation: {
      ...clients,
      activeParallelismPeak: measurement.activePeak,
      sandboxContainerParallelismPeak: Math.max(measurement.lifecycleDockerPeak, measurement.pollingDockerPeak),
      startLatencyP50Ms: percentile(measurement.clients.flatMap((client) => client.startLatencyMs === null ? [] : [client.startLatencyMs]), 50),
      startLatencyP95Ms: percentile(measurement.clients.flatMap((client) => client.startLatencyMs === null ? [] : [client.startLatencyMs]), 95),
      queueWaitP50Ms: percentile(measurement.queueWaitMs, 50),
      queueWaitP95Ms: percentile(measurement.queueWaitMs, 95),
    },
    restCompile: restCompiles ? {
      requested: restCompiles.requested,
      completed: restCompiles.completed,
      successful: restCompiles.successful,
      failed: restCompiles.failed,
      serviceUnavailable503: restCompiles.serviceUnavailable,
      transportOrTimeoutFailures: restCompiles.results.filter((result) => result.statusCode === 0).length,
      latencyP50Ms: restCompiles.p50LatencyMs,
      latencyP95Ms: restCompiles.p95LatencyMs,
      latencyP99Ms: restCompiles.p99LatencyMs,
    } : null,
    compilerQueue: {
      peakActiveWorkers: Math.max(0, ...measurement.statusHistory.map((sample) => sample.compileWorkerPool?.active ?? 0)),
      peakQueuedTasks: Math.max(0, ...measurement.statusHistory.map((sample) => sample.compileWorkerPool?.queued ?? 0)),
      finalAverageQueueWaitMs: finalCompileMetrics?.avgQueueWaitTimeMs ?? null,
      finalMaximumQueueWaitMs: finalCompileMetrics?.maxQueueWaitTimeMs ?? null,
      samplesWithCompilerAndSimulationWork: overlapSamples,
    },
    host: {
      cpuSamples: cpuSamples.length,
      peakCpuPercent: cpuSamples.length > 0 ? Math.max(...cpuSamples) : null,
      availableMemorySamples: availableMemorySamples.length,
      minimumAvailableMemoryBytes,
      peakSwapUsedBytes: swapSamples.length > 0 ? Math.max(...swapSamples) : null,
      peakObservedUsedMemoryBytes: minimumAvailableMemoryBytes !== null && physicalMemoryBytes !== null
        ? Math.max(0, physicalMemoryBytes - minimumAvailableMemoryBytes)
        : null,
      peakObservedUsedMemoryPercent: minimumAvailableMemoryBytes !== null && physicalMemoryBytes !== null
        ? Math.max(0, Math.min(100, (physicalMemoryBytes - minimumAvailableMemoryBytes) / physicalMemoryBytes * 100))
        : null,
    },
    errors: {
      harness: measurement.errors,
      simulationFailed: clients.failed,
      simulationRejected: clients.rejected,
      simulationIncomplete: clients.incomplete,
      restCompileFailed: restCompiles?.failed ?? null,
      restCompile503: restCompiles?.serviceUnavailable ?? null,
      cleanupQuiescent: measurement.cleanup.quiescent ?? false,
    },
  };
}

async function main(): Promise<void> {
  if (process.env.CAPACITY_MIXED_TEST_ENABLED !== "1") throw new Error("CAPACITY_MIXED_TEST_ENABLED=1 is required");
  const baseUrl = process.env.CAPACITY_TEST_SERVER_URL ?? "";
  const runId = process.env.CAPACITY_TEST_RUN_ID ?? "";
  const targetLabel = process.env.CAPACITY_MIXED_TARGET_LABEL ?? "";
  const targetKind = process.env.CAPACITY_MIXED_TARGET_KIND ?? "";
  const outputPath = resolve(process.env.CAPACITY_MIXED_OUTPUT_PATH ?? "./capacity-test-results/mixed-capacity.json");
  if (!baseUrl || !runId || !targetLabel || !["production", "representative-staging"].includes(targetKind)) {
    throw new Error("Owned backend URL, run ID, target label, and target kind are required");
  }

  const clientCount = integerEnv("CAPACITY_TEST_BURST_SIZE", 1, 180);
  const holdDurationMs = integerEnv("CAPACITY_TEST_HOLD_MS", 1_000, 300_000);
  const simulationTimeoutSec = integerEnv("CAPACITY_TEST_SIMULATION_TIMEOUT_SEC", 1, 300);
  const restCompileCount = integerEnv("CAPACITY_TEST_REST_COMPILE_COUNT", 1, 128);
  const restCompileConcurrency = integerEnv("CAPACITY_TEST_REST_COMPILE_CONCURRENCY", 1, Math.min(64, restCompileCount));
  const restCompileTimeoutMs = integerEnv("CAPACITY_TEST_REST_COMPILE_TIMEOUT_MS", 1_000, 300_000);
  const profile = process.env.CAPACITY_TEST_PROFILE ?? "BASELINE";
  const reportedArduinoCliVersion = process.env.CAPACITY_MIXED_ARDUINO_CLI_VERSION ?? "";
  const reportedAvrCoreVersion = process.env.CAPACITY_MIXED_AVR_CORE_VERSION ?? "";

  const initialResponse = await fetch(`${baseUrl}/api/status`);
  if (!initialResponse.ok) throw new Error(`Owned /api/status returned HTTP ${initialResponse.status}`);
  const initialStatus = await initialResponse.json() as { serverMode?: string; capacityTestRunId?: string };
  if (initialStatus.serverMode !== "docker" || initialStatus.capacityTestRunId !== runId) {
    throw new Error("Refusing load: the backend is not the Docker-mode process owned by this run");
  }

  const hostProbe = await collectHostProbe();
  const dockerProbe = await collectDockerProbe("unosim-sandbox:latest");
  const arduinoCliVersion = execFileSync("arduino-cli", ["version"], { encoding: "utf8" }).trim();
  const avrCoreRow = execFileSync("arduino-cli", ["core", "list"], { encoding: "utf8" })
    .split(/\r?\n/)
    .find((line) => /^arduino:avr\s/.test(line.trim()));
  const avrCoreVersion = avrCoreRow?.trim().split(/\s+/)[1] ?? null;
  const startedAt = new Date().toISOString();
  const measurement = await runCapacityScenario({
    baseUrl,
    runId,
    scenario: "burst",
    clientCount,
    holdDurationMs,
    simulationTimeoutSec,
    restCompileCount,
    restCompileConcurrency,
    restCompileTimeoutMs,
  }, {
    createSessionCookie: async (url) => {
      const response = await fetch(`${url}/api/status`);
      const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
      if (!response.ok || !cookie) throw new Error(`Could not create the test session (HTTP ${response.status})`);
      return cookie;
    },
  });

  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    targetLabel,
    targetKind,
    profile,
    workload: {
      backend: "host Node process in NODE_ENV=test and UNOSIM_SERVER_MODE=docker",
      simulationStarts: clientCount,
      simulationHoldDurationMs: holdDurationMs,
      simulationTimeoutSec,
      restCompileRequests: restCompileCount,
      restCompileConcurrency,
      restCompileTimeoutMs,
      bothWorkloadsLaunchedConcurrently: true,
      dedicatedHostAcknowledgedByOperator: true,
    },
    fingerprint: {
      git: hostProbe.required,
      host: {
        platform: os.platform(),
        kernelRelease: os.release(),
        osVersion: os.version(),
        architecture: os.arch(),
        cpuModel: os.cpus()[0]?.model ?? null,
        logicalCpus: os.cpus().length,
        physicalMemoryBytes: hostProbe.optional.physicalMemoryBytes,
        loadAverage: hostProbe.optional.loadAverage,
        safetySignals: hostProbe.safetySignals,
      },
      docker: {
        clientVersion: dockerProbe.clientVersion,
        serverVersion: dockerProbe.serverVersion,
        architecture: dockerProbe.architecture,
        cpus: dockerProbe.cpus,
        memoryBytes: dockerProbe.memoryBytes,
        storageDriver: dockerProbe.storageDriver,
        image: dockerProbe.image,
      },
      toolchain: {
        arduinoCliVersion,
        avrCoreVersion,
        hostCheckMatches: reportedArduinoCliVersion === arduinoCliVersion && reportedAvrCoreVersion === avrCoreVersion,
      },
      runtimeCapacity: measurement.runtimeConfiguration,
    },
    summary: summarize(measurement, hostProbe.optional.physicalMemoryBytes),
    measurement,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Mixed capacity report: ${outputPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
  if (!measurement.cleanup.quiescent) process.exitCode = 2;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
