import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import type { ServerToClientWSMessage } from "@shared/schema";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";
import { webSocketMetricsTracker } from "../../../server/services/server-metrics";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe("simulation startup readiness", () => {
  let server: Server | undefined;
  let client: WebSocket | undefined;

  beforeEach(() => webSocketMetricsTracker.reset());

  afterEach(async () => {
    if (client && client.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        client!.once("close", () => resolve());
        client!.close();
      });
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("does not publish running before the runner reports process readiness", async () => {
    const runSketchReady = deferred<boolean>();
    const messages: ServerToClientWSMessage[] = [];
    const runner = {
      pause: vi.fn(() => true),
      resume: vi.fn(() => true),
      sendSerialInput: vi.fn(),
      setPinValue: vi.fn(),
      runSketch: vi.fn(() => runSketchReady.promise),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      acquireRunner: vi.fn().mockResolvedValue(runner),
      releaseRunner: vi.fn().mockResolvedValue(undefined),
      getRunnerIndex: vi.fn(() => 0),
      getStats: vi.fn(() => ({
        availableRunners: 1,
        totalRunners: 1,
        maxRunners: 1,
        queuedRequests: 0,
      })),
    };

    server = createServer();
    registerSimulationWebSocket(server, {
      SandboxRunner: class {} as typeof SandboxRunner,
      getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
      shouldSendSimulationEndMessage: () => true,
      getLastCompiledCode: () => null,
      logger: logger(),
      runnerPool: pool as unknown as SandboxRunnerPool,
      trust: { mode: "local" },
      allowedWebSocketOrigins: [],
      disableRateLimit: true,
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage);
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("open", resolve);
      client!.once("error", reject);
    });

    client.send(JSON.stringify({
      type: "start_simulation",
      code: "void setup() {} void loop() {}",
    }));
    await waitFor(() => runner.runSketch.mock.calls.length === 1, "runSketch invocation");

    expect(messages).not.toContainEqual({
      type: "simulation_status",
      status: "running",
    });

    runSketchReady.resolve(true);
    await waitFor(
      () => messages.filter(
        (message) => message.type === "simulation_status" && message.status === "running",
      ).length === 1,
      "the ready running state",
    );

    expect(webSocketMetricsTracker.getMetrics().runningSessions).toBe(1);

    client.send(JSON.stringify({ type: "serial_input", data: "immediate input" }));
    await waitFor(() => runner.sendSerialInput.mock.calls.length === 1, "serial input forwarding");
    expect(runner.sendSerialInput).toHaveBeenCalledWith("immediate input");
  });

  it("does not publish running when the runner reports a failed start", async () => {
    const runSketchReady = deferred<boolean>();
    const messages: ServerToClientWSMessage[] = [];
    const runner = {
      pause: vi.fn(() => true),
      resume: vi.fn(() => true),
      sendSerialInput: vi.fn(),
      setPinValue: vi.fn(),
      runSketch: vi.fn(() => runSketchReady.promise),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      acquireRunner: vi.fn().mockResolvedValue(runner),
      releaseRunner: vi.fn().mockResolvedValue(undefined),
      getRunnerIndex: vi.fn(() => 0),
      getStats: vi.fn(() => ({
        availableRunners: 1,
        totalRunners: 1,
        maxRunners: 1,
        queuedRequests: 0,
      })),
    };

    server = createServer();
    registerSimulationWebSocket(server, {
      SandboxRunner: class {} as typeof SandboxRunner,
      getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
      shouldSendSimulationEndMessage: () => true,
      getLastCompiledCode: () => null,
      logger: logger(),
      runnerPool: pool as unknown as SandboxRunnerPool,
      trust: { mode: "local" },
      allowedWebSocketOrigins: [],
      disableRateLimit: true,
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage);
    });
    await new Promise<void>((resolve, reject) => {
      client!.once("open", resolve);
      client!.once("error", reject);
    });

    client.send(JSON.stringify({
      type: "start_simulation",
      code: "void setup() {} void loop() {}",
    }));
    await waitFor(() => runner.runSketch.mock.calls.length === 1, "runSketch invocation");
    runSketchReady.resolve(false);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(messages).not.toContainEqual({
      type: "simulation_status",
      status: "running",
    });
    expect(webSocketMetricsTracker.getMetrics().runningSessions).toBe(0);
  });

  it("does not count a session when runSketch rejects", async () => {
    const messages: ServerToClientWSMessage[] = [];
    const runner = {
      pause: vi.fn(() => true), resume: vi.fn(() => true), sendSerialInput: vi.fn(),
      setPinValue: vi.fn(), runSketch: vi.fn().mockRejectedValue(new Error("start failed")),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      acquireRunner: vi.fn().mockResolvedValue(runner), releaseRunner: vi.fn().mockResolvedValue(undefined),
      getRunnerIndex: vi.fn(() => 0), getStats: vi.fn(() => ({ availableRunners: 1, totalRunners: 1, maxRunners: 1, queuedRequests: 0 })),
    };
    server = createServer();
    registerSimulationWebSocket(server, {
      SandboxRunner: class {} as typeof SandboxRunner,
      getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
      shouldSendSimulationEndMessage: () => true, getLastCompiledCode: () => null, logger: logger(),
      runnerPool: pool as unknown as SandboxRunnerPool, trust: { mode: "local" },
      allowedWebSocketOrigins: [], disableRateLimit: true,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage));
    await new Promise<void>((resolve, reject) => { client!.once("open", resolve); client!.once("error", reject); });
    client.send(JSON.stringify({ type: "start_simulation", code: "void setup() {} void loop() {}" }));
    await waitFor(() => runner.runSketch.mock.calls.length === 1, "runSketch invocation");
    await waitFor(() => messages.some((message) => message.type === "simulation_status" && message.status === "stopped"), "stopped state");
    expect(webSocketMetricsTracker.getMetrics().runningSessions).toBe(0);
  });
});
