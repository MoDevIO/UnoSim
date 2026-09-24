import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  CALIBRATION_POLICY_VERSION,
  planActiveCandidates,
  measurementQueueTimeoutMs,
  planBracketRefinement,
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
  countClientOutcomes,
  runCapacityScenario,
  CapacityScenarioConfigurationError,
  validateScenarioRuntimeConfiguration,
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
  kind: "cpu" | "memory" | "iowait" | "oom" | "docker" | "backend" | "configuration" | "deadline" | "cleanup";
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
  requested: number;
  admitted: number;
  started: number;
  successful: number;
  rejected: number;
  incomplete: number;
  queueP50Ms: number | null;
  queueP95Ms: number | null;
  queueP99Ms: number | null;
  queueMaxMs: number | null;
  startupSlotWaitP50Ms: number | null;
  startupSlotWaitP95Ms: number | null;
  startupSlotWaitP99Ms: number | null;
  startupSlotWaitMaxMs: number | null;
  authoritativeSandboxStartWaitSamplesExpected?: number;
  authoritativeSandboxStartWaitSamplesComplete?: boolean;
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
  fingerprint: { gitSha: string; gitDirty: boolean; host: HostProbe; docker: DockerProbe; effectiveCapacity: EffectiveCapacityConfiguration; measurementQueueTimeoutMs: number };
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
  ownedContainerCount?: (runId: string, includeStopped?: boolean) => number;
};

function timestampOutputDir(): string {
  return path.join("capacity-test-results", `calibration-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`);
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
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    switch (argument) {
      case "--expected-users": values.expectedUsers = parseNumber(requireValue(argv, index, argument), "expectedUsers"); index += 2; continue;
      case "--target-cpu": values.targetCpuPercent = parseNumber(requireValue(argv, index, argument), "targetCpuPercent"); index += 2; continue;
      case "--max-cpu": values.maxCpuPercent = parseNumber(requireValue(argv, index, argument), "maxCpuPercent"); index += 2; continue;
      case "--max-user-wait": values.maxUserWaitSec = parseNumber(requireValue(argv, index, argument), "maxUserWaitSec"); index += 2; continue;
      case "--max-duration": values.maxDurationMin = parseNumber(requireValue(argv, index, argument), "maxDurationMin"); index += 2; continue;
      case "--output-dir": outputDir = requireValue(argv, index, argument); index += 2; continue;
      case "--skip-classroom": skipClassroom = true; break;
      case "--skip-startup-tuning": skipStartupTuning = true; break;
      case "--dry-run": dryRun = true; break;
      case "--verbose": verbose = true; break;
      default: throw new Error(`Unknown option: ${argument}`);
    }
    index += 1;
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
  const startupSamplesComplete = measurement.authoritativeSandboxStartWaitSamplesComplete === true;
  return {
    requested,
    stable: measurement.errors.length === 0 && measurement.cleanup.remainingCapacityContainers === 0 && startupSamplesComplete,
    startupSlotWaitP95Ms: percentile(measurement.startupSlotWaitMs, 95),
    startupSlotWaitMaxMs: maxValue(measurement.startupSlotWaitMs),
    startupDurationP95Ms: percentile(measurement.startupDurationMs, 95),
    cpuP95Percent: percentile(cpu, 95),
    iowaitP95Percent: percentile(iowait, 95),
    minAvailableMemoryBytes: minValue(memory),
    failures: failed,
    timeouts,
    startupSlotWaitSamplesComplete: startupSamplesComplete,
    startupSlotWaitSampleCount: measurement.authoritativeSandboxStartWaitSamplesMs?.length ?? measurement.startupSlotWaitMs.length,
  };
}

export function getClassroomOutcomeCounts(measurementClients: CapacityScenarioMeasurement["clients"]): {
  requested: number;
  started: number;
  successful: number;
  rejected: number;
  failed: number;
  incomplete: number;
} {
  const outcomes = countClientOutcomes(measurementClients);
  return outcomes;
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
  const outcomes = getClassroomOutcomeCounts(measurement.clients);
  const authoritativeSamples = measurement.authoritativeSandboxStartWaitSamplesMs ?? [];
  const expectedAuthoritativeSamples = measurement.clients.filter((client) => client.started || client.startupBeganAtMs !== null).length;
  const authoritativeSamplesComplete = measurement.authoritativeSandboxStartWaitSamplesComplete === true
    && authoritativeSamples.length === expectedAuthoritativeSamples
    && expectedAuthoritativeSamples > 0;
  return {
    ...measurement,
    requested: outcomes.requested,
    admitted: measurement.admissionPeak,
    started: outcomes.started,
    successful: outcomes.successful,
    rejected: outcomes.rejected,
    incomplete: outcomes.incomplete,
    queueP50Ms: percentile(measurement.queueWaitMs, 50),
    queueP95Ms: percentile(measurement.queueWaitMs, 95),
    queueP99Ms: percentile(measurement.queueWaitMs, 99),
    queueMaxMs: maxValue(measurement.queueWaitMs),
    startupSlotWaitP50Ms: percentile(measurement.startupSlotWaitMs, 50),
    startupSlotWaitP95Ms: percentile(measurement.startupSlotWaitMs, 95),
    startupSlotWaitP99Ms: percentile(measurement.startupSlotWaitMs, 99),
    startupSlotWaitMaxMs: maxValue(measurement.startupSlotWaitMs),
    authoritativeSandboxStartWaitSamplesExpected: expectedAuthoritativeSamples,
    authoritativeSandboxStartWaitSamplesComplete: authoritativeSamplesComplete,
    completed: outcomes.successful,
    failed: outcomes.failed,
    fairness: {
      starvation: outcomes.successful < measurement.clients.length,
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
      const suffix = details ? `: ${details}` : "";
      throw new Error(`Owned calibration backend exited during startup${suffix}`);
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
  const suffix = startupOutput.trim() ? `: ${startupOutput.trim()}` : "";
  throw new Error(`Owned calibration backend did not become ready${suffix}`);
}

export function effectiveCapacityForPhase(
  base: EffectiveCapacityConfiguration,
  active: number,
  startup: number,
  admission = Math.max(base.simulationAdmissionMax, active),
  simulationQueueTimeout = base.simulationQueueTimeoutMs,
): EffectiveCapacityConfiguration {
  return {
    ...base,
    simulationMaxConcurrent: active,
    sandboxStartMaxConcurrent: startup,
    simulationAdmissionMax: admission,
    simulationQueueTimeoutMs: simulationQueueTimeout,
  };
}

function configurationErrorFor(error: unknown): boolean {
  return error instanceof CapacityScenarioConfigurationError
    || (error instanceof Error && (error as Error & { code?: string }).code === "CAPACITY_SCENARIO_CONFIGURATION");
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
  const baseCapacity = currentCapacityConfiguration();
  return {
    schemaVersion: 1,
    policyVersion: CALIBRATION_POLICY_VERSION,
    policy: config,
    fingerprint: {
      gitSha: host.required.gitSha,
      gitDirty: host.required.gitDirty,
      host,
      docker,
      effectiveCapacity: baseCapacity,
      measurementQueueTimeoutMs: measurementQueueTimeoutMs(baseCapacity.simulationQueueTimeoutMs, config.maxUserWaitSec, FIXED_CLASSROOM_DURATION_SEC),
    },
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

type CalibrationPhaseContext = {
  config: CalibrationCliConfig;
  baseCapacity: EffectiveCapacityConfiguration;
  classroomQueueTimeoutMs: number;
  deadline: number;
  now: () => number;
  image: string;
  host: HostProbe;
  minimumMemory: number;
  activeCandidates: number[];
  startupCandidates: number[];
  measureControl: NonNullable<CalibrationDependencies["measureDockerControlLatency"]>;
  runScenario: (options: CapacityScenarioOptions) => Promise<CapacityScenarioMeasurement>;
  startBackend: NonNullable<CalibrationDependencies["startBackend"]>;
  countOwnedContainers: (runId: string, includeStopped?: boolean) => number;
  safetyEvents: SafetyEvent[];
  lastCleanup: CleanupResult;
};

type PhaseRunResult = {
  phases: CalibrationRunResult["phases"];
  partial: boolean;
  stopReason: string | null;
  cleanup: CleanupResult;
  startupSlotWaitP99Ms: number | null;
  startupSlotWaitMaxMs: number | null;
};

async function measureCalibrationCandidate(context: CalibrationPhaseContext, phase: SafetyEvent["phase"], active: number, startup: number, scenario: "burst" | "classroom" = "burst"): Promise<CapacityScenarioMeasurement> {
  if (context.now() >= context.deadline) throw new Error("calibration deadline reached");
  const runId = `capacity_calibration_${Date.now()}_${randomUUID()}`;
  const classroom = scenario === "classroom";
  const clientCount = classroom ? context.config.expectedUsers : active;
  const admission = classroom ? context.config.expectedUsers : Math.max(context.baseCapacity.simulationAdmissionMax, clientCount);
  const queueTimeout = classroom ? context.classroomQueueTimeoutMs : context.baseCapacity.simulationQueueTimeoutMs;
  const backend = await context.startBackend(effectiveCapacityForPhase(context.baseCapacity, active, startup, admission, queueTimeout), runId);
  let measurement: CapacityScenarioMeasurement;
  try {
    measurement = await context.runScenario({
      baseUrl: backend.baseUrl,
      runId,
      scenario,
      clientCount,
      holdDurationMs: classroom ? FIXED_CLASSROOM_DURATION_SEC * 1_000 : 25_000,
      simulationTimeoutSec: 180,
      arrivalWindowMs: classroom ? 5_000 : undefined,
      outputDir: context.config.outputDir,
      expectedSimulationMaxConcurrent: active,
      expectedSandboxStartMaxConcurrent: startup,
      requiredAdmissionMax: admission,
      expectedSimulationQueueTimeoutMs: classroom ? context.classroomQueueTimeoutMs : undefined,
    });
    validateScenarioRuntimeConfiguration({
      expectedSimulationMaxConcurrent: active,
      expectedSandboxStartMaxConcurrent: startup,
      requiredAdmissionMax: admission,
      expectedSimulationQueueTimeoutMs: classroom ? context.classroomQueueTimeoutMs : undefined,
    }, measurement.runtimeConfiguration);
  } finally {
    await backend.stop();
  }
  measurement.cleanup = { ...measurement.cleanup, remainingCapacityContainers: context.countOwnedContainers(runId, true), backendExited: true };
  context.lastCleanup = measurement.cleanup;
  context.safetyEvents.push(...safetyEventsForMeasurement(phase, measurement, context.config.maxCpuPercent, context.minimumMemory, context.now));
  return measurement;
}

function phaseError(context: CalibrationPhaseContext, phase: SafetyEvent["phase"], error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  context.safetyEvents.push({ atMs: context.now(), phase, kind: configurationErrorFor(error) ? "configuration" : "backend", message, immediate: true });
  return message;
}

async function runActiveCandidateList(
  context: CalibrationPhaseContext,
  candidates: number[],
  measurements: ActiveMeasurement[],
  allowDownwardRefinement: boolean,
): Promise<{ partial: boolean; stopReason: string | null; candidates: number[] }> {
  let partial = false;
  let stopReason: string | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (context.now() >= context.deadline) { partial = true; stopReason = "calibration deadline reached during active phase"; break; }
    const candidate = candidates[index];
    try {
      const summary = activeMeasurement(candidate, await measureCalibrationCandidate(context, "active", candidate, candidate));
      measurements.push(summary);
      if (allowDownwardRefinement && index === 0 && summary.cpuP95Percent !== null && summary.cpuP95Percent > context.config.targetCpuPercent) {
        candidates = [candidate, ...planDownwardRefinement(candidate, context.config, context.host.required.logicalCpus).filter((value) => value !== candidate)];
      }
      if (summary.cpuP95Percent !== null && summary.cpuP95Percent >= context.config.maxCpuPercent) {
        context.safetyEvents.push({ atMs: context.now(), phase: "active", kind: "cpu", message: `Active candidate ${candidate} reached the hard CPU ceiling`, immediate: false });
        if (index !== 0) break;
      }
    } catch (error) {
      partial = true;
      stopReason = phaseError(context, "active", error);
      break;
    }
  }
  return { partial, stopReason, candidates };
}

async function runActivePhase(context: CalibrationPhaseContext): Promise<{ measurements: ActiveMeasurement[]; partial: boolean; stopReason: string | null }> {
  const measurements: ActiveMeasurement[] = [];
  const coarse = await runActiveCandidateList(context, [...context.activeCandidates], measurements, true);
  let partial = coarse.partial;
  let stopReason = coarse.stopReason;
  if (!partial) {
    const refinements = planBracketRefinement(measurements, context.config, context.host.required.logicalCpus).filter((candidate) => !measurements.some((measurement) => measurement.requested === candidate));
    const refinement = await runActiveCandidateList(context, refinements, measurements, false);
    partial = refinement.partial;
    stopReason = refinement.stopReason ?? stopReason;
  }
  return { measurements, partial, stopReason };
}

async function runStartupPhase(context: CalibrationPhaseContext, selectedActive: number | null, partial: boolean): Promise<{ measurements: StartupMeasurement[]; partial: boolean; stopReason: string | null; p99: number | null; max: number | null }> {
  const measurements: StartupMeasurement[] = [];
  let p99: number | null = null;
  let max: number | null = null;
  if (context.config.skipStartupTuning || selectedActive === null || partial) return { measurements, partial, stopReason: null, p99, max };
  for (const candidate of context.startupCandidates.filter((value) => value <= selectedActive)) {
    if (context.now() >= context.deadline) return { measurements, partial: true, stopReason: "calibration deadline reached during startup phase", p99, max };
    try {
      const measurement = await measureCalibrationCandidate(context, "startup", selectedActive, candidate);
      measurements.push(startupMeasurement(candidate, measurement));
      p99 = Math.max(p99 ?? 0, percentile(measurement.startupSlotWaitMs, 99) ?? 0);
      max = Math.max(max ?? 0, maxValue(measurement.startupSlotWaitMs) ?? 0);
    } catch (error) {
      return { measurements, partial: true, stopReason: phaseError(context, "startup", error), p99, max };
    }
  }
  return { measurements, partial, stopReason: null, p99, max };
}

async function runCalibrationPhases(context: CalibrationPhaseContext): Promise<PhaseRunResult> {
  const phases: CalibrationRunResult["phases"] = { dockerControl: [], active: [], startup: [], classroom: null };
  let partial = false;
  let stopReason: string | null = null;
  if (context.now() >= context.deadline) return { phases, partial: true, stopReason: "calibration deadline reached before measurements", cleanup: context.lastCleanup, startupSlotWaitP99Ms: null, startupSlotWaitMaxMs: null };
  phases.dockerControl = await context.measureControl(context.image, Math.min(8, Math.max(2, context.host.required.logicalCpus)), 3);
  const active = await runActivePhase(context);
  phases.active = active.measurements;
  partial = active.partial;
  stopReason = active.stopReason;
  const selectedActive = selectActiveRecommendation(phases.active, context.config).value;
  const startup = await runStartupPhase(context, selectedActive, partial);
  phases.startup = startup.measurements;
  partial = startup.partial;
  stopReason = startup.stopReason ?? stopReason;
  const selectedStartup = context.config.skipStartupTuning ? null : selectStartupRecommendation(phases.startup, context.baseCapacity.sandboxStartMaxConcurrent, selectedActive ?? 1).value;
  let finalCleanup = context.lastCleanup;
  if (!context.config.skipClassroom && selectedActive !== null && selectedStartup !== null && !partial) {
    try {
      const classroom = await measureCalibrationCandidate(context, "classroom", selectedActive, selectedStartup, "classroom");
      phases.classroom = classroomMeasurement(classroom);
      finalCleanup = phases.classroom.cleanup;
    } catch (error) {
      partial = true;
      stopReason = phaseError(context, "classroom", error);
    }
  }
  return { phases, partial, stopReason, cleanup: finalCleanup, startupSlotWaitP99Ms: startup.p99, startupSlotWaitMaxMs: startup.max };
}

function buildCalibrationRecommendations(
  config: CalibrationCliConfig,
  phases: CalibrationRunResult["phases"],
  baseCapacity: EffectiveCapacityConfiguration,
  startupSlotWaitP99Ms: number | null,
  startupSlotWaitMaxMs: number | null,
): CalibrationRecommendations {
  const activeRecommendation = selectActiveRecommendation(phases.active, config);
  const startupRecommendation = config.skipStartupTuning
    ? notCalibrated<number>()
    : selectStartupRecommendation(phases.startup, baseCapacity.sandboxStartMaxConcurrent, activeRecommendation.value ?? 1);
  const controlDurations = phases.dockerControl.filter((sample) => sample.condition === "parallel").flatMap((sample) => sample.durationsMs);
  const controlRecommendation = recommendDockerControlTimeout(percentile(controlDurations, 99), DOCKER_CONTROL_DEFAULT_MS, DOCKER_CONTROL_RANGE);
  const classroomRecommendations = buildClassroomRecommendations(config, phases, startupSlotWaitP99Ms, startupSlotWaitMaxMs);
  return {
    simulationMaxConcurrent: activeRecommendation,
    sandboxStartMaxConcurrent: startupRecommendation,
    simulationAdmissionMax: classroomRecommendations.admission,
    simulationQueueTimeoutMs: classroomRecommendations.queue,
    sandboxStartSlotTimeoutMs: classroomRecommendations.slot,
    dockerControlTimeoutMs: controlRecommendation,
    compileMaxConcurrent: notCalibrated<number>(),
  };
}

function buildClassroomRecommendations(
  config: CalibrationCliConfig,
  phases: CalibrationRunResult["phases"],
  startupSlotWaitP99Ms: number | null,
  startupSlotWaitMaxMs: number | null,
): { queue: Recommendation<number>; slot: Recommendation<number>; admission: Recommendation<number> } {
  const classroom = phases.classroom;
  const complete = isClassroomComplete(classroom, config.expectedUsers);
  const queue = buildQueueRecommendation(classroom, complete, config);
  const slot = buildSlotRecommendation(classroom, phases.startup, startupSlotWaitP99Ms, startupSlotWaitMaxMs);
  const admission = buildAdmissionRecommendation(classroom, complete, config.expectedUsers);
  return { queue, slot, admission };
}

function isClassroomComplete(classroom: ClassroomMeasurement | null, expectedUsers: number): boolean {
  return classroom !== null && classroom.requested === expectedUsers && classroom.admitted >= expectedUsers
    && classroom.started === expectedUsers && classroom.successful === expectedUsers
    && classroom.rejected === 0 && classroom.failed === 0 && classroom.incomplete === 0 && classroom.errors.length === 0;
}

function buildQueueRecommendation(classroom: ClassroomMeasurement | null, complete: boolean, config: CalibrationCliConfig): Recommendation<number> {
  if (complete && classroom && classroom.queueWaitMs.length === config.expectedUsers) {
    return recommendQueueTimeout(classroom.queueP95Ms, classroom.queueP99Ms, classroom.queueMaxMs, config.maxUserWaitSec);
  }
  return {
    ...notCalibrated<number>(),
    measuredBasis: classroom ? [`classroom queue measurement incomplete (${classroom.queueWaitMs.length}/${config.expectedUsers} client waits)`] : [],
    warnings: classroom ? ["The classroom queue distribution was censored by rejection, timeout, or incomplete client phase data."] : ["Simulation queue waits were not measured."],
  };
}

function buildSlotRecommendation(classroom: ClassroomMeasurement | null, startup: StartupMeasurement[], p99: number | null, max: number | null): Recommendation<number> {
  if (classroom?.authoritativeSandboxStartWaitSamplesComplete) {
    return recommendSandboxStartSlotTimeout(classroom.startupSlotWaitP99Ms, classroom.startupSlotWaitMaxMs, SANDBOX_START_SLOT_DEFAULT_MS, SANDBOX_START_SLOT_RANGE);
  }
  if (!classroom && startup.length > 0 && startup.every((measurement) => measurement.startupSlotWaitSamplesComplete === true)) {
    return recommendSandboxStartSlotTimeout(p99, max, SANDBOX_START_SLOT_DEFAULT_MS, SANDBOX_START_SLOT_RANGE);
  }
  const expected = classroom?.authoritativeSandboxStartWaitSamplesExpected;
  return {
    ...notCalibrated<number>(),
    measuredBasis: [classroom ? `authoritative sandbox-start samples incomplete (${expected ?? 0} expected)` : "authoritative sandbox-start samples unavailable for startup candidates"],
    warnings: ["Sandbox-start-slot calibration requires complete backend semaphore samples."],
  };
}

function buildAdmissionRecommendation(classroom: ClassroomMeasurement | null, complete: boolean, expectedUsers: number): Recommendation<number> {
  const cleanup = classroom?.cleanup;
  const valid = complete && classroom !== null && classroom.runtimeConfiguration.simulationAdmissionMax >= expectedUsers
    && cleanup?.remainingCapacityContainers === 0 && cleanup.activeSimulationCount === 0 && cleanup.queueWaiting === 0
    && cleanup.admissionCurrent === 0 && cleanup.sandboxStartActive === 0 && cleanup.sandboxStartWaiting === 0;
  if (valid) return { value: expectedUsers, status: "recommended", confidence: "HIGH", measuredBasis: [`admission envelope of ${expectedUsers} users completed successfully`], warnings: [] };
  return { value: null, status: "not-calibrated", confidence: "LOW", measuredBasis: [`requested admission envelope: ${expectedUsers} users`], warnings: ["The expected-users classroom phase did not complete a successful admission validation."] };
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
  const countOwnedContainers = dependencies.ownedContainerCount ?? ownedContainerCount;
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
  const classroomQueueTimeoutMs = measurementQueueTimeoutMs(
    baseCapacity.simulationQueueTimeoutMs,
    config.maxUserWaitSec,
    FIXED_CLASSROOM_DURATION_SEC,
  );
  const activeCandidates = planActiveCandidates(config, host.required.logicalCpus);
  const startupCandidates = [...new Set([8, 12, 16, 20, 24, 32].filter((value) => value <= Math.max(activeCandidates.at(-1) ?? 1, 1)))];
  const plan = { activeCandidates, startupCandidates, classroomDurationSec: FIXED_CLASSROOM_DURATION_SEC as 60 };

  const minimumMemory = Math.max(2 * 1024 ** 3, (host.optional.physicalMemoryBytes ?? 0) * 0.1);
  let phases: CalibrationRunResult["phases"] = { dockerControl: [], active: [], startup: [], classroom: null };
  let partial = false;
  let stopReason: string | null = null;
  let cleanup = emptyCleanup();
  let startupSlotWaitP99Ms: number | null = null;
  let startupSlotWaitMaxMs: number | null = null;
  if (!config.dryRun) {
    const phaseResult = await runCalibrationPhases({
      config, baseCapacity, classroomQueueTimeoutMs, deadline, now, image, host, minimumMemory,
      activeCandidates, startupCandidates, measureControl, runScenario, startBackend, countOwnedContainers, safetyEvents,
      lastCleanup: emptyCleanup(),
    });
    phases = phaseResult.phases;
    partial = phaseResult.partial;
    stopReason = phaseResult.stopReason;
    cleanup = phaseResult.cleanup;
    startupSlotWaitP99Ms = phaseResult.startupSlotWaitP99Ms;
    startupSlotWaitMaxMs = phaseResult.startupSlotWaitMaxMs;
  }
  const recommendations = buildCalibrationRecommendations(
    config, phases, baseCapacity, startupSlotWaitP99Ms, startupSlotWaitMaxMs,
  );
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
    fingerprint: {
      gitSha: host.required.gitSha,
      gitDirty: host.required.gitDirty,
      host,
      docker,
      effectiveCapacity: baseCapacity,
      measurementQueueTimeoutMs: classroomQueueTimeoutMs,
    },
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

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const config = await parseCalibrationArgs(process.argv.slice(2));
    const result = await runCalibration(config);
    console.log(JSON.stringify(result.recommendations, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
