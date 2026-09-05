import { describe, it, expect, vi } from "vitest";
import {
  abortExecution,
  handleExecutionTimeout,
  scheduleExecutionTimeout,
} from "../../../../server/services/sandbox/execution-phases/timeout-phase";
import type { ExecutionState } from "../../../../server/services/sandbox/execution-manager";

const createBaseState = (): ExecutionState => ({
  outputBuffer: "",
  outputBufferIndex: 0,
  isSendingOutput: false,
  totalOutputBytes: 0,
  messageQueue: [],
  pauseStartTime: null,
  totalPausedTime: 0,
  isCompiling: false,
  currentSketchDir: null,
  currentRegistryFile: null,
  processStartTime: null,
  onOutputCallback: null,
  pinStateCallback: null,
  errorCallback: null,
  telemetryCallback: null,
  ioRegistryCallback: undefined,
  pinStateBatcher: null,
  serialOutputBatcher: null,
  backpressurePaused: false,
  baudrate: 9600,
  stderrFallbackBuffer: "",
  flushTimer: null,
  state: "running" as any,
  processKilled: false,
  pendingCleanup: false,
  processController: {
    kill: vi.fn(),
  } as any,
  currentContainerName: undefined,
  dockerAvailable: undefined,
  dockerImageBuilt: undefined,
  outputCollector: undefined,
});

const createDependencies = () => ({
  processExecutor: {
    execute: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
});

describe("timeout-phase.ts", () => {
  describe("abortExecution", () => {
    it("kills the current process with SIGKILL by default", () => {
      const state = createBaseState();

      abortExecution(state);

      expect(state.processController.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("uses a provided signal", () => {
      const state = createBaseState();

      abortExecution(state, "SIGTERM");

      expect(state.processController.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("handleExecutionTimeout", () => {
    it("kills the process and notifies output callback", () => {
      const state = createBaseState();
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();

      handleExecutionTimeout(3, state, callbacks, deps as any);

      expect(state.processController.kill).toHaveBeenCalledWith("SIGKILL");
      expect(callbacks.onOutput).toHaveBeenCalledWith("--- Simulation timeout (3s) ---", true);
      expect(deps.processExecutor.execute).not.toHaveBeenCalled();
    });

    it("requests Docker container cleanup when a container exists", async () => {
      const state = createBaseState();
      state.currentContainerName = "unosim-sandbox-test";
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();

      handleExecutionTimeout(5, state, callbacks, deps as any);
      await Promise.resolve();

      expect(deps.processExecutor.execute).toHaveBeenCalledWith("docker", ["rm", "-f", "unosim-sandbox-test"], {
        timeout: 5000,
        stdio: "pipe",
      });
      expect(deps.logger.info).toHaveBeenCalledWith("Docker container cleanup: unosim-sandbox-test");
    });
  });

  describe("scheduleExecutionTimeout", () => {
    it("schedules finite timeouts in milliseconds", () => {
      const state = createBaseState();
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();
      const timeoutManager = { schedule: vi.fn() };

      scheduleExecutionTimeout(timeoutManager, 7, state, callbacks, deps as any);

      expect(timeoutManager.schedule).toHaveBeenCalledTimes(1);
      expect(timeoutManager.schedule).toHaveBeenCalledWith(7000, expect.any(Function));
    });

    it("schedules null for undefined timeout", () => {
      const state = createBaseState();
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();
      const timeoutManager = { schedule: vi.fn() };

      scheduleExecutionTimeout(timeoutManager, undefined, state, callbacks, deps as any);

      expect(timeoutManager.schedule).toHaveBeenCalledWith(null, expect.any(Function));
    });

    it("schedules null for non-positive timeout", () => {
      const state = createBaseState();
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();
      const timeoutManager = { schedule: vi.fn() };

      scheduleExecutionTimeout(timeoutManager, 0, state, callbacks, deps as any);

      expect(timeoutManager.schedule).toHaveBeenCalledWith(null, expect.any(Function));
    });

    it("runs timeout handling when scheduled callback fires", () => {
      const state = createBaseState();
      const callbacks = { onOutput: vi.fn() };
      const deps = createDependencies();
      let scheduledCallback: (() => void) | undefined;
      const timeoutManager = {
        schedule: vi.fn((_timeoutMs: number | null, callback: () => void) => {
          scheduledCallback = callback;
        }),
      };

      scheduleExecutionTimeout(timeoutManager, 2, state, callbacks, deps as any);
      scheduledCallback?.();

      expect(state.processController.kill).toHaveBeenCalledWith("SIGKILL");
      expect(callbacks.onOutput).toHaveBeenCalledWith("--- Simulation timeout (2s) ---", true);
    });
  });
});
