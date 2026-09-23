/**
 * Explicitly enabled real-Docker capacity validation.
 *
 * Run scripts/run-capacity-tests.sh so this test uses an owned backend process
 * with verified startup configuration. The regular unit suite skips it.
 */

import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import {
  assertCapacityRuntimeMatches,
  getCapacityProfile,
  type CapacityProfileKey,
} from "../../scripts/capacity-validation-config";
import { createDockerLifecycleTracker } from "../../scripts/capacity-docker-events";

type StatusSnapshot = {
  status?: string;
  serverMode?: string;
  capacityTestRunId?: string;
  webSocketSessions?: {
    active: number;
    running: number;
    paused: number;
    totalConnections: number;
    totalDisconnections: number;
  };
  processMetrics?: { cpuPercent: number; memoryPercent: number };
  capacity?: { simulation?: { maxConcurrent: number; active: number }; sandboxStart?: { maxConcurrent: number; active: number; waiting: number }; admission?: { max: number; current: number }; queue?: { waiting: number; timeoutMs: number }; compile?: { maxConcurrent: number; active: number } };
  sandboxRunners?: {
    total: number;
    available: number;
    inUse: number;
    queued: number;
    min: number;
    max: number;
  };
  admissionControl?: {
    active: number;
    max: number;
    capacityRejectedTotal: number;
    identityRejectedTotal: number;
  };
};

type ClientResult = {
  connected: boolean;
  started: boolean;
  firstOutputMs: number | null;
  startLatencyMs: number | null;
  runnerQueueWaitMs: number | null;
  runnerStartupToRunningMs: number | null;
  simulationLeaseMs: number | null;
  stopped: boolean;
  timedOut: boolean;
  disconnects: number;
  serialMessages: number;
  telemetryMessages: number;
  serialDroppedBytes: number;
  pinDroppedChanges: number;
  operationErrorCodes: string[];
  operationErrorTimesMs: number[];
  errors: string[];
};

type Scenario = "burst" | "queue-timeout";

type CapacityTestMetrics = {
  scenario: Scenario;
  profile: string;
  runtimeConfiguration: {
    serverMode: string | undefined;
    simulationMaxConcurrent: number | undefined;
    sandboxStartMaxConcurrent: number | undefined;
    admissionMax: number | undefined;
    queueTimeoutMs: number | undefined;
    compileMaxConcurrent: number | undefined;
  };
  burstSize: number;
  simulationTimeoutSec: number;
  successful: number;
  connected: number;
  started: number;
  clientTimeouts: number;
  systemBusyResponses: number;
  admissionCapacityRejections: number;
  runnerAcquireTimeouts: number;
  unexpectedErrors: number;
  disconnects: number;
  p50StartLatencyMs: number | null;
  p95StartLatencyMs: number | null;
  p99StartLatencyMs: number | null;
  avgStartLatencyMs: number;
  p50RunnerQueueWaitMs: number | null;
  p95RunnerQueueWaitMs: number | null;
  p50RunnerStartupToRunningMs: number | null;
  p95RunnerStartupToRunningMs: number | null;
  p50SimulationLeaseMs: number | null;
  p95SimulationLeaseMs: number | null;
  peakRunnersInUse: number;
  peakDockerContainers: number;
  peakDockerContainersSampled: number;
  peakDockerContainersEvents: number;
  observedDockerContainersPeak: number;
  peakRunnerQueue: number;
  peakAdmissions: number;
  peakCpuPercent: number;
  peakMemoryPercent: number;
  serialDroppedBytes: number;
  pinDroppedChanges: number;
  leakedContainers: number;
  testDurationMs: number;
  clientsDetail: ClientResult[];
  statusHistory: StatusSnapshot[];
};

const enabled = process.env.CAPACITY_TEST_ENABLED === "1";
const scenario = (process.env.CAPACITY_TEST_SCENARIO || "burst") as Scenario;
const profileKey = (process.env.CAPACITY_TEST_PROFILE || "BASELINE") as CapacityProfileKey;
const profile = getCapacityProfile(profileKey);
const outputDir = process.env.CAPACITY_TEST_OUTPUT_DIR || "./capacity-test-results";
const runId = process.env.CAPACITY_TEST_RUN_ID || "";
const baseUrl = process.env.CAPACITY_TEST_SERVER_URL || "";
const holdMs = Number.parseInt(process.env.CAPACITY_TEST_HOLD_MS || "5000", 10);
const simulationTimeoutSec = Number.parseInt(
  process.env.CAPACITY_TEST_SIMULATION_TIMEOUT_SEC || "60",
  10,
);
const burstSize = Number.parseInt(
  process.env.CAPACITY_TEST_BURST_SIZE || (scenario === "queue-timeout" ? "6" : "25"),
  10,
);

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

async function getStatus(url = `${baseUrl}/api/status`): Promise<StatusSnapshot> {
  const response = await getJson<StatusSnapshot>(url);
  if (response.statusCode !== 200) {
    throw new Error(`GET ${url} returned HTTP ${response.statusCode}`);
  }
  return response.body;
}

async function createLocalSessionCookie(): Promise<string> {
  const response = await getJson<StatusSnapshot>(`${baseUrl}/api/status`);
  if (response.statusCode !== 200) {
    throw new Error(`Could not establish local test session (HTTP ${response.statusCode})`);
  }
  const setCookie = response.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(";", 1)[0];
  if (!cookie) throw new Error("Status endpoint did not issue a local session cookie");
  return cookie;
}

function sketch(clientId: number): string {
  return `void setup() { Serial.begin(9600); Serial.println("CLIENT_${clientId}_START"); }\nvoid loop() { Serial.println("CLIENT_${clientId}_TICK"); delay(100); }`;
}

function runClient(
  clientId: number,
  holdDurationMs: number,
  timeoutSec: number,
): Promise<ClientResult> {
  return new Promise((resolve) => {
    const requestedAt = Date.now();
    const result: ClientResult = {
      connected: false,
      started: false,
      firstOutputMs: null,
      startLatencyMs: null,
      runnerQueueWaitMs: null,
      runnerStartupToRunningMs: null,
      simulationLeaseMs: null,
      stopped: false,
      timedOut: false,
      disconnects: 0,
      serialMessages: 0,
      telemetryMessages: 0,
      serialDroppedBytes: 0,
      pinDroppedChanges: 0,
      operationErrorCodes: [],
      operationErrorTimesMs: [],
      errors: [],
    };
    let ws: WebSocket | null = null;
    let finished = false;
    let queuedAt: number | null = null;
    let compileStartedAt: number | null = null;
    let runningAt: number | null = null;
    let holdTimer: NodeJS.Timeout | null = null;
    const timeoutMs = holdDurationMs + 120_000;
    const timeoutTimer = setTimeout(() => {
      result.timedOut = true;
      result.errors.push(`client watchdog expired after ${timeoutMs}ms`);
      finish();
    }, timeoutMs);

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (holdTimer) clearTimeout(holdTimer);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
      resolve(result);
    };

    void createLocalSessionCookie().then((cookie) => {
      if (finished) return;
      ws = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`, {
        headers: { cookie },
      });
      ws.on("open", () => {
        result.connected = true;
        ws?.send(JSON.stringify({
          type: "start_simulation",
          code: sketch(clientId),
          timeout: timeoutSec,
        }));
      });
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as {
            type?: string;
            status?: string;
            data?: string;
            code?: string;
            arduinoCliStatus?: string;
          };
          if (message.type === "simulation_status" && message.status === "queued") {
            queuedAt ??= Date.now();
          }
          if (message.type === "compilation_status" && compileStartedAt === null) {
            compileStartedAt = Date.now();
            if (queuedAt !== null) result.runnerQueueWaitMs = compileStartedAt - queuedAt;
          }
          if (message.type === "simulation_status" && message.status === "running" && !result.started) {
            runningAt = Date.now();
            result.started = true;
            result.startLatencyMs = runningAt - requestedAt;
            if (compileStartedAt !== null) {
              result.runnerStartupToRunningMs = runningAt - compileStartedAt;
            }
            holdTimer = setTimeout(() => {
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "stop_simulation" }));
              }
            }, holdDurationMs);
          }
          if (message.type === "operation_error") {
            result.operationErrorCodes.push(message.code ?? "unknown");
            result.operationErrorTimesMs.push(Date.now() - requestedAt);
          }
          if (message.type === "serial_output") {
            result.serialMessages++;
            result.firstOutputMs ??= Date.now() - requestedAt;
          }
          if (message.type === "sim_telemetry" || message.type === "telemetry") {
            result.telemetryMessages++;
            const metrics = (message as { metrics?: {
              serialDroppedBytesPerSecond?: number;
              droppedPinChangesPerSecond?: number;
            } }).metrics;
            result.serialDroppedBytes += metrics?.serialDroppedBytesPerSecond ?? 0;
            result.pinDroppedChanges += metrics?.droppedPinChangesPerSecond ?? 0;
          }
          if (message.type === "simulation_status" && message.status === "stopped") {
            if (result.started && runningAt !== null) {
              result.stopped = true;
              result.simulationLeaseMs = Date.now() - runningAt;
            }
            if (result.started || result.operationErrorCodes.length > 0) {
              setTimeout(finish, 100);
            }
          }
        } catch (error) {
          result.errors.push(error instanceof Error ? error.message : String(error));
        }
      });
      ws.on("close", () => {
        if (!result.stopped && result.operationErrorCodes.length === 0 && !result.timedOut) {
          result.disconnects++;
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

function dockerContainerCount(includeStopped = false): number {
  const output = execFileSync("docker", [
    "ps",
    ...(includeStopped ? ["-a"] : []),
    ...(!includeStopped ? ["--filter", "status=running"] : []),
    "--filter", `label=unosim.capacity-test-run-id=${runId}`,
    "--format", "{{.ID}}",
  ], { encoding: "utf8" });
  return output.trim().split("\n").filter(Boolean).length;
}

type DockerEventTracker = { peak: number; stop: () => Promise<void> };

function startDockerEventTracker(): DockerEventTracker {
  const child = spawn("docker", ["events", "--format", "{{json .}}", "--filter", `label=unosim.capacity-test-run-id=${runId}`], { stdio: ["ignore", "pipe", "ignore"] });
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

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percent / 100 * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? null;
}

function expectOwnedRuntime(status: StatusSnapshot): void {
  assertCapacityRuntimeMatches(profile, status);
  if (status.capacityTestRunId !== runId) {
    throw new Error(
      `Backend ownership mismatch: expected capacityTestRunId ${runId}, actual ${status.capacityTestRunId}`,
    );
  }
}

async function waitForOwnedBackendIdle(timeoutMs = 30_000): Promise<StatusSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: StatusSnapshot | null = null;
  while (Date.now() < deadline) {
    lastStatus = await getStatus();
    if (
      lastStatus.capacity?.simulation?.active === 0 &&
      lastStatus.capacity.queue?.waiting === 0 &&
      lastStatus.capacity.admission?.current === 0 &&
      dockerContainerCount(true) === 0
    ) {
      return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become idle after test: ${JSON.stringify(lastStatus)}`);
}

async function executeScenario(): Promise<CapacityTestMetrics> {
  if (!enabled) throw new Error("CAPACITY_TEST_ENABLED=1 is required");
  if (!baseUrl || !runId) throw new Error("Owned backend URL and run ID are required");
  if (!Number.isInteger(burstSize) || burstSize < 1) throw new Error("Burst size must be positive");
  if (!Number.isInteger(holdMs) || holdMs < 1) throw new Error("Hold duration must be positive");
  if (!Number.isInteger(simulationTimeoutSec) || simulationTimeoutSec < 1 || simulationTimeoutSec > 300) {
    throw new Error("Simulation timeout must be between 1 and 300 seconds");
  }
  if (scenario !== "burst" && scenario !== "queue-timeout") {
    throw new Error(`Unknown capacity test scenario: ${scenario}`);
  }

  const ready = await getJson<{ status?: string }>(`${baseUrl}/api/readiness`);
  if (ready.statusCode !== 200 || ready.body.status !== "ready") {
    throw new Error(`Owned Docker backend is not ready: HTTP ${ready.statusCode}`);
  }
  const initialStatus = await getStatus();
  expectOwnedRuntime(initialStatus);

  const statusHistory: StatusSnapshot[] = [initialStatus];
  let peakDockerContainersSampled = dockerContainerCount();
  const dockerEvents = startDockerEventTracker();
  let dockerPollActive = false;
  const statusPoller = setInterval(() => {
    void getStatus().then((status) => {
      statusHistory.push(status);
    }).catch(() => {});
  }, 250);
  const dockerPoller = setInterval(() => {
    if (dockerPollActive) return;
    dockerPollActive = true;
    try {
      peakDockerContainersSampled = Math.max(peakDockerContainersSampled, dockerContainerCount());
    } catch {
      // The runner preflights Docker and separately fails on an unavailable daemon.
    } finally {
      dockerPollActive = false;
    }
  }, 250);

  const start = Date.now();
  const clients = await Promise.all(
    Array.from({ length: burstSize }, (_, index) =>
      runClient(index + 1, holdMs, simulationTimeoutSec),
    ),
  );
  clearInterval(statusPoller);
  clearInterval(dockerPoller);
  await dockerEvents.stop();

  const finalStatus = await waitForOwnedBackendIdle();
  statusHistory.push(finalStatus);
  peakDockerContainersSampled = Math.max(peakDockerContainersSampled, dockerContainerCount());
  const peakDockerContainersEvents = dockerEvents.peak;
  const peakDockerContainers = Math.max(peakDockerContainersSampled, peakDockerContainersEvents);
  const testDurationMs = Date.now() - start;
  const expectedAdmitted = Math.min(burstSize, profile.admissionMax);
  const expectedCapacityRejections = Math.max(0, burstSize - profile.admissionMax);
  const systemBusyResponses = clients.reduce(
    (total, client) => total + client.operationErrorCodes.filter((code) => code === "SYSTEM_BUSY").length,
    0,
  );
  const admissionCapacityRejections =
    (finalStatus.admissionControl?.capacityRejectedTotal ?? 0) -
    (initialStatus.admissionControl?.capacityRejectedTotal ?? 0);
  const runnerAcquireTimeouts = systemBusyResponses - admissionCapacityRejections;
  const startLatencies = clients.flatMap((client) => client.startLatencyMs === null ? [] : [client.startLatencyMs]);
  const queueWaits = clients.flatMap((client) => client.runnerQueueWaitMs === null ? [] : [client.runnerQueueWaitMs]);
  const startupToRunning = clients.flatMap((client) => client.runnerStartupToRunningMs === null ? [] : [client.runnerStartupToRunningMs]);
  const leaseDurations = clients.flatMap((client) => client.simulationLeaseMs === null ? [] : [client.simulationLeaseMs]);
  const successful = clients.filter((client) => client.started && client.stopped && !client.timedOut).length;
  const peak = {
    runnersInUse: Math.max(...statusHistory.map((status) => status.capacity?.simulation?.active ?? status.sandboxRunners?.inUse ?? 0), 0),
    runnerQueue: Math.max(...statusHistory.map((status) => status.capacity?.queue?.waiting ?? status.sandboxRunners?.queued ?? 0), 0),
    admissions: Math.max(...statusHistory.map((status) => status.capacity?.admission?.current ?? status.admissionControl?.active ?? 0), 0),
    cpuPercent: Math.max(...statusHistory.map((status) => status.processMetrics?.cpuPercent ?? 0), 0),
    memoryPercent: Math.max(...statusHistory.map((status) => status.processMetrics?.memoryPercent ?? 0), 0),
  };
  const unexpectedErrors = clients.reduce(
    (total, client) => total + client.errors.length + client.operationErrorCodes.filter((code) => code !== "SYSTEM_BUSY").length,
    0,
  );

  const metrics: CapacityTestMetrics = {
    scenario,
    profile: profileKey,
    runtimeConfiguration: {
      serverMode: initialStatus.serverMode,
      simulationMaxConcurrent: initialStatus.capacity?.simulation?.maxConcurrent,
      sandboxStartMaxConcurrent: initialStatus.capacity?.sandboxStart?.maxConcurrent,
      admissionMax: initialStatus.capacity?.admission?.max,
      queueTimeoutMs: initialStatus.capacity?.queue?.timeoutMs,
      compileMaxConcurrent: initialStatus.capacity?.compile?.maxConcurrent,
    },
    burstSize,
    simulationTimeoutSec,
    successful,
    connected: clients.filter((client) => client.connected).length,
    started: clients.filter((client) => client.started).length,
    clientTimeouts: clients.filter((client) => client.timedOut).length,
    systemBusyResponses,
    admissionCapacityRejections,
    runnerAcquireTimeouts,
    unexpectedErrors,
    disconnects: clients.reduce((total, client) => total + client.disconnects, 0),
    p50StartLatencyMs: percentile(startLatencies, 50),
    p95StartLatencyMs: percentile(startLatencies, 95),
    p99StartLatencyMs: percentile(startLatencies, 99),
    avgStartLatencyMs: startLatencies.length > 0
      ? startLatencies.reduce((total, value) => total + value, 0) / startLatencies.length
      : 0,
    p50RunnerQueueWaitMs: percentile(queueWaits, 50),
    p95RunnerQueueWaitMs: percentile(queueWaits, 95),
    p50RunnerStartupToRunningMs: percentile(startupToRunning, 50),
    p95RunnerStartupToRunningMs: percentile(startupToRunning, 95),
    p50SimulationLeaseMs: percentile(leaseDurations, 50),
    p95SimulationLeaseMs: percentile(leaseDurations, 95),
    peakRunnersInUse: peak.runnersInUse,
    peakDockerContainers,
    peakDockerContainersSampled,
    peakDockerContainersEvents,
    observedDockerContainersPeak: peakDockerContainers,
    peakRunnerQueue: peak.runnerQueue,
    peakAdmissions: peak.admissions,
    peakCpuPercent: peak.cpuPercent,
    peakMemoryPercent: peak.memoryPercent,
    serialDroppedBytes: clients.reduce((total, client) => total + client.serialDroppedBytes, 0),
    pinDroppedChanges: clients.reduce((total, client) => total + client.pinDroppedChanges, 0),
    leakedContainers: dockerContainerCount(true),
    testDurationMs,
    clientsDetail: clients,
    statusHistory,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `capacity-${profileKey}-${scenario}-${burstSize}-${timestamp}.json`;
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(metrics, null, 2));

  console.log(
    `Capacity ${scenario} ${profileKey}/${burstSize}: ` +
    `success=${successful}/${expectedAdmitted}, ` +
    `admissionRejected=${admissionCapacityRejections}, ` +
    `runnerTimeouts=${runnerAcquireTimeouts}, ` +
    `peakRunners=${peak.runnersInUse}/${profile.simulationMaxConcurrent}, ` +
    `physicalDockerPeak=${metrics.observedDockerContainersPeak}, eventDockerPeak=${metrics.peakDockerContainersEvents}, sampledDockerPeak=${metrics.peakDockerContainersSampled}, queue=${peak.runnerQueue}, ` +
    `p50/p95/p99=${metrics.p50StartLatencyMs}/${metrics.p95StartLatencyMs}/${metrics.p99StartLatencyMs}ms, ` +
    `leaked=${metrics.leakedContainers}`,
  );
  assertCapacityRuntimeMatches(profile, initialStatus);
  expect(initialStatus.capacity?.sandboxStart?.maxConcurrent).toBeGreaterThanOrEqual(initialStatus.capacity?.simulation?.maxConcurrent ?? 0);
  expect(metrics.connected).toBe(burstSize);
  expect(metrics.clientTimeouts).toBe(0);
  expect(metrics.unexpectedErrors).toBe(0);
  expect(metrics.admissionCapacityRejections).toBe(expectedCapacityRejections);
  expect(metrics.peakRunnersInUse).toBeLessThanOrEqual(profile.simulationMaxConcurrent);
  expect(metrics.peakDockerContainers).toBeLessThanOrEqual(profile.simulationMaxConcurrent);
  expect(metrics.peakAdmissions).toBeLessThanOrEqual(profile.admissionMax);
  expect(metrics.peakRunnerQueue).toBeGreaterThanOrEqual(Math.max(0, expectedAdmitted - profile.simulationMaxConcurrent));
  expect(metrics.leakedContainers).toBe(0);

  if (scenario === "burst") {
    expect(metrics.successful).toBe(expectedAdmitted);
    expect(metrics.started).toBe(expectedAdmitted);
    expect(metrics.runnerAcquireTimeouts).toBe(0);
    expect(metrics.peakAdmissions).toBe(expectedAdmitted);
    expect(metrics.p99StartLatencyMs).toBeLessThan(60_000);
    if (
      burstSize >= profile.simulationMaxConcurrent &&
      profile.sandboxStartMaxConcurrent >= profile.simulationMaxConcurrent
    ) {
      expect(metrics.peakDockerContainersEvents).toBe(profile.simulationMaxConcurrent);
      expect(metrics.peakDockerContainers).toBe(profile.simulationMaxConcurrent);
    }
    expect(finalStatus.admissionControl?.identityRejectedTotal).toBe(
      initialStatus.admissionControl?.identityRejectedTotal,
    );
  } else {
    expect(burstSize).toBe(profile.simulationMaxConcurrent + 1);
    expect(metrics.successful).toBe(profile.simulationMaxConcurrent);
    expect(metrics.runnerAcquireTimeouts).toBe(1);
    expect(metrics.admissionCapacityRejections).toBe(0);
    const timedOutClient = clients.find((client) => client.operationErrorCodes.includes("SYSTEM_BUSY"));
    const timeoutMs = timedOutClient?.operationErrorTimesMs[0];
    expect(timeoutMs).toBeGreaterThanOrEqual(55_000);
    expect(timeoutMs).toBeLessThan(75_000);
  }

  return metrics;
}

describe.skipIf(!enabled)("Real-Docker Capacity Validation", () => {
  it(`${scenario}: profile ${profileKey}, burst ${burstSize}`, async () => {
    await executeScenario();
  }, 260_000);
});
