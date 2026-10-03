/**
 * SandboxRunner.resetForReuse(): the runner owns the reset of its execution
 * state before the pool hands it to the next user (previously done by the pool
 * through private fields).
 */
import { describe, expect, it, vi } from "vitest";
import { SandboxRunner } from "../../../server/services/sandbox-runner";
import type { IProcessController } from "../../../server/services/process-controller";

function fakeProcessController(): IProcessController {
  return {
    spawn: vi.fn().mockResolvedValue(null),
    onStdout: vi.fn(),
    onStderr: vi.fn(),
    onStderrLine: vi.fn(),
    supportsStderrLineStreaming: vi.fn(() => true),
    onClose: vi.fn(),
    onError: vi.fn(),
    writeStdin: vi.fn(() => true),
    kill: vi.fn(),
    destroySockets: vi.fn(),
    hasProcess: vi.fn(() => false),
    clearListeners: vi.fn(),
    getPid: vi.fn(() => null),
  };
}

type Internals = {
  executionState: Record<string, unknown>;
  registryManager: { reset: () => void };
};

function internals(runner: SandboxRunner): Internals {
  return runner as unknown as Internals;
}

describe("SandboxRunner.resetForReuse", () => {
  it("clears the previous run's state and process listeners", async () => {
    const processController = fakeProcessController();
    const runner = new SandboxRunner({ processController });
    const state = internals(runner).executionState;
    Object.assign(state, {
      outputBuffer: "some output",
      totalOutputBytes: 5000,
      processKilled: true,
      pendingCleanup: true,
      isSendingOutput: true,
      messageQueue: [{ type: "stale" }],
      backpressurePaused: true,
      onOutputCallback: vi.fn(),
    });

    await runner.resetForReuse();

    expect(runner.simulationState).toBe("stopped");
    expect(state).toMatchObject({
      outputBuffer: "",
      totalOutputBytes: 0,
      processKilled: false,
      pendingCleanup: false,
      isSendingOutput: false,
      messageQueue: [],
      backpressurePaused: false,
      onOutputCallback: null,
    });
    expect(processController.clearListeners).toHaveBeenCalledOnce();
  });

  it("resets the I/O registry and tolerates a failing registry reset", async () => {
    const runner = new SandboxRunner({ processController: fakeProcessController() });
    const reset = vi.spyOn(internals(runner).registryManager, "reset").mockImplementation(() => {
      throw new Error("reset failed");
    });

    await expect(runner.resetForReuse()).resolves.toBeUndefined();
    expect(reset).toHaveBeenCalled();
  });

  it("stops a running runner and still resets when stop fails", async () => {
    const runner = new SandboxRunner({ processController: fakeProcessController() });
    internals(runner).executionState.state = "running";
    internals(runner).executionState.outputBuffer = "pending";
    const stop = vi.spyOn(runner, "stop").mockRejectedValue(new Error("stop failed"));

    await expect(runner.resetForReuse()).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledOnce();
    expect(internals(runner).executionState.outputBuffer).toBe("");
  });
});
