import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WsSessionManager, type ClientState } from "../../../server/routes/simulation/ws-session-manager";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

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
    reservation: null,
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

  it("releases a queued reservation on disconnect", async () => {
    const pool = { releaseRunner: vi.fn() };
    const admission = new SimulationAdmissionController(1);
    const reserved = admission.reserve("student-a");
    if (!reserved.admitted) throw new Error("reservation failed");
    const manager = new WsSessionManager({
      pool: pool as any,
      logger,
      admissionController: admission,
    });
    const socket = createSocket();
    const abortController = new AbortController();
    manager.register(socket, createState({
      subject: "student-a",
      reservation: reserved.reservation,
      queueAbortController: abortController,
    }));

    await manager.cleanupClient(socket, "disconnect-while-queued");

    expect(abortController.signal.aborted).toBe(true);
    expect(admission.getStats().active).toBe(0);
  });

  it("releases the reservation even when runner cleanup fails", async () => {
    const pool = { releaseRunner: vi.fn().mockRejectedValue(new Error("release failed")) };
    const admission = new SimulationAdmissionController(1);
    const reserved = admission.reserve("student-a");
    if (!reserved.admitted) throw new Error("reservation failed");
    const runner = { stop: vi.fn().mockRejectedValue(new Error("stop failed")) };
    const manager = new WsSessionManager({
      pool: pool as any,
      logger,
      admissionController: admission,
    });
    const state = createState({
      subject: "student-a",
      runner: runner as any,
      isRunning: true,
      reservation: reserved.reservation,
    });

    await manager.safeReleaseRunner(state, "runner-error");

    expect(admission.getStats().active).toBe(0);
    expect(state.reservation).toBeNull();
  });

  it("does not release a newer reservation from a stale callback", async () => {
    const pool = { releaseRunner: vi.fn() };
    const admission = new SimulationAdmissionController(1);
    const first = admission.reserve("student-a");
    if (!first.admitted) throw new Error("first reservation failed");
    admission.release(first.reservation);
    const second = admission.reserve("student-a");
    if (!second.admitted) throw new Error("second reservation failed");
    const manager = new WsSessionManager({
      pool: pool as any,
      logger,
      admissionController: admission,
    });
    const state = createState({
      subject: "student-a",
      reservation: second.reservation,
    });

    await manager.safeReleaseRunner(state, "stale-exit", first.reservation);

    expect(admission.getStats().active).toBe(1);
    expect(state.reservation).toBe(second.reservation);
  });
});
