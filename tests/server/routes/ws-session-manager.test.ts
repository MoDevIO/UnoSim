import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WsSessionManager, type ClientState } from "../../../server/routes/simulation/ws-session-manager";

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket;
}

function createRunner() {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createState(overrides: Partial<ClientState> = {}): ClientState {
  return {
    subject: "test-subject",
    runner: null,
    isRunning: false,
    isPaused: false,
    queueAbortController: null,
    ...overrides,
  } as ClientState;
}

describe("WsSessionManager", () => {
  it("releases a running client runner and broadcasts updated totals", async () => {
    const pool = { releaseRunner: vi.fn().mockResolvedValue(undefined) };
    const manager = new WsSessionManager({ pool: pool as any, logger });
    const releasingSocket = createSocket();
    const otherSocket = createSocket();
    const runner = createRunner();
    const releasingState = createState({
      runner: runner as any,
      isRunning: true,
      isPaused: true,
    });
    const otherState = createState({ isRunning: true });

    manager.register(releasingSocket, releasingState);
    manager.register(otherSocket, otherState);

    await manager.safeReleaseRunner(releasingState, "test");

    expect(runner.stop).toHaveBeenCalledOnce();
    expect(pool.releaseRunner).toHaveBeenCalledWith(runner);
    expect(releasingState.runner).toBeNull();
    expect(releasingState.isRunning).toBe(false);
    expect(releasingState.isPaused).toBe(false);
    expect(otherSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "compilation_status", workerTotal: 1 }),
    );
  });

  it("aborts queued acquire, releases runner, removes session, and broadcasts on cleanup", async () => {
    const pool = { releaseRunner: vi.fn().mockResolvedValue(undefined) };
    const manager = new WsSessionManager({ pool: pool as any, logger });
    const disconnectedSocket = createSocket();
    const otherSocket = createSocket();
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    const runner = createRunner();

    manager.register(
      disconnectedSocket,
      createState({
        runner: runner as any,
        isRunning: true,
        queueAbortController: abortController,
      }),
    );
    manager.register(otherSocket, createState({ isRunning: true }));

    await manager.cleanupClient(disconnectedSocket, "disconnect");

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(manager.get(disconnectedSocket)).toBeUndefined();
    expect(otherSocket.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: "compilation_status", workerTotal: 1 }),
    );
  });
});
