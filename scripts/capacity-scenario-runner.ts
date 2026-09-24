import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import { createDockerLifecycleTracker } from "./capacity-docker-events";

const execFileAsync = promisify(execFile);

export type ScenarioKind = "burst" | "classroom";

export type CapacityScenarioOptions = {
  baseUrl: string;
  runId: string;
  scenario: ScenarioKind;
  clientCount: number;
  holdDurationMs: number;
  simulationTimeoutSec: number;
  arrivalWindowMs?: number;
  outputDir?: string;
  expectedSimulationMaxConcurrent?: number;
  expectedSandboxStartMaxConcurrent?: number;
  requiredAdmissionMax?: number;
};

export type ClientResult = {
  clientId: number;
  connected: boolean;
  started: boolean;
  requestedAtMs: number;
  admittedAtMs: number | null;
  queueEnteredAtMs: number | null;
  simulationSlotAcquiredAtMs: number | null;
  startupSlotWaitBeganAtMs: number | null;
  startupSlotAcquiredAtMs: number | null;
  startupBeganAtMs: number | null;
  runtimeStartedAtMs: number | null;
  completedAtMs: number | null;
  disconnectedAtMs: number | null;
  startLatencyMs: number | null;
  queueWaitMs: number | null;
  startupSlotWaitMs: number | null;
  startupDurationMs: number | null;
  runtimeDurationMs: number | null;
  operationErrorCodes: string[];
  errors: string[];
};

export type StatusSnapshot = {
  status?: string;
  serverMode?: string;
  capacityTestRunId?: string;
  capacity?: {
    simulation?: { maxConcurrent: number; active: number };
    sandboxStart?: { maxConcurrent: number; active: number; waiting: number; slotTimeoutMs: number };
    admission?: { max: number; current: number };
    queue?: { waiting: number; timeoutMs: number };
    compile?: { maxConcurrent: number; active: number };
  };
};

export type EffectiveCapacityConfiguration = {
  simulationMaxConcurrent: number;
  sandboxStartMaxConcurrent: number;
  simulationAdmissionMax: number;
  simulationQueueTimeoutMs: number;
  sandboxStartSlotTimeoutMs: number;
  dockerControlTimeoutMs: number;
  compileMaxConcurrent: number;
};

export class CapacityScenarioConfigurationError extends Error {
  readonly code = "CAPACITY_SCENARIO_CONFIGURATION" as const;

  constructor(
    readonly requirements: {
      simulationMaxConcurrent?: number;
      sandboxStartMaxConcurrent?: number;
      admissionMax?: number;
    },
    readonly actual: EffectiveCapacityConfiguration,
  ) {
    const mismatches: string[] = [];
    if (requirements.simulationMaxConcurrent !== undefined
      && actual.simulationMaxConcurrent !== requirements.simulationMaxConcurrent) {
      mismatches.push(`simulation max ${actual.simulationMaxConcurrent} (expected ${requirements.simulationMaxConcurrent})`);
    }
    if (requirements.sandboxStartMaxConcurrent !== undefined
      && actual.sandboxStartMaxConcurrent !== requirements.sandboxStartMaxConcurrent) {
      mismatches.push(`sandbox-start max ${actual.sandboxStartMaxConcurrent} (expected ${requirements.sandboxStartMaxConcurrent})`);
    }
    if (requirements.admissionMax !== undefined && actual.simulationAdmissionMax < requirements.admissionMax) {
      mismatches.push(`admission max ${actual.simulationAdmissionMax} (required at least ${requirements.admissionMax})`);
    }
    super(`Runtime Capacity configuration cannot represent the requested scenario: ${mismatches.join(", ") || "unknown mismatch"}`);
    this.name = "CapacityScenarioConfigurationError";
  }
}

export type HostSample = {
  atMs: number;
  cpuPercent: number | null;
  loadAverage: number | null;
  availableMemoryBytes: number | null;
  swapUsedBytes: number | null;
  iowaitPercent: number | null;
  runningDockerContainers: number;
  capacityDockerContainers: number;
};

export type CleanupResult = {
  backendExited: boolean;
  remainingCapacityContainers: number;
  activeSimulationCount: number | null;
  queueWaiting: number | null;
  admissionCurrent: number | null;
  sandboxStartActive: number | null;
  sandboxStartWaiting: number | null;
};

export type ScenarioRunnerDependencies = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  getStatus?: (baseUrl: string) => Promise<StatusSnapshot>;
  createSessionCookie?: (baseUrl: string) => Promise<string>;
  dockerContainerCount?: (runId: string, includeStopped?: boolean) => number;
  sampleHost?: () => Promise<HostSample>;
};

export type CapacityScenarioMeasurement = {
  scenario: ScenarioKind;
  holdDurationMs: number;
  arrivalWindowMs: number;
  clients: ClientResult[];
  statusHistory: StatusSnapshot[];
  runtimeConfiguration: EffectiveCapacityConfiguration;
  lifecycleDockerPeak: number;
  pollingDockerPeak: number;
  activePeak: number;
  queuePeak: number;
  admissionPeak: number;
  sandboxStartPeak: number;
  sandboxStartWaitingPeak: number;
  startupSlotWaitMs: number[];
  startupDurationMs: number[];
  queueWaitMs: number[];
  hostSamples: HostSample[];
  errors: string[];
  cleanup: CleanupResult;
};

type ScenarioSummaryInput = Omit<CapacityScenarioMeasurement,
  "activePeak" | "queuePeak" | "admissionPeak" | "sandboxStartPeak" |
  "sandboxStartWaitingPeak" | "startupSlotWaitMs" | "startupDurationMs" | "queueWaitMs">;

export function summarizeCapacityScenario(input: ScenarioSummaryInput): CapacityScenarioMeasurement {
  const activePeak = Math.max(
    ...input.statusHistory.map((status) => status.capacity?.simulation?.active ?? 0),
    0,
  );
  const queuePeak = Math.max(
    ...input.statusHistory.map((status) => status.capacity?.queue?.waiting ?? 0),
    0,
  );
  const admissionPeak = Math.max(
    ...input.statusHistory.map((status) => status.capacity?.admission?.current ?? 0),
    0,
  );
  const sandboxStartPeak = Math.max(
    ...input.statusHistory.map((status) => status.capacity?.sandboxStart?.active ?? 0),
    0,
  );
  const sandboxStartWaitingPeak = Math.max(
    ...input.statusHistory.map((status) => status.capacity?.sandboxStart?.waiting ?? 0),
    0,
  );

  return {
    ...input,
    activePeak,
    queuePeak,
    admissionPeak,
    sandboxStartPeak,
    sandboxStartWaitingPeak,
    startupSlotWaitMs: input.clients.flatMap((client) => client.startupSlotWaitMs === null ? [] : [client.startupSlotWaitMs]),
    startupDurationMs: input.clients.flatMap((client) => client.startupDurationMs === null ? [] : [client.startupDurationMs]),
    queueWaitMs: input.clients.flatMap((client) => client.queueWaitMs === null ? [] : [client.queueWaitMs]),
  };
}

function getJson<T>(url: string): Promise<{ statusCode: number; body: T; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.get(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(body) as T,
              headers: response.headers,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
  });
}

function sketch(clientId: number): string {
  return `void setup() { Serial.begin(9600); Serial.println("CLIENT_${clientId}_START"); }\nvoid loop() { Serial.println("CLIENT_${clientId}_TICK"); delay(100); }`;
}

function defaultDockerContainerCount(runId: string, includeStopped = false): number {
  const output = execFileSync("docker", [
    "ps",
    ...(includeStopped ? ["-a"] : []),
    ...(!includeStopped ? ["--filter", "status=running"] : []),
    "--filter", `label=unosim.capacity-test-run-id=${runId}`,
    "--format", "{{.ID}}",
  ], { encoding: "utf8" });
  return output.trim().split("\n").filter(Boolean).length;
}

function defaultStatus(baseUrl: string): Promise<StatusSnapshot> {
  return getJson<StatusSnapshot>(`${baseUrl}/api/status`).then((response) => {
    if (response.statusCode !== 200) throw new Error(`GET /api/status returned HTTP ${response.statusCode}`);
    return response.body;
  });
}

async function defaultSessionCookie(baseUrl: string): Promise<string> {
  const response = await getJson<StatusSnapshot>(`${baseUrl}/api/status`);
  if (response.statusCode !== 200) throw new Error(`Could not establish local test session (HTTP ${response.statusCode})`);
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(";", 1)[0];
  if (!cookie) throw new Error("Status endpoint did not issue a local session cookie");
  return cookie;
}

type DockerEventTracker = { readonly peak: number; stop: () => Promise<void> };

function startDockerEventTracker(runId: string): DockerEventTracker {
  const child = spawn(
    "docker",
    ["events", "--format", "{{json .}}", "--filter", `label=unosim.capacity-test-run-id=${runId}`],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  if (!child.stdout) throw new Error("Docker events did not provide stdout");
  const tracker = createDockerLifecycleTracker(runId);
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) tracker.consume(line);
  });
  return {
    get peak() { return tracker.peak; },
    stop: () => new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(); }, 1_000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    }),
  };
}

function emptyClient(clientId: number, now: number): ClientResult {
  return {
    clientId,
    connected: false,
    started: false,
    requestedAtMs: now,
    admittedAtMs: null,
    queueEnteredAtMs: null,
    simulationSlotAcquiredAtMs: null,
    startupSlotWaitBeganAtMs: null,
    startupSlotAcquiredAtMs: null,
    startupBeganAtMs: null,
    runtimeStartedAtMs: null,
    completedAtMs: null,
    disconnectedAtMs: null,
    startLatencyMs: null,
    queueWaitMs: null,
    startupSlotWaitMs: null,
    startupDurationMs: null,
    runtimeDurationMs: null,
    operationErrorCodes: [],
    errors: [],
  };
}

function runClient(
  baseUrl: string,
  clientId: number,
  holdDurationMs: number,
  timeoutSec: number,
  now: () => number,
  createSessionCookie: (baseUrl: string) => Promise<string>,
): Promise<ClientResult> {
  return new Promise((resolve) => {
    const requestedAt = now();
    const result = emptyClient(clientId, requestedAt);
    let ws: WebSocket | null = null;
    let finished = false;
    let holdTimer: NodeJS.Timeout | null = null;
    const timeoutMs = Math.max(holdDurationMs + 120_000, timeoutSec * 1_000 + 120_000);
    const timeoutTimer = setTimeout(() => {
      result.errors.push(`client watchdog expired after ${timeoutMs}ms`);
      finish();
    }, timeoutMs);

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (holdTimer) clearTimeout(holdTimer);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
      result.disconnectedAtMs ??= now();
      resolve(result);
    };

    void createSessionCookie(baseUrl).then((cookie) => {
      if (finished) return;
      ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, { headers: { cookie } });
      ws.on("open", () => {
        result.connected = true;
        result.admittedAtMs ??= now();
        ws?.send(JSON.stringify({ type: "start_simulation", code: sketch(clientId), timeout: timeoutSec }));
      });
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as {
            type?: string;
            status?: string;
            code?: string;
            arduinoCliStatus?: string;
          };
          const at = now();
          if (message.type === "simulation_status" && message.status === "queued") {
            result.queueEnteredAtMs ??= at;
            result.startupSlotWaitBeganAtMs ??= at;
          }
          if (message.type === "compilation_status") {
            result.simulationSlotAcquiredAtMs ??= at;
            result.startupSlotAcquiredAtMs ??= at;
            result.startupBeganAtMs ??= at;
            if (result.queueEnteredAtMs !== null) {
              result.queueWaitMs ??= at - result.queueEnteredAtMs;
            }
            if (result.startupSlotWaitBeganAtMs !== null) {
              result.startupSlotWaitMs ??= at - result.startupSlotWaitBeganAtMs;
            }
            if (message.arduinoCliStatus === "error") {
              result.errors.push("sandbox compilation failed");
            }
          }
          if (message.type === "simulation_status" && message.status === "running" && !result.started) {
            result.runtimeStartedAtMs = at;
            result.started = true;
            result.startLatencyMs = at - requestedAt;
            if (result.queueWaitMs === null && result.queueEnteredAtMs !== null && result.simulationSlotAcquiredAtMs !== null) {
              result.queueWaitMs = result.simulationSlotAcquiredAtMs - result.queueEnteredAtMs;
            }
            if (result.startupSlotWaitMs === null && result.startupSlotWaitBeganAtMs !== null && result.startupSlotAcquiredAtMs !== null) {
              result.startupSlotWaitMs = result.startupSlotAcquiredAtMs - result.startupSlotWaitBeganAtMs;
            }
            if (result.startupBeganAtMs !== null) result.startupDurationMs = at - result.startupBeganAtMs;
            holdTimer = setTimeout(() => {
              if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop_simulation" }));
            }, holdDurationMs);
          }
          if (message.type === "operation_error") {
            result.operationErrorCodes.push(message.code ?? "unknown");
            if (message.code !== "SYSTEM_BUSY") result.errors.push(message.code ?? "unknown operation error");
          }
          if (
            message.type === "simulation_status" &&
            message.status === "stopped" &&
            (result.started || result.operationErrorCodes.length > 0 || result.startupBeganAtMs !== null)
          ) {
            result.completedAtMs ??= at;
            if (result.runtimeStartedAtMs !== null) result.runtimeDurationMs = at - result.runtimeStartedAtMs;
            setTimeout(finish, 50);
          }
        } catch (error) {
          result.errors.push(error instanceof Error ? error.message : String(error));
        }
      });
      ws.on("close", () => {
        if (result.completedAtMs === null && result.operationErrorCodes.length === 0 && result.errors.length === 0) {
          result.errors.push("WebSocket closed before completion");
        }
        finish();
      });
      ws.on("error", (error) => {
        result.errors.push(error.message);
        finish();
      });
    }).catch((error: unknown) => {
      result.errors.push(error instanceof Error ? error.message : String(error));
      finish();
    });
  });
}

function runtimeConfiguration(status: StatusSnapshot): EffectiveCapacityConfiguration {
  return {
    simulationMaxConcurrent: status.capacity?.simulation?.maxConcurrent ?? 0,
    sandboxStartMaxConcurrent: status.capacity?.sandboxStart?.maxConcurrent ?? 0,
    simulationAdmissionMax: status.capacity?.admission?.max ?? 0,
    simulationQueueTimeoutMs: status.capacity?.queue?.timeoutMs ?? 0,
    sandboxStartSlotTimeoutMs: status.capacity?.sandboxStart?.slotTimeoutMs ?? 0,
    dockerControlTimeoutMs: 0,
    compileMaxConcurrent: status.capacity?.compile?.maxConcurrent ?? 0,
  };
}

export function validateScenarioRuntimeConfiguration(
  options: Pick<CapacityScenarioOptions, "expectedSimulationMaxConcurrent" | "expectedSandboxStartMaxConcurrent" | "requiredAdmissionMax">,
  actual: EffectiveCapacityConfiguration,
): void {
  const requirements = {
    simulationMaxConcurrent: options.expectedSimulationMaxConcurrent,
    sandboxStartMaxConcurrent: options.expectedSandboxStartMaxConcurrent,
    admissionMax: options.requiredAdmissionMax,
  };
  const hasMismatch = (
    (requirements.simulationMaxConcurrent !== undefined
      && actual.simulationMaxConcurrent !== requirements.simulationMaxConcurrent)
    || (requirements.sandboxStartMaxConcurrent !== undefined
      && actual.sandboxStartMaxConcurrent !== requirements.sandboxStartMaxConcurrent)
    || (requirements.admissionMax !== undefined && actual.simulationAdmissionMax < requirements.admissionMax)
  );
  if (hasMismatch) throw new CapacityScenarioConfigurationError(requirements, actual);
}

function createDefaultHostSampler(): () => Promise<HostSample> {
  let previousLinuxCounters: { total: number; idle: number; iowait: number } | null = null;
  return async () => {
    let cpuPercent: number | null = null;
    let iowaitPercent: number | null = null;
    if (process.platform === "darwin") {
      try {
        const { stdout } = await execFileAsync("ps", ["-A", "-o", "%cpu="], { encoding: "utf8" });
        const sum = stdout.split("\n").map((value) => Number(value.trim())).filter(Number.isFinite).reduce((total, value) => total + value, 0);
        cpuPercent = Math.min(100, sum / Math.max(1, os.cpus().length));
      } catch {
        cpuPercent = null;
      }
    } else {
      try {
        const stat = await fs.promises.readFile("/proc/stat", "utf8");
        const fields = stat.split("\n").find((line) => line.startsWith("cpu "))?.trim().split(/\s+/).slice(1).map(Number) ?? [];
        const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields;
        const total = user + nice + system + idle + iowait + irq + softirq + steal;
        const idleAll = idle + iowait;
        if (previousLinuxCounters) {
          const totalDelta = total - previousLinuxCounters.total;
          const idleDelta = idleAll - previousLinuxCounters.idle;
          const iowaitDelta = iowait - previousLinuxCounters.iowait;
          if (totalDelta > 0) {
            cpuPercent = Math.max(0, Math.min(100, (totalDelta - idleDelta) / totalDelta * 100));
            iowaitPercent = Math.max(0, Math.min(100, iowaitDelta / totalDelta * 100));
          }
        }
        previousLinuxCounters = { total, idle: idleAll, iowait };
      } catch {
        cpuPercent = null;
      }
    }
    return {
      atMs: Date.now(),
      cpuPercent,
      loadAverage: os.loadavg()[0] ?? null,
      availableMemoryBytes: os.freemem(),
      swapUsedBytes: null,
      iowaitPercent,
      runningDockerContainers: 0,
      capacityDockerContainers: 0,
    };
  };
}

export async function runCapacityScenario(
  options: CapacityScenarioOptions,
  dependencies: ScenarioRunnerDependencies = {},
): Promise<CapacityScenarioMeasurement> {
  if (!options.baseUrl || !options.runId) throw new Error("Owned backend URL and run ID are required");
  if (!Number.isInteger(options.clientCount) || options.clientCount < 1) throw new Error("clientCount must be positive");
  if (!Number.isInteger(options.holdDurationMs) || options.holdDurationMs < 1) throw new Error("holdDurationMs must be positive");
  if (!Number.isInteger(options.simulationTimeoutSec) || options.simulationTimeoutSec < 1 || options.simulationTimeoutSec > 300) {
    throw new Error("simulationTimeoutSec must be between 1 and 300 seconds");
  }
  if (options.scenario === "classroom" && (!Number.isInteger(options.arrivalWindowMs) || (options.arrivalWindowMs ?? 0) < 0)) {
    throw new Error("classroom scenarios require a non-negative integer arrivalWindowMs");
  }

  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const getStatus = dependencies.getStatus ?? defaultStatus;
  const createSessionCookie = dependencies.createSessionCookie ?? defaultSessionCookie;
  const countContainers = dependencies.dockerContainerCount ?? defaultDockerContainerCount;
  const sampleHost = dependencies.sampleHost ?? createDefaultHostSampler();
  const initialStatus = await getStatus(options.baseUrl);
  const initialRuntimeConfiguration = runtimeConfiguration(initialStatus);
  validateScenarioRuntimeConfiguration(options, initialRuntimeConfiguration);
  const statusHistory: StatusSnapshot[] = [initialStatus];
  const hostSamples: HostSample[] = [];
  const errors: string[] = [];
  const eventTracker = startDockerEventTracker(options.runId);
  let pollingPeak = countContainers(options.runId);
  let pollInFlight = false;
  const statusPoller = setInterval(() => {
    void getStatus(options.baseUrl).then((status) => statusHistory.push(status)).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    });
  }, 250);
  const hostPoller = setInterval(() => {
    void sampleHost().then((sample) => {
      let enriched = sample;
      try {
        enriched = { ...sample, capacityDockerContainers: countContainers(options.runId) };
        pollingPeak = Math.max(pollingPeak, enriched.capacityDockerContainers);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      hostSamples.push(enriched);
    }).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
    });
  }, 1_000);
  const dockerPoller = setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;
    try { pollingPeak = Math.max(pollingPeak, countContainers(options.runId)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    finally { pollInFlight = false; }
  }, 250);

  try {
    const arrivalWindowMs = options.scenario === "classroom" ? options.arrivalWindowMs ?? 0 : 0;
    const intervalMs = options.clientCount > 1 ? arrivalWindowMs / (options.clientCount - 1) : 0;
    const clients = await Promise.all(Array.from({ length: options.clientCount }, (_, index) => (async () => {
      if (index > 0 && intervalMs > 0) await sleep(intervalMs);
      return runClient(options.baseUrl, index + 1, options.holdDurationMs, options.simulationTimeoutSec, now, createSessionCookie);
    })()));
    await eventTracker.stop();
    clearInterval(statusPoller);
    clearInterval(dockerPoller);
    if (hostPoller) clearInterval(hostPoller);
    const finalStatus = await getStatus(options.baseUrl);
    statusHistory.push(finalStatus);
    pollingPeak = Math.max(pollingPeak, countContainers(options.runId));
    const cleanup: CleanupResult = {
      backendExited: false,
      remainingCapacityContainers: countContainers(options.runId, true),
      activeSimulationCount: finalStatus.capacity?.simulation?.active ?? null,
      queueWaiting: finalStatus.capacity?.queue?.waiting ?? null,
      admissionCurrent: finalStatus.capacity?.admission?.current ?? null,
      sandboxStartActive: finalStatus.capacity?.sandboxStart?.active ?? null,
      sandboxStartWaiting: finalStatus.capacity?.sandboxStart?.waiting ?? null,
    };
    if (cleanup.remainingCapacityContainers > 0) errors.push("capacity containers remain after scenario");
    const measurement = summarizeCapacityScenario({
      scenario: options.scenario,
      holdDurationMs: options.holdDurationMs,
      arrivalWindowMs,
      clients,
      statusHistory,
      runtimeConfiguration: runtimeConfiguration(initialStatus),
      lifecycleDockerPeak: eventTracker.peak,
      pollingDockerPeak: pollingPeak,
      hostSamples,
      errors,
      cleanup,
    });
    if (options.outputDir) {
      fs.mkdirSync(options.outputDir, { recursive: true });
      fs.writeFileSync(path.join(options.outputDir, `scenario-${options.scenario}-${options.clientCount}.json`), JSON.stringify(measurement, null, 2));
    }
    return measurement;
  } catch (error) {
    clearInterval(statusPoller);
    clearInterval(dockerPoller);
    if (hostPoller) clearInterval(hostPoller);
    await eventTracker.stop();
    throw error;
  }
}
