import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxRunner } from "../../../server/services/sandbox-runner";
import { cleanupDockerContainer } from "../../../server/services/sandbox/execution-phases/cleanup-phase";
import { wsMessageSchema } from "../../../shared/schema";

const failure = { code: 1, stdout: "", stderr: "synthetic Docker failure", error: null };
const success = { code: 0, stdout: "", stderr: "", error: null };
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

function fixture(stateName = "running") {
  const pc = {
    spawn: vi.fn(), onStdout: vi.fn(), onStderr: vi.fn(), onStderrLine: vi.fn(),
    supportsStderrLineStreaming: vi.fn(() => true), onClose: vi.fn(), onError: vi.fn(),
    writeStdin: vi.fn(() => true), kill: vi.fn(), destroySockets: vi.fn(),
    hasProcess: vi.fn(() => true), clearListeners: vi.fn(), getPid: vi.fn(() => null),
  };
  const runner = new SandboxRunner({ processController: pc });
  const internals = runner as any;
  const s = internals.executionState;
  Object.assign(s, {
    state: stateName, currentContainerName: "unosim-synthetic-run-A", runGeneration: 1,
    runAbort: new AbortController(), processKilled: false, pauseStartTime: Date.now() - 100,
  });
  const execute = vi.spyOn(internals.processExecutor, "execute").mockResolvedValue(failure);
  const warn = vi.spyOn(internals.logger, "warn");
  return { runner, pc, s, execute, warn, timeout: internals.timeoutManager };
}

describe("Docker lifecycle ownership", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

  it("must not remain falsely paused with a suspended deadline after nonzero docker pause", async () => {
    const f = fixture();
    f.timeout.schedule(30_000, vi.fn());
    f.runner.pause();
    await flush();
    expect.soft(f.runner.isPaused).toBe(false);
    expect.soft(f.timeout.isTimeoutPaused()).toBe(false);
    expect.soft(f.warn).toHaveBeenCalled();
  });

  it("must not write a resume clock marker after nonzero docker unpause", async () => {
    const f = fixture("paused");
    f.runner.resume();
    await flush();
    expect(f.pc.writeStdin).not.toHaveBeenCalledWith(expect.stringMatching(/^\[\[RESUME_TIME:/));
  });

  it("must not forward run A's delayed resume result to reused run B", async () => {
    const f = fixture("paused");
    let complete!: (value: typeof success) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue(success);
    f.runner.resume();
    await f.runner.stop();
    await f.runner.resetForReuse();
    Object.assign(f.s, { state: "running", currentContainerName: "unosim-synthetic-run-B",
      runGeneration: 2, runAbort: new AbortController(), processKilled: false });
    f.pc.writeStdin.mockClear();
    complete(success);
    await flush();
    expect(f.pc.writeStdin).not.toHaveBeenCalled();
  });

  it("must not report a successful removal when docker rm resolves with code 1", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    await cleanupDockerContainer("unosim-synthetic-cleanup", {
      processExecutor: { execute: vi.fn().mockResolvedValue(failure) }, logger: logger as any,
    });
    expect.soft(logger.info).not.toHaveBeenCalled();
    expect.soft(logger.warn).toHaveBeenCalled();
  });

  it("must retain failed container cleanup ownership for retry or quarantine", async () => {
    const f = fixture();
    await f.runner.stop();
    expect(f.s.currentContainerName).toBe("unosim-synthetic-run-A");
  });

  it.each(["pause", "resume"])("commits %s only after confirmed Docker success", async (operation) => {
    const f = fixture(operation === "pause" ? "running" : "paused");
    let complete!: (value: typeof success) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    expect(f.runner[operation]()).toBe(true);
    expect(f.runner.isPaused).toBe(operation === "resume");
    complete(success);
    await flush();
    expect(f.runner.isPaused).toBe(operation === "pause");
  });

  it.each([
    ["pause", "spawn failed"], ["resume", "spawn failed"],
    ["pause", "Process timeout after 5000ms"], ["resume", "Process timeout after 5000ms"],
  ] as const)("stops after %s failure: %s", async (operation, message) => {
    const f = fixture(operation === "pause" ? "running" : "paused");
    f.execute.mockRejectedValueOnce(new Error(message))
      .mockResolvedValue(success);
    f.runner[operation]();
    await flush();
    expect(f.runner.simulationState).toBe("stopped");
    expect(f.pc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(f.warn).toHaveBeenCalled();
  });

  it("ignores a stale failed control instead of stopping a successor", async () => {
    const f = fixture();
    let complete!: (value: typeof failure) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue(success);
    f.runner.pause();
    await f.runner.stop();
    await f.runner.resetForReuse();
    Object.assign(f.s, { state: "running", currentContainerName: "unosim-synthetic-run-B",
      runGeneration: 2, runAbort: new AbortController(), processKilled: false });
    f.pc.kill.mockClear();
    complete(failure);
    await flush();
    expect(f.runner.simulationState).toBe("running");
    expect(f.pc.kill).not.toHaveBeenCalled();
  });

  it("retries failed removal on repeated stop", async () => {
    const f = fixture();
    await f.runner.stop();
    f.execute.mockResolvedValue(success);
    await f.runner.stop();
    expect(f.execute.mock.calls.filter(([, args]) => args[0] === "rm")).toHaveLength(2);
    expect(f.s.currentContainerName).toBeUndefined();
  });

  it("refuses reuse while removal remains unconfirmed", async () => {
    const f = fixture();
    await f.runner.stop();
    await expect(f.runner.resetForReuse()).rejects.toThrow(/cleanup/i);
    expect(f.s.currentContainerName).toBe("unosim-synthetic-run-A");
  });

  it("does not clear a successor container after delayed removal", async () => {
    const f = fixture();
    let complete!: (value: typeof success) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const stopped = f.runner.stop();
    Object.assign(f.s, { currentContainerName: "unosim-synthetic-run-B", runGeneration: 2 });
    complete(success);
    await stopped;
    expect(f.s.currentContainerName).toBe("unosim-synthetic-run-B");
  });

  it("does not resurrect a naturally closed run from delayed unpause", async () => {
    const f = fixture("paused");
    let complete!: (value: typeof success) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    f.runner.resume();
    f.s.state = "stopped";
    f.pc.hasProcess.mockReturnValue(false);
    complete(success);
    await flush();
    expect(f.runner.simulationState).toBe("stopped");
    expect(f.pc.writeStdin).not.toHaveBeenCalled();
  });

  it("accepts auto-removal only after Docker confirms no matching container exists", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const removed = await cleanupDockerContainer("unosim-synthetic-auto-removed", {
      processExecutor: { execute: vi.fn().mockResolvedValueOnce(failure).mockResolvedValue(success) },
      logger: logger as any,
    });
    expect(removed).toBe(true);
  });

  it("does not commit pending pause after the execution deadline", async () => {
    const f = fixture();
    let complete!: (value: typeof success) => void;
    f.execute.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue(success);
    f.runner.pause();
    (f.runner as any).dockerManager.setupDockerTimeout(1, {
      onOutput: vi.fn(), onError: vi.fn(), onPinState: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    complete(success);
    await flush();
    expect(f.runner.isPaused).toBe(false);
  });

  it.each(["pause_simulation", "resume_simulation"])("confirms the current error contract rejects %s", (operation) => {
    expect(wsMessageSchema.safeParse({ type: "operation_error", operation,
      code: "SIMULATION_CONTROL_FAILED", message: "synthetic error" }).success).toBe(false);
  });
});
