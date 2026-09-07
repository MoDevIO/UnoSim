import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import type { ServerToClientWSMessage } from "@shared/schema";
import { registerSimulationWebSocket } from "../../../server/routes/simulation.ws";
import type { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { SandboxRunnerPool } from "../../../server/services/sandbox-runner-pool";

type RunnerDouble = {
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  sendSerialInput: ReturnType<typeof vi.fn>;
  setPinValue: ReturnType<typeof vi.fn>;
  runSketch: ReturnType<typeof vi.fn>;
  getSandboxStatus: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function createRunner(): RunnerDouble {
  return {
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
    sendSerialInput: vi.fn(),
    setPinValue: vi.fn(),
    runSketch: vi.fn().mockResolvedValue(undefined),
    getSandboxStatus: vi.fn(() => ({ mode: "local-limited" })),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe("WebSocket lifecycle through the production route", () => {
  let httpServer: Server;
  let client: WebSocket;
  let runner: RunnerDouble;
  let messages: ServerToClientWSMessage[];

  beforeEach(async () => {
    runner = createRunner();
    messages = [];

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
    } as unknown as SandboxRunnerPool;

    httpServer = createServer();
    registerSimulationWebSocket(httpServer, {
      SandboxRunner: class {} as typeof SandboxRunner,
      getSimulationRateLimiter: () => ({ checkLimit: () => ({ allowed: true }) }),
      shouldSendSimulationEndMessage: () => true,
      getLastCompiledCode: () => null,
      logger: createLogger(),
      runnerPool: pool,
      trust: { mode: "local" },
      allowedWebSocketOrigins: [],
      disableRateLimit: true,
    });

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address() as AddressInfo;
    client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as ServerToClientWSMessage);
    });

    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });

    client.send(JSON.stringify({
      type: "start_simulation",
      code: "void setup() {} void loop() {}",
    }));
    await waitFor(
      () => messages.some(
        (message) => message.type === "simulation_status" && message.status === "running",
      ),
      "the running state",
    );
  });

  afterEach(async () => {
    if (client.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        client.once("close", () => resolve());
        client.close();
      });
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("pauses a running simulation and publishes the paused state", async () => {
    client.send(JSON.stringify({ type: "pause_simulation" }));

    await waitFor(() => runner.pause.mock.calls.length === 1, "runner pause");
    await waitFor(
      () => messages.some(
        (message) => message.type === "simulation_status" && message.status === "paused",
      ),
      "the paused state",
    );

    expect(runner.pause).toHaveBeenCalledOnce();
    expect(messages).toContainEqual({
      type: "serial_output",
      data: "--- Simulation paused ---\n",
    });
  });

  it("resumes a paused simulation and publishes the running state", async () => {
    client.send(JSON.stringify({ type: "pause_simulation" }));
    await waitFor(() => runner.pause.mock.calls.length === 1, "runner pause");

    const runningMessagesBeforeResume = messages.filter(
      (message) => message.type === "simulation_status" && message.status === "running",
    ).length;
    client.send(JSON.stringify({ type: "resume_simulation" }));

    await waitFor(() => runner.resume.mock.calls.length === 1, "runner resume");
    await waitFor(
      () => messages.filter(
        (message) => message.type === "simulation_status" && message.status === "running",
      ).length > runningMessagesBeforeResume,
      "the resumed running state",
    );

    expect(runner.resume).toHaveBeenCalledOnce();
    expect(messages).toContainEqual({
      type: "serial_output",
      data: "--- Simulation resumed ---\n",
    });
  });

  it("forwards serial input to the active runner", async () => {
    client.send(JSON.stringify({ type: "serial_input", data: "hello Uno\n" }));

    await waitFor(
      () => runner.sendSerialInput.mock.calls.length === 1,
      "serial input forwarding",
    );

    expect(runner.sendSerialInput).toHaveBeenCalledOnce();
    expect(runner.sendSerialInput).toHaveBeenCalledWith("hello Uno\n");
  });

  it("forwards a pin value to the active runner", async () => {
    client.send(JSON.stringify({ type: "set_pin_value", pin: 13, value: 1 }));

    await waitFor(
      () => runner.setPinValue.mock.calls.length === 1,
      "pin value forwarding",
    );

    expect(runner.setPinValue).toHaveBeenCalledOnce();
    expect(runner.setPinValue).toHaveBeenCalledWith(13, 1);
  });
});
