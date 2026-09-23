import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  CALIBRATION_POLICY_VERSION,
  planActiveCandidates,
  planDownwardRefinement,
  recommendDockerControlTimeout,
  recommendQueueTimeout,
  recommendSandboxStartSlotTimeout,
  scoreCalibrationConfidence,
  selectActiveRecommendation,
  selectStartupRecommendation,
  validateCalibrationOptions,
  type ActiveMeasurement,
  type CalibrationOptions,
  type Recommendation,
  type StartupMeasurement,
} from "./capacity-calibration-policy";
import {
  collectDockerProbe,
  collectHostProbe,
  measureDockerControlLatency,
  type ControlLatencySample,
  type DockerProbe,
  type HostProbe,
} from "./capacity-calibration-host";
import {
  runCapacityScenario,
  type CapacityScenarioMeasurement,
  type CapacityScenarioOptions,
  type CleanupResult,
  type EffectiveCapacityConfiguration,
} from "./capacity-scenario-runner";
import { writeCalibrationArtifacts } from "./capacity-calibration-report";

const DEFAULT_IMAGE = "unosim-sandbox:latest";
const DOCKER_CONTROL_DEFAULT_MS = 2_000;
const DOCKER_CONTROL_RANGE = { min: 100, max: 30_000 };
const SANDBOX_START_SLOT_DEFAULT_MS = 30_000;
const SANDBOX_START_SLOT_RANGE = { min: 1_000, max: 900_000 };
const FIXED_CLASSROOM_DURATION_SEC = 60 as const;

export type SafetyEvent = {
  atMs: number;
  phase: "preflight" | "control" | "active" | "startup" | "classroom" | "cleanup";
  kind: "cpu" | "memory" | "iowait" | "oom" | "docker" | "backend" | "deadline" | "cleanup";
  message: string;
  immediate: boolean;
};

export type CalibrationCliConfig = CalibrationOptions & {
  outputDir: string;
  skipClassroom: boolean;
  skipStartupTuning: boolean;
  dryRun: boolean;
  verbose: boolean;
};

export type ClassroomMeasurement = CapacityScenarioMeasurement & {
  queueP50Ms: number | null;
  queueP95Ms: number | null;
  queueP99Ms: number | null;
  queueMaxMs: number | null;
  startupSlotWaitP50Ms: number | null;
  startupSlotWaitP95Ms: number | null;
  startupSlotWaitP99Ms: number | null;
  startupSlotWaitMaxMs: number | null;
  completed: number;
  failed: number;
  fairness: { starvation: boolean; reorderPercentage: number | null; outliers: number };
};

export type CalibrationRecommendations = {
  simulationMaxConcurrent: Recommendation<number>;
  sandboxStartMaxConcurrent: Recommendation<number>;
  simulationAdmissionMax: Recommendation<number>;
  simulationQueueTimeoutMs: Recommendation<number>;
  sandboxStartSlotTimeoutMs: Recommendation<number>;
  dockerControlTimeoutMs: Recommendation<number>;
  compileMaxConcurrent: Recommendation<number>;
};

export type CalibrationRunResult = {
  schemaVersion: 1;
  policyVersion: string;
  policy: CalibrationOptions;
  fingerprint: { gitSha: string; gitDirty: boolean; host: HostProbe; docker: DockerProbe; effectiveCapacity: EffectiveCapacityConfiguration };
  plan: { activeCandidates: number[]; startupCandidates: number[]; classroomDurationSec: 60 };
  phases: { dockerControl: ControlLatencySample[]; active: ActiveMeasurement[]; startup: StartupMeasurement[]; classroom: ClassroomMeasurement | null };
  recommendations: CalibrationRecommendations;
  safetyEvents: SafetyEvent[];
  partial: boolean;
  stopReason: string | null;
  cleanup: CleanupResult;
};

export type CalibrationDependencies = {
  now?: () => number;
  collectHostProbe?: () => Promise<HostProbe>;
  collectDockerProbe?: (image: string) => Promise<DockerProbe>;
  measureDockerControlLatency?: (image: string, parallelism: number, samples: number) => Promise<ControlLatencySample[]>;
  runScenario?: (options: CapacityScenarioOptions) => Promise<CapacityScenarioMeasurement>;
  startBackend?: (capacity: EffectiveCapacityConfiguration, runId: string) => Promise<{ baseUrl: string; stop: () => Promise<void> }>;
};

function timestampOutputDir(): string {
  return path.join("capacity-test-results", `calibration-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}

function parseNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export async function parseCalibrationArgs(argv: string[]): Promise<CalibrationCliConfig> {
  const values: Partial<CalibrationOptions> = {};
  let outputDir = timestampOutputDir();
  let skipClassroom = false;
  let skipStartupTuning = false;
  let dryRun = false;
  let verbose = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case "--expected-users": values.expectedUsers = parseNumber(requireValue(argv, index++, argument), "expectedUsers"); break;
      case "--target-cpu": values.targetCpuPercent = parseNumber(requireValue(argv, index++, argument), "targetCpuPercent"); break;
      case "--max-cpu": values.maxCpuPercent = parseNumber(requireValue(argv, index++, argument), "maxCpuPercent"); break;
      case "--max-user-wait": values.maxUserWaitSec = parseNumber(requireValue(argv, index++, argument), "maxUserWaitSec"); break;
      case "--max-duration": values.maxDurationMin = parseNumber(requireValue(argv, index++, argument), "maxDurationMin"); break;
      case "--output-dir": outputDir = requireValue(argv, index++, argument); break;
      case "--skip-classroom": skipClassroom = true; break;
      case "--skip-startup-tuning": skipStartupTuning = true; break;
      case "--dry-run": dryRun = true; break;
      case "--verbose": verbose = true; break;
      default: throw new Error(`Unknown option: ${argument}`);
    }
  }
  return {
    ...validateCalibrationOptions(values),
    outputDir,
    skipClassroom,
    skipStartupTuning,
    dryRun,
    verbose,
  };
}

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function currentCapacityConfiguration(): EffectiveCapacityConfiguration {
  const logicalCpus = os.cpus().length;
  return {
    simulationMaxConcurrent: integerEnv("SIMULATION_MAX_CONCURRENT", 5),
    sandboxStartMaxConcurrent: integerEnv("SANDBOX_START_MAX_CONCURRENT", 8),
    simulationAdmissionMax: integerEnv("SIMULATION_ADMISSION_MAX", 25),
    simulationQueueTimeoutMs: integerEnv("SIMULATION_QUEUE_TIMEOUT_MS", 60_000),
    sandboxStartSlotTimeoutMs: integerEnv("SANDBOX_START_SLOT_TIMEOUT_MS", SANDBOX_START_SLOT_DEFAULT_MS),
    dockerControlTimeoutMs: integerEnv("DOCKER_CONTROL_TIMEOUT_MS", DOCKER_CONTROL_DEFAULT_MS),
    compileMaxConcurrent: integerEnv("COMPILE_MAX_CONCURRENT", Math.max(1, logicalCpus - 1)),
  };
}

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percent / 100) - 1)] ?? null;
}

function minValue(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function maxValue(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function activeMeasurement(requested: number, measurement: CapacityScenarioMeasurement): ActiveMeasurement {
  const cpu = measurement.hostSamples.flatMap((sample) => sample.cpuPercent === null ? [] : [sample.cpuPercent]);
  const memory = measurement.hostSamples.flatMap((sample) => sample.availableMemoryBytes === null ? [] : [sample.availableMemoryBytes]);
  return {
    requested,
    stable: measurement.errors.length === 0 && measurement.cleanup.remainingCapacityContainers === 0,
    cpuP95Percent: percentile(cpu, 95),
    cpuMaxPercent: maxValue(cpu),
    minAvailableMemoryBytes: minValue(memory),
    lifecycleDockerPeak: measurement.lifecycleDockerPeak,
    pollingDockerPeak: measurement.pollingDockerPeak,
    errors: [...measurement.errors],
    elapsedMs: 0,
  };
}

function startupMeasurement(requested: number, measurement: CapacityScenarioMeasurement): StartupMeasurement {
  const cpu = measurement.hostSamples.flatMap((sample) => sample.cpuPercent === null ? [] : [sample.cpuPercent]);
  const iowait = measurement.hostSamples.flatMap((sample) => sample.iowaitPercent === null ? [] : [sample.iowaitPercent]);
  const memory = measurement.hostSamples.flatMap((sample) => sample.availableMemoryBytes === null ? [] : [sample.availableMemoryBytes]);
  const failed = measurement.clients.filter((client) => !client.started || client.errors.length > 0).length;
  const timeouts = measurement.clients.filter((client) => client.operationErrorCodes.some((code) => code.includes("TIMEOUT"))).length;
  return {
    requested,
    stable: measurement.errors.length === 0 && measurement.cleanup.remainingCapacityContainers === 0,
    startupSlotWaitP95Ms: percentile(measurement.startupSlotWaitMs, 95),
    startupSlotWaitMaxMs: maxValue(measurement.startupSlotWaitMs),
    startupDurationP95Ms: percentile(measurement.startupDurationMs, 95),
    cpuP95Percent: percentile(cpu, 95),
    iowaitP95Percent: percentile(iowait, 95),
    minAvailableMemoryBytes: minValue(memory),
    failures: failed,
    timeouts,
  };
}

function classroomMeasurement(measurement: CapacityScenarioMeasurement): ClassroomMeasurement {
  const starts = measurement.clients
    .filter((client) => client.runtimeStartedAtMs !== null)
    .sort((left, right) => (left.runtimeStartedAtMs ?? Infinity) - (right.runtimeStartedAtMs ?? Infinity));
  let inversions = 0;
  for (let left = 0; left < starts.length; left++) {
    for (let right = left + 1; right < starts.length; right++) {
      if (starts[left].clientId > starts[right].clientId) inversions++;
    }
  }
  const pairs = starts.length * Math.max(0, starts.length - 1) / 2;
  const completed = measurement.clients.filter((client) => client.completedAtMs !== null && client.errors.length === 0).length;
  return {
    ...measurement,
    queueP50Ms: percentile(measurement.queueWaitMs, 50),
    queueP95Ms: percentile(measurement.queueWaitMs, 95),
    queueP99Ms: percentile(measurement.queueWaitMs, 99),
    queueMaxMs: maxValue(measurement.queueWaitMs),
    startupSlotWaitP50Ms: percentile(measurement.startupSlotWaitMs, 50),
    startupSlotWaitP95Ms: percentile(measurement.startupSlotWaitMs, 95),
    startupSlotWaitP99Ms: percentile(measurement.startupSlotWaitMs, 99),
    startupSlotWaitMaxMs: maxValue(measurement.startupSlotWaitMs),
    completed,
    failed: measurement.clients.length - completed,
    fairness: {
      starvation: completed < measurement.clients.length,
      reorderPercentage: pairs > 0 ? inversions / pairs * 100 : null,
      outliers: 0,
    },
  };
}

function notCalibrated<T>(): Recommendation<T> {
  return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [], warnings: [] };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Could not allocate a loopback port")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

function ownedContainerCount(runId: string): number {
  return execFileSync("docker", ["ps", "-aq", "--filter", `label=unosim.capacity-test-run-id=${runId}`], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).length;
}

async function defaultStartBackend(capacity: EffectiveCapacityConfiguration, runId: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("./node_modules/.bin/tsx", ["server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      UNOSIM_SERVER_MODE: "docker",
      UNOSIM_DOCKER_TEST_BYPASS_GATEWAY: "1",
      DISABLE_RATE_LIMIT: "1",
      PORT: String(port),
      UNOSIM_LISTEN_HOST: "127.0.0.1",
      SIMULATION_MAX_CONCURRENT: String(capacity.simulationMaxConcurrent),
      SANDBOX_START_MAX_CONCURRENT: String(capacity.sandboxStartMaxConcurrent),
      SIMULATION_ADMISSION_MAX: String(capacity.simulationAdmissionMax),
      SIMULATION_QUEUE_TIMEOUT_MS: String(capacity.simulationQueueTimeoutMs),
      SANDBOX_START_SLOT_TIMEOUT_MS: String(capacity.sandboxStartSlotTimeoutMs),
      DOCKER_CONTROL_TIMEOUT_MS: String(capacity.dockerControlTimeoutMs),
      DOCKER_SANDBOX_IMAGE: process.env.DOCKER_SANDBOX_IMAGE ?? DEFAULT_IMAGE,
      CAPACITY_TEST_RUN_ID: runId,
      LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startupOutput = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { startupOutput += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer | string) => { startupOutput += chunk.toString(); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const details = startupOutput.trim();
      throw new Error(`Owned calibration backend exited during startup${details ? `: ${details}` : ""}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/readiness`);
      if (response.ok) {
        const body = await response.json() as { status?: string };
        if (body.status === "ready") {
          return {
            baseUrl,
            stop: async () => {
              await stopProcess(child);
              const ownedIds = execFileSync("docker", ["ps", "-aq", "--filter", `label=unosim.capacity-test-run-id=${runId}`], { encoding: "utf8" })
                .trim().split("\n").filter(Boolean);
              for (const id of ownedIds) execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
            },
          };
        }
      }
    } catch {
      // Continue polling while the server boots.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stopProcess(child);
  throw new Error(`Owned calibration backend did not become ready${startupOutput.trim() ? `: ${startupOutput.trim()}` : ""}`);
}

function effectiveCapacityForPhase(base: EffectiveCapacityConfiguration, active: number, startup: number): EffectiveCapacityConfiguration {
  return {
    ...base,
    simulationMaxConcurrent: active,
    sandboxStartMaxConcurrent: startup,
  };
}

function safetyEventsForMeasurement(
  phase: SafetyEvent["phase"],
  measurement: CapacityScenarioMeasurement,
  maxCpu: number,
  minimumMemory: number,
  now: () => number,
): SafetyEvent[] {
  const events: SafetyEvent[] = [];
  const cpu = measurement.hostSamples.flatMap((sample) => sample.cpuPercent === null ? [] : [sample.cpuPercent]);
  if (cpu.some((value) => value >= maxCpu)) {
    events.push({ atMs: now(), phase, kind: "cpu", message: `CPU reached the hard calibration ceiling (${maxCpu}%)`, immediate: false });
  }
  const memory = measurement.hostSamples.flatMap((sample) => sample.availableMemoryBytes === null ? [] : [sample.availableMemoryBytes]);
  if (memory.some((value) => value < minimumMemory)) {
    events.push({ atMs: now(), phase, kind: "memory", message: "Available memory crossed the calibration safety floor", immediate: true });
  }
  return events;
}

function emptyCleanup(): CleanupResult {
  return {
    backendExited: false,
    remainingCapacityContainers: 0,
    activeSimulationCount: null,
    queueWaiting: null,
    admissionCurrent: null,
    sandboxStartActive: null,
    sandboxStartWaiting: null,
  };
}

function unavailableHostProbe(): HostProbe {
  return {
    required: { gitSha: "unknown", gitDirty: true, nodeVersion: process.version, architecture: process.arch, logicalCpus: 0 },
    optional: { physicalMemoryBytes: null, loadAverage: null, availableMemoryBytes: null, swapUsedBytes: null, iowaitPercent: null, thermalPressure: null },
    safetySignals: { cpuAvailable: false, memoryAvailable: false },
  };
}

function unavailableDockerProbe(image: string): DockerProbe {
  return {
    clientVersion: "unknown",
    serverVersion: "unknown",
    architecture: "unknown",
    cpus: 0,
    memoryBytes: 0,
    storageDriver: "unknown",
    daemonHealthy: false,
    image: { reference: image, id: "unknown", digest: null },
    runningContainers: [],
  };
}

function failedCalibrationResult(config: CalibrationCliConfig, host: HostProbe, docker: DockerProbe, message: string): CalibrationRunResult {
  const notMeasured = notCalibrated<number>();
  return {
    schemaVersion: 1,
    policyVersion: CALIBRATION_POLICY_VERSION,
    policy: config,
    fingerprint: { gitSha: host.required.gitSha, gitDirty: host.required.gitDirty, host, docker, effectiveCapacity: currentCapacityConfiguration() },
    plan: { activeCandidates: host.required.logicalCpus > 0 ? planActiveCandidates(config, host.required.logicalCpus) : [], startupCandidates: [], classroomDurationSec: FIXED_CLASSROOM_DURATION_SEC },
    phases: { dockerControl: [], active: [], startup: [], classroom: null },
    recommendations: {
      simulationMaxConcurrent: notMeasured,
      sandboxStartMaxConcurrent: notMeasured,
      simulationAdmissionMax: notMeasured,
      simulationQueueTimeoutMs: notMeasured,
      sandboxStartSlotTimeoutMs: notMeasured,
      dockerControlTimeoutMs: notMeasured,
      compileMaxConcurrent: notMeasured,
    },
    safetyEvents: [{ atMs: Date.now(), phase: "preflight", kind: docker.daemonHealthy ? "backend" : "docker", message, immediate: true }],
    partial: true,
    stopReason: message,
    cleanup: emptyCleanup(),
  };
}

export async function runCalibration(
  config: CalibrationCliConfig,
  dependencies: CalibrationDependencies = {},
): Promise<CalibrationRunResult> {
  const now = dependencies.now ?? Date.now;
  const collectHost = dependencies.collectHostProbe ?? (() => collectHostProbe());
  const collectDocker = dependencies.collectDockerProbe ?? ((image: string) => collectDockerProbe(image));
  const measureControl = dependencies.measureDockerControlLatency ?? ((image: string, parallelism: number, samples: number) => measureDockerControlLatency(image, parallelism, samples));
  const runScenario = dependencies.runScenario ?? ((options: CapacityScenarioOptions) => runCapacityScenario(options));
  const startBackend = dependencies.startBackend ?? defaultStartBackend;
  const image = process.env.DOCKER_SANDBOX_IMAGE ?? DEFAULT_IMAGE;
  const startedAt = now();
  const deadline = startedAt + config.maxDurationMin * 60_000;
  const safetyEvents: SafetyEvent[] = [];
  console.log(`UnoSim Capacity Calibration\nPolicy: expected users=${config.expectedUsers}, target CPU=${config.targetCpuPercent}%, hard CPU=${config.maxCpuPercent}%, max wait=${config.maxUserWaitSec}s, duration=${config.maxDurationMin}min`);
  let host = unavailableHostProbe();
  let docker = unavailableDockerProbe(image);
  try {
    host = await collectHost();
    docker = await collectDocker(image);
    if (!docker.daemonHealthy) throw new Error("Docker daemon is not healthy");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeCalibrationArtifacts(failedCalibrationResult(config, host, docker, message), config.outputDir);
    throw error;
  }
  if (!host.safetySignals.cpuAvailable || !host.safetySignals.memoryAvailable) {
    if (!config.dryRun) throw new Error("Required CPU and memory safety probes are unavailable");
  }
  const baseCapacity = currentCapacityConfiguration();
  const activeCandidates = planActiveCandidates(config, host.required.logicalCpus);
  const startupCandidates = [...new Set([8, 12, 16, 20, 24, 32].filter((value) => value <= Math.max(activeCandidates.at(-1) ?? 1, 1)))];
  const plan = { activeCandidates, startupCandidates, classroomDurationSec: FIXED_CLASSROOM_DURATION_SEC as 60 };

  const phases: CalibrationRunResult["phases"] = { dockerControl: [], active: [], startup: [], classroom: null };
  let partial = false;
  let stopReason: string | null = null;
  let cleanup = emptyCleanup();
  let lastScenarioCleanup = emptyCleanup();
  let startupSlotWaitP99Ms: number | null = null;
  let startupSlotWaitMaxMs: number | null = null;
  const minimumMemory = Math.max(2 * 1024 ** 3, (host.optional.physicalMemoryBytes ?? 0) * 0.1);

  if (!config.dryRun) {
    if (now() >= deadline) { partial = true; stopReason = "calibration deadline reached before measurements"; }
    if (!partial) phases.dockerControl = await measureControl(image, Math.min(8, Math.max(2, host.required.logicalCpus)), 3);

    const measureCandidate = async (
      phase: SafetyEvent["phase"],
      active: number,
      startup: number,
      scenario: "burst" | "classroom" = "burst",
    ): Promise<CapacityScenarioMeasurement> => {
      if (now() >= deadline) throw new Error("calibration deadline reached");
      const runId = `capacity_calibration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const backend = await startBackend(effectiveCapacityForPhase(baseCapacity, active, startup), runId);
      let measurement: CapacityScenarioMeasurement;
      try {
        measurement = await runScenario({
          baseUrl: backend.baseUrl,
          runId,
          scenario,
          clientCount: scenario === "classroom" ? config.expectedUsers : active,
          holdDurationMs: phase === "classroom" ? FIXED_CLASSROOM_DURATION_SEC * 1_000 : 25_000,
          simulationTimeoutSec: 180,
          arrivalWindowMs: scenario === "classroom" ? 5_000 : undefined,
          outputDir: config.outputDir,
        });
      } finally {
        await backend.stop();
      }
      measurement.cleanup = { ...measurement.cleanup, remainingCapacityContainers: ownedContainerCount(runId), backendExited: true };
      lastScenarioCleanup = measurement.cleanup;
      safetyEvents.push(...safetyEventsForMeasurement(phase, measurement, config.maxCpuPercent, minimumMemory, now));
      return measurement;
    };

    const activeMeasurements: ActiveMeasurement[] = [];
    let activePlan = [...activeCandidates];
    for (let index = 0; index < activePlan.length; index++) {
      if (now() >= deadline) { partial = true; stopReason = "calibration deadline reached during active phase"; break; }
      const candidate = activePlan[index];
      try {
        const measurement = await measureCandidate("active", candidate, candidate);
        const summary = activeMeasurement(candidate, measurement);
        activeMeasurements.push(summary);
        if (index === 0 && summary.cpuP95Percent !== null && summary.cpuP95Percent > config.targetCpuPercent) {
          const downward = planDownwardRefinement(candidate, config, host.required.logicalCpus);
          activePlan = [candidate, ...downward.filter((value) => value !== candidate)];
        }
        if (summary.cpuP95Percent !== null && summary.cpuP95Percent >= config.maxCpuPercent) {
          safetyEvents.push({ atMs: now(), phase: "active", kind: "cpu", message: `Active candidate ${candidate} reached the hard CPU ceiling`, immediate: false });
          if (index !== 0) break;
        }
      } catch (error) {
        safetyEvents.push({ atMs: now(), phase: "active", kind: "backend", message: error instanceof Error ? error.message : String(error), immediate: true });
        partial = true;
        stopReason = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    phases.active = activeMeasurements;
    const activeRecommendation = selectActiveRecommendation(activeMeasurements, config);
    const selectedActive = activeRecommendation.value;
    const startupMeasurements: StartupMeasurement[] = [];
    if (!config.skipStartupTuning && selectedActive !== null && !partial) {
      for (const candidate of startupCandidates.filter((value) => value <= selectedActive)) {
        if (now() >= deadline) { partial = true; stopReason = "calibration deadline reached during startup phase"; break; }
        try {
          const measurement = await measureCandidate("startup", selectedActive, candidate);
          startupMeasurements.push(startupMeasurement(candidate, measurement));
          const waitValues = measurement.startupSlotWaitMs;
          startupSlotWaitP99Ms = Math.max(startupSlotWaitP99Ms ?? 0, percentile(waitValues, 99) ?? 0);
          startupSlotWaitMaxMs = Math.max(startupSlotWaitMaxMs ?? 0, maxValue(waitValues) ?? 0);
        } catch (error) {
          safetyEvents.push({ atMs: now(), phase: "startup", kind: "backend", message: error instanceof Error ? error.message : String(error), immediate: true });
          partial = true;
          stopReason = error instanceof Error ? error.message : String(error);
          break;
        }
      }
    }
    phases.startup = startupMeasurements;
    const startupRecommendation = config.skipStartupTuning
      ? notCalibrated<number>()
      : selectStartupRecommendation(startupMeasurements, baseCapacity.sandboxStartMaxConcurrent, selectedActive ?? 1);
    const selectedStartup = startupRecommendation.value;
    if (!config.skipClassroom && selectedActive !== null && selectedStartup !== null && !partial) {
      try {
        const measurement = await measureCandidate("classroom", selectedActive, selectedStartup, "classroom");
        phases.classroom = classroomMeasurement(measurement);
      } catch (error) {
        safetyEvents.push({ atMs: now(), phase: "classroom", kind: "backend", message: error instanceof Error ? error.message : String(error), immediate: true });
        partial = true;
        stopReason = error instanceof Error ? error.message : String(error);
      }
    }
    cleanup = lastScenarioCleanup;
  }

  const activeRecommendation = selectActiveRecommendation(phases.active, config);
  const startupRecommendation = config.skipStartupTuning
    ? notCalibrated<number>()
    : selectStartupRecommendation(phases.startup, baseCapacity.sandboxStartMaxConcurrent, activeRecommendation.value ?? 1);
  const controlDurations = phases.dockerControl.filter((sample) => sample.condition === "parallel").flatMap((sample) => sample.durationsMs);
  const controlRecommendation = recommendDockerControlTimeout(percentile(controlDurations, 99), DOCKER_CONTROL_DEFAULT_MS, DOCKER_CONTROL_RANGE);
  const classroom = phases.classroom;
  const queueRecommendation = classroom
    ? recommendQueueTimeout(classroom.queueP95Ms, classroom.queueP99Ms, classroom.queueMaxMs, config.maxUserWaitSec)
    : notCalibrated<number>();
  const slotRecommendation = classroom
    ? recommendSandboxStartSlotTimeout(classroom.startupSlotWaitP99Ms, classroom.startupSlotWaitMaxMs, SANDBOX_START_SLOT_DEFAULT_MS, SANDBOX_START_SLOT_RANGE)
    : recommendSandboxStartSlotTimeout(startupSlotWaitP99Ms, startupSlotWaitMaxMs, SANDBOX_START_SLOT_DEFAULT_MS, SANDBOX_START_SLOT_RANGE);
  const admissionRecommendation: Recommendation<number> = {
    value: config.expectedUsers,
    status: "recommended",
    confidence: classroom && classroom.completed === config.expectedUsers ? "HIGH" : "MEDIUM",
    measuredBasis: [`admission envelope requested at ${config.expectedUsers} users`],
    warnings: [],
  };
  const compileRecommendation = notCalibrated<number>();
  const recommendations: CalibrationRecommendations = {
    simulationMaxConcurrent: activeRecommendation,
    sandboxStartMaxConcurrent: startupRecommendation,
    simulationAdmissionMax: admissionRecommendation,
    simulationQueueTimeoutMs: queueRecommendation,
    sandboxStartSlotTimeoutMs: slotRecommendation,
    dockerControlTimeoutMs: controlRecommendation,
    compileMaxConcurrent: compileRecommendation,
  };
  const confidence = scoreCalibrationConfidence(
    phases.active.length + phases.startup.length + (phases.classroom ? 1 : 0),
    !partial,
    safetyEvents.length,
  );
  if (config.verbose) console.log(`Calibration complete: confidence=${confidence}, partial=${partial}`);
  const result: CalibrationRunResult = {
    schemaVersion: 1,
    policyVersion: CALIBRATION_POLICY_VERSION,
    policy: config,
    fingerprint: { gitSha: host.required.gitSha, gitDirty: host.required.gitDirty, host, docker, effectiveCapacity: baseCapacity },
    plan,
    phases,
    recommendations,
    safetyEvents,
    partial,
    stopReason,
    cleanup,
  };
  await writeCalibrationArtifacts(result, config.outputDir);
  return result;
}

async function main(): Promise<void> {
  try {
    const config = await parseCalibrationArgs(process.argv.slice(2));
    const result = await runCalibration(config);
    console.log(JSON.stringify(result.recommendations, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
