/**
 * Tests for DockerManager.setupDockerTimeout()
 *
 * Verifies:
 *  - Security regression: executionTimeout=0 must fall back to the finite
 *    60-second default; untrusted clients cannot request infinite execution.
 *  - Positive value is forwarded correctly to the timeout manager.
 *  - Undefined falls back to SANDBOX_CONFIG.maxExecutionTimeSec (60 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DockerManager } from "../../../../server/services/sandbox/docker-manager";
import type { IProcessController } from "../../../../server/services/process-controller";
import type { ArduinoOutputParser } from "../../../../server/services/arduino-output-parser";
import type { SimulationTimeoutManager } from "../../../../server/services/simulation-timeout-manager";

// ─── minimal stubs ──────────────────────────────────────────────────────────

function makeProcessController(): IProcessController {
  return {
    spawn: vi.fn(),
    kill: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    onStdoutLine: vi.fn(),
    onStderrLine: vi.fn(),
    supportsStderrLineStreaming: vi.fn(() => false),
    writeStdin: vi.fn(),
    clearListeners: vi.fn(),
    destroySockets: vi.fn(),
    hasProcess: vi.fn(() => false),
    pid: undefined,
  } as unknown as IProcessController;
}

function makeStderrParser(): ArduinoOutputParser {
  return {
    parseStderrLine: vi.fn(() => ({ type: "unknown", line: "" })),
  } as unknown as ArduinoOutputParser;
}

function makeTimeoutManager(): SimulationTimeoutManager {
  return {
    schedule: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    isTimeoutActive: vi.fn(() => false),
  } as unknown as SimulationTimeoutManager;
}

const noop = () => {};
const mockCallbacks = {
  onOutput: vi.fn(),
  onPinState: vi.fn(),
  onError: vi.fn(),
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("DockerManager.setupDockerTimeout", () => {
  let timeoutManager: ReturnType<typeof makeTimeoutManager>;
  let manager: DockerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    timeoutManager = makeTimeoutManager();
    manager = new DockerManager(
      makeProcessController(),
      makeStderrParser(),
      timeoutManager,
      noop as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Finite timeout regression test ───────────────────────────────────────

  it("normalizes executionTimeout=0 to the finite default", () => {
    manager.setupDockerTimeout(0, mockCallbacks);

    expect(timeoutManager.schedule).toHaveBeenCalledWith(60_000, expect.any(Function));
  });

  // ── Correct forwarding of user-configured positive values ────────────────

  it("schedules a timer at the given executionTimeout (5 s)", () => {
    manager.setupDockerTimeout(5, mockCallbacks);

    expect(timeoutManager.schedule).toHaveBeenCalledOnce();
    const [ms] = (timeoutManager.schedule as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ms).toBe(5_000);
  });

  it("schedules a timer at the given executionTimeout (30 s)", () => {
    manager.setupDockerTimeout(30, mockCallbacks);

    expect(timeoutManager.schedule).toHaveBeenCalledOnce();
    const [ms] = (timeoutManager.schedule as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ms).toBe(30_000);
  });

  // ── Undefined falls back to the sandbox default ──────────────────────────

  it("falls back to maxExecutionTimeSec (60 s) when executionTimeout is undefined", () => {
    manager.setupDockerTimeout(undefined, mockCallbacks);

    expect(timeoutManager.schedule).toHaveBeenCalledOnce();
    const [ms] = (timeoutManager.schedule as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ms).toBe(60_000);
  });

  // ── Timeout callback kills the process and emits the message ─────────────

  it("timeout callback kills the process and emits the timeout serial message", () => {
    const processController = makeProcessController();
    const mgr = new DockerManager(
      processController,
      makeStderrParser(),
      timeoutManager,
      noop as any,
    );
    const onOutput = vi.fn();

    mgr.setupDockerTimeout(10, { ...mockCallbacks, onOutput });

    // Retrieve the callback passed to schedule and invoke it directly
    const [[, callback]] = (timeoutManager.schedule as ReturnType<typeof vi.fn>).mock.calls;
    callback();

    expect(processController.kill).toHaveBeenCalledWith("SIGKILL");
    expect(onOutput).toHaveBeenCalledWith(
      expect.stringContaining("Simulation timeout"),
      true,
    );
  });
});
