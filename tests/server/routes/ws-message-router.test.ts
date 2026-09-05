import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WsMessageRouter } from "../../../server/routes/simulation/ws-message-router";
import type { ClientState } from "../../../server/routes/simulation/ws-session-manager";

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createState(): ClientState {
  return {
    subject: "test-subject",
    runner: null,
    isRunning: false,
    isPaused: false,
    queueAbortController: null,
  };
}

function createSocket(): WebSocket {
  return {
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe("WsMessageRouter", () => {
  it("dispatches decoded messages to the matching handler", async () => {
    const ws = createSocket();
    const state = createState();
    const startSimulation = vi.fn();
    const router = new WsMessageRouter({
      logger,
      getClientState: () => state,
      handlers: {
        startSimulation,
        codeChanged: vi.fn(),
        stopSimulation: vi.fn(),
        pauseSimulation: vi.fn(),
        resumeSimulation: vi.fn(),
        serialInput: vi.fn(),
        setPinValue: vi.fn(),
      },
    });

    await router.route(
      ws,
      Buffer.from(JSON.stringify({ type: "start_simulation", code: "void setup(){}" })),
    );

    expect(startSimulation).toHaveBeenCalledWith(
      ws,
      { type: "start_simulation", code: "void setup(){}" },
      state,
    );
  });

  it("closes invalid messages with policy violation", async () => {
    const ws = createSocket();
    const router = new WsMessageRouter({
      logger,
      getClientState: () => createState(),
      handlers: {
        startSimulation: vi.fn(),
        codeChanged: vi.fn(),
        stopSimulation: vi.fn(),
        pauseSimulation: vi.fn(),
        resumeSimulation: vi.fn(),
        serialInput: vi.fn(),
        setPinValue: vi.fn(),
      },
    });

    await router.route(ws, Buffer.from("not-json"));

    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid message");
  });

  it("does not dispatch when client state is missing", async () => {
    const ws = createSocket();
    const startSimulation = vi.fn();
    const router = new WsMessageRouter({
      logger,
      getClientState: () => undefined,
      handlers: {
        startSimulation,
        codeChanged: vi.fn(),
        stopSimulation: vi.fn(),
        pauseSimulation: vi.fn(),
        resumeSimulation: vi.fn(),
        serialInput: vi.fn(),
        setPinValue: vi.fn(),
      },
    });

    await router.route(
      ws,
      Buffer.from(JSON.stringify({ type: "start_simulation", code: "void setup(){}" })),
    );

    expect(startSimulation).not.toHaveBeenCalled();
  });
});
