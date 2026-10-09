import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePausedBudget } from "../../../server/config";
import { SandboxRunner } from "../../../server/services/sandbox-runner";

const success = { code: 0, stdout: "", stderr: "", error: null };
const PAUSE_BUDGET_MS = 1_000;
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

function fixture() {
  const pc = {
    spawn: vi.fn(), onStdout: vi.fn(), onStderr: vi.fn(), onStderrLine: vi.fn(),
    supportsStderrLineStreaming: vi.fn(() => true), onClose: vi.fn(), onError: vi.fn(),
    writeStdin: vi.fn(() => true), kill: vi.fn(), destroySockets: vi.fn(),
    hasProcess: vi.fn(() => true), clearListeners: vi.fn(), getPid: vi.fn(() => null),
  };
  const runner = new SandboxRunner({ processController: pc, maxPausedMs: PAUSE_BUDGET_MS });
  const internals = runner as any;
  const s = internals.executionState;
  const output = vi.fn();
  Object.assign(s, {
    state: "running", currentContainerName: "unosim-synthetic-paused", runGeneration: 1,
    runAbort: new AbortController(), processKilled: false, onOutputCallback: output,
  });
  vi.spyOn(internals.processExecutor, "execute").mockResolvedValue(success);
  return { runner, pc, s, output };
}

const killedWithSigkill = (pc: ReturnType<typeof fixture>["pc"]) =>
  pc.kill.mock.calls.some(([signal]) => signal === "SIGKILL");

describe("paused run budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

  it("ends a run that stays paused beyond its pause budget", async () => {
    const f = fixture();
    f.runner.pause();
    await flush();
    expect(f.runner.isPaused).toBe(true);

    await vi.advanceTimersByTimeAsync(PAUSE_BUDGET_MS - 1);
    expect(killedWithSigkill(f.pc)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    // Same termination path as the runtime timeout: the process exit reports onExit,
    // which releases runner and admission and sends the stopped status.
    expect(killedWithSigkill(f.pc)).toBe(true);
    expect(f.s.terminationRequested).toBe(true);
    expect(f.output).toHaveBeenCalledWith(expect.stringContaining("paused longer than"), true);
  });

  it("counts the paused time of all pauses of a run together", async () => {
    const f = fixture();
    f.runner.pause();
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    f.runner.resume();
    await flush();
    expect(f.runner.isPaused).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(killedWithSigkill(f.pc)).toBe(false);

    f.runner.pause();
    await flush();
    await vi.advanceTimersByTimeAsync(399);
    expect(killedWithSigkill(f.pc)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(killedWithSigkill(f.pc)).toBe(true);
  });

  it("does not end a run that was stopped while paused", async () => {
    const f = fixture();
    f.runner.pause();
    await flush();
    await f.runner.stop();
    f.pc.kill.mockClear();

    await vi.advanceTimersByTimeAsync(PAUSE_BUDGET_MS * 2);

    expect(f.pc.kill).not.toHaveBeenCalled();
    expect(f.output).not.toHaveBeenCalled();
  });
});

describe("pause budget configuration", () => {
  it("must end a paused run before the sandbox's own hard lifetime", () => {
    expect(() => validatePausedBudget(600, 7_200)).not.toThrow();
    expect(() => validatePausedBudget(7_200, 7_200)).toThrow(/SIMULATION_MAX_PAUSED_SECONDS/);
  });
});
