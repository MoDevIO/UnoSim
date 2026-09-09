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
    onStdout: vi.fn(),
    onStderr: vi.fn(),
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

describe("DockerManager output budget", () => {
  it("kills the process when combined output exceeds the limit", () => {
    const processController = makeProcessController();
    const manager = new DockerManager(
      processController,
      makeStderrParser(),
      makeTimeoutManager(),
      noop as any,
    );
    const stdoutHandlers: Array<(data: Buffer) => void> = [];
    const stderrHandlers: Array<(data: Buffer) => void> = [];
    vi.mocked(processController.onStdout).mockImplementation((handler) => {
      stdoutHandlers.push(handler as (data: Buffer) => void);
    });
    vi.mocked(processController.onStderr).mockImplementation((handler) => {
      stderrHandlers.push(handler as (data: Buffer) => void);
    });
    const state = {
      isCompilePhase: { value: false },
      compileErrorBuffer: { value: "" },
      compileSuccessSent: { value: false },
      totalOutputBytes: { value: 100 * 1024 * 1024 - 2 },
      stderrFallbackBuffer: "",
    };
    const callbacks = { ...mockCallbacks, onError: vi.fn() };
    manager.setupStdoutHandler(callbacks, state);
    manager.setupStderrHandlers(callbacks, state);
    stdoutHandlers[0]?.(Buffer.from("é"));
    stderrHandlers[0]?.(Buffer.from("x"));

    expect(processController.kill).toHaveBeenCalledWith("SIGKILL");
    expect(callbacks.onError).toHaveBeenCalledWith("Output size limit exceeded");
  });

  it("keeps gcc diagnostics out of serial output until the runtime sentinel", () => {
    const processController = makeProcessController();
    const stdoutHandlers: Array<(data: Buffer) => void> = [];
    vi.mocked(processController.onStdout).mockImplementation((handler) => {
      stdoutHandlers.push(handler as (data: Buffer) => void);
    });
    const manager = new DockerManager(
      processController,
      makeStderrParser(),
      makeTimeoutManager(),
      (parsed, callbacks) => {
        if (parsed.type === "text") callbacks.onError(parsed.line);
      },
    );
    const onError = vi.fn();
    const onCompileSuccess = vi.fn();
    const state = {
      isCompilePhase: { value: true },
      compileErrorBuffer: { value: "" },
      compileSuccessSent: { value: false },
      totalOutputBytes: { value: 0 },
      processStartTime: 1000,
    };

    manager.setupStdoutHandler({ ...mockCallbacks, onError }, state, onCompileSuccess);
    stdoutHandlers[0]?.(Buffer.from("/sandbox/sketch.cpp:1:10: fatal error: header_1: No such file or directory\n"));

    expect(onError).not.toHaveBeenCalled();
    expect(onCompileSuccess).not.toHaveBeenCalled();
    expect(state.isCompilePhase.value).toBe(true);
    expect(state.compileErrorBuffer.value).toContain("fatal error: header_1: No such file or directory");
  });

  it("emits a simulation build error and no success when Docker exits during compile", () => {
    const manager = new DockerManager(
      makeProcessController(),
      makeStderrParser(),
      makeTimeoutManager(),
      noop as any,
    );
    const onCompileError = vi.fn();
    const onCompileSuccess = vi.fn();
    const state = {
      isCompilePhase: { value: true },
      compileErrorBuffer: { value: "/sandbox/sketch.cpp:1:10: fatal error: header_1: No such file or directory\n" },
      compileSuccessSent: { value: false },
      stderrFallbackBuffer: "",
      processStartTime: 1000,
    };

    manager.handleDockerExit(
      mockCallbacks,
      state,
      1,
      { flushBatchers: vi.fn(), flushMessageQueue: vi.fn(), getProcessKilled: () => false },
      { onCompileError, onCompileSuccess, onExit: vi.fn() },
    );

    expect(onCompileError).toHaveBeenCalledWith(expect.stringContaining("sketch.ino:1:10: fatal error: header_1"));
    expect(onCompileSuccess).not.toHaveBeenCalled();
  });

  it("handles a sentinel split across stdout chunks and preserves immediate runtime output", () => {
    const processController = makeProcessController();
    const stdoutHandlers: Array<(data: Buffer) => void> = [];
    vi.mocked(processController.onStdout).mockImplementation((handler) => {
      stdoutHandlers.push(handler as (data: Buffer) => void);
    });
    const parsedLines: string[] = [];
    const manager = new DockerManager(
      processController,
      { parseStderrLine: vi.fn((line: string) => ({ type: "text", line })) } as any,
      makeTimeoutManager(),
      (parsed) => {
        if (parsed.type === "text") parsedLines.push(parsed.line);
      },
    );
    const onCompileSuccess = vi.fn();
    const state = {
      isCompilePhase: { value: true },
      compileErrorBuffer: { value: "" },
      compileSuccessSent: { value: false },
      totalOutputBytes: { value: 0 },
      processStartTime: 1000,
    };

    manager.setupStdoutHandler({ ...mockCallbacks, onError: vi.fn() }, state, onCompileSuccess);
    stdoutHandlers[0]?.(Buffer.from("gcc warning before sentinel\n[[RUNTIME_"));
    expect(state.isCompilePhase.value).toBe(true);
    expect(onCompileSuccess).not.toHaveBeenCalled();

    stdoutHandlers[0]?.(Buffer.from("START]]\nruntime output\n"));

    expect(state.isCompilePhase.value).toBe(false);
    expect(onCompileSuccess).toHaveBeenCalledOnce();
    expect(parsedLines).toEqual(["runtime output"]);

    stdoutHandlers[0]?.(Buffer.from("[[RUNTIME_START]]\nsecond runtime output\n"));

    expect(onCompileSuccess).toHaveBeenCalledOnce();
    expect(parsedLines).toEqual(["runtime output", "second runtime output"]);
  });

  it("does not switch on an embedded or indented marker-like compiler line", () => {
    const processController = makeProcessController();
    const stdoutHandlers: Array<(data: Buffer) => void> = [];
    vi.mocked(processController.onStdout).mockImplementation((handler) => {
      stdoutHandlers.push(handler as (data: Buffer) => void);
    });
    const onCompileSuccess = vi.fn();
    const state = {
      isCompilePhase: { value: true },
      compileErrorBuffer: { value: "" },
      compileSuccessSent: { value: false },
      totalOutputBytes: { value: 0 },
      processStartTime: 1000,
    };
    const manager = new DockerManager(
      processController,
      makeStderrParser(),
      makeTimeoutManager(),
      noop as any,
    );

    manager.setupStdoutHandler({ ...mockCallbacks, onError: vi.fn() }, state, onCompileSuccess);
    stdoutHandlers[0]?.(Buffer.from("note: [[RUNTIME_START]] is only text\n  [[RUNTIME_START]]\n"));

    expect(state.isCompilePhase.value).toBe(true);
    expect(onCompileSuccess).not.toHaveBeenCalled();
  });

  it("does not emit compile success when no sentinel arrives", () => {
    const processController = makeProcessController();
    const stdoutHandlers: Array<(data: Buffer) => void> = [];
    vi.mocked(processController.onStdout).mockImplementation((handler) => {
      stdoutHandlers.push(handler as (data: Buffer) => void);
    });
    const onCompileSuccess = vi.fn();
    const state = {
      isCompilePhase: { value: true },
      compileErrorBuffer: { value: "" },
      compileSuccessSent: { value: false },
      totalOutputBytes: { value: 0 },
      processStartTime: 1000,
    };
    const manager = new DockerManager(
      processController,
      makeStderrParser(),
      makeTimeoutManager(),
      noop as any,
    );

    manager.setupStdoutHandler({ ...mockCallbacks, onError: vi.fn() }, state, onCompileSuccess);
    stdoutHandlers[0]?.(Buffer.from("fatal error: missing header\n"));

    expect(state.isCompilePhase.value).toBe(true);
    expect(onCompileSuccess).not.toHaveBeenCalled();
  });
});
