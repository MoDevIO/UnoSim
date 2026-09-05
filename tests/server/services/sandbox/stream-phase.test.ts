import { describe, it, expect, vi } from "vitest";
import {
  createStreamCallbacks,
  delegateParsedLineToStreamHandler,
  handleStderrFallbackData,
} from "../../../../server/services/sandbox/execution-phases/stream-phase";
import type { ExecutionState } from "../../../../server/services/sandbox/execution-manager";
import type { ParsedStderrOutput } from "../../../../server/services/arduino-output-parser";

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
  processStartTime: 1000,
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
  processController: {} as any,
  currentContainerName: undefined,
  dockerAvailable: undefined,
  dockerImageBuilt: undefined,
  outputCollector: undefined,
});

const createCallbackDependencies = (isWaiting = false) => ({
  registryManager: {
    isWaiting: vi.fn(() => isWaiting),
  },
  logger: {
    warn: vi.fn(),
  },
});

const createStreamDependencies = () => ({
  registryManager: {
    startCollection: vi.fn(),
    finishCollection: vi.fn(),
    addPin: vi.fn(),
    updatePinMode: vi.fn(),
  },
  streamHandler: {
    handleParsedLine: vi.fn((_parsed, streamState) => {
      streamState.backpressurePaused = true;
    }),
  },
});

describe("stream-phase.ts", () => {
  describe("createStreamCallbacks", () => {
    it("routes normal output through serial batcher when available", () => {
      const state = createBaseState();
      const serialOutputBatcher = { enqueue: vi.fn() };
      state.serialOutputBatcher = serialOutputBatcher as any;
      const onOutput = vi.fn();
      const callbacks = createStreamCallbacks(onOutput, vi.fn(), undefined, state, createCallbackDependencies() as any);

      callbacks.onOutput("hello", true);

      expect(serialOutputBatcher.enqueue).toHaveBeenCalledWith("hello");
      expect(onOutput).not.toHaveBeenCalled();
    });

    it("routes normal output directly when no serial batcher exists", () => {
      const state = createBaseState();
      const onOutput = vi.fn();
      const callbacks = createStreamCallbacks(onOutput, vi.fn(), undefined, state, createCallbackDependencies() as any);

      callbacks.onOutput("hello", false);

      expect(onOutput).toHaveBeenCalledWith("hello", false);
    });

    it("does not route direct output after process was killed", () => {
      const state = createBaseState();
      state.processKilled = true;
      const onOutput = vi.fn();
      const callbacks = createStreamCallbacks(onOutput, vi.fn(), undefined, state, createCallbackDependencies() as any);

      callbacks.onOutput("ignored", true);

      expect(onOutput).not.toHaveBeenCalled();
    });

    it("delivers telemetry markers to telemetry callback", () => {
      const state = createBaseState();
      state.telemetryCallback = vi.fn();
      const onOutput = vi.fn();
      const callbacks = createStreamCallbacks(onOutput, vi.fn(), undefined, state, createCallbackDependencies() as any);
      const telemetry = { timestamp: 1, serialBytesTotal: 42 };

      callbacks.onOutput(`[[SIM_TELEMETRY:${JSON.stringify(telemetry)}]]`, true);

      expect(state.telemetryCallback).toHaveBeenCalledWith(telemetry);
      expect(onOutput).not.toHaveBeenCalled();
    });

    it("logs and forwards malformed telemetry as normal output", () => {
      const state = createBaseState();
      const deps = createCallbackDependencies();
      const onOutput = vi.fn();
      const callbacks = createStreamCallbacks(onOutput, vi.fn(), undefined, state, deps as any);

      callbacks.onOutput("[[SIM_TELEMETRY:not-json]]", true);

      expect(deps.logger.warn).toHaveBeenCalledTimes(1);
      expect(onOutput).toHaveBeenCalledWith("[[SIM_TELEMETRY:not-json]]", true);
    });

    it("queues pin state while registry manager is waiting", () => {
      const state = createBaseState();
      const onPinState = vi.fn();
      const callbacks = createStreamCallbacks(vi.fn(), vi.fn(), onPinState, state, createCallbackDependencies(true) as any);

      callbacks.onPinState?.(13, "digital", 1);

      expect(state.messageQueue).toEqual([
        { type: "pinState", data: { pin: 13, stateType: "digital", value: 1 } },
      ]);
      expect(onPinState).not.toHaveBeenCalled();
    });

    it("routes pin state directly when registry manager is not waiting", () => {
      const state = createBaseState();
      const onPinState = vi.fn();
      const callbacks = createStreamCallbacks(vi.fn(), vi.fn(), onPinState, state, createCallbackDependencies(false) as any);

      callbacks.onPinState?.(12, "pwm", 128);

      expect(onPinState).toHaveBeenCalledWith(12, "pwm", 128);
      expect(state.messageQueue).toEqual([]);
    });

    it("routes error lines to error callback", () => {
      const onError = vi.fn();
      const callbacks = createStreamCallbacks(vi.fn(), onError, undefined, createBaseState(), createCallbackDependencies() as any);

      callbacks.onError("boom");

      expect(onError).toHaveBeenCalledWith("boom");
    });
  });

  describe("delegateParsedLineToStreamHandler", () => {
    it("does nothing without state", () => {
      const deps = createStreamDependencies();
      const parsed: ParsedStderrOutput = { type: "ignored" };

      delegateParsedLineToStreamHandler(parsed, undefined, { onOutput: vi.fn(), onError: vi.fn() }, deps as any);

      expect(deps.streamHandler.handleParsedLine).not.toHaveBeenCalled();
    });

    it("delegates parsed line and syncs backpressure state", () => {
      const state = createBaseState();
      const deps = createStreamDependencies();
      const callbacks = { onOutput: vi.fn(), onError: vi.fn(), onPinState: vi.fn() };
      const parsed: ParsedStderrOutput = { type: "serial_event", timestamp: 1234, data: "hello" };

      delegateParsedLineToStreamHandler(parsed, state, callbacks, deps as any);

      expect(deps.streamHandler.handleParsedLine).toHaveBeenCalledWith(
        parsed,
        expect.objectContaining({
          backpressurePaused: true,
          baudrate: 9600,
          registryManager: deps.registryManager,
        }),
        callbacks,
      );
      expect(state.backpressurePaused).toBe(true);
    });

    it("marks stream state as paused when execution state is paused", () => {
      const state = createBaseState();
      state.state = "paused" as any;
      const deps = createStreamDependencies();
      const parsed: ParsedStderrOutput = { type: "ignored" };

      delegateParsedLineToStreamHandler(parsed, state, { onOutput: vi.fn(), onError: vi.fn() }, deps as any);

      expect(deps.streamHandler.handleParsedLine).toHaveBeenCalledWith(
        parsed,
        expect.objectContaining({ isPaused: true }),
        expect.any(Object),
      );
    });
  });

  describe("handleStderrFallbackData", () => {
    it("buffers incomplete trailing lines and delegates complete lines", () => {
      const state = createBaseState();
      const deps = {
        ...createStreamDependencies(),
        stderrParser: {
          parseStderrLine: vi.fn((line: string) => ({ type: "text", line }) satisfies ParsedStderrOutput),
        },
      };
      const callbacks = { onOutput: vi.fn(), onError: vi.fn() };

      handleStderrFallbackData(Buffer.from("first\nsecond"), state, callbacks, deps as any);

      expect(deps.stderrParser.parseStderrLine).toHaveBeenCalledWith("first", 1000);
      expect(deps.streamHandler.handleParsedLine).toHaveBeenCalledTimes(1);
      expect(state.stderrFallbackBuffer).toBe("second");
    });

    it("appends subsequent chunks to existing fallback buffer", () => {
      const state = createBaseState();
      state.stderrFallbackBuffer = "part";
      const deps = {
        ...createStreamDependencies(),
        stderrParser: {
          parseStderrLine: vi.fn((line: string) => ({ type: "text", line }) satisfies ParsedStderrOutput),
        },
      };
      const callbacks = { onOutput: vi.fn(), onError: vi.fn() };

      handleStderrFallbackData(Buffer.from("ial\n"), state, callbacks, deps as any);

      expect(deps.stderrParser.parseStderrLine).toHaveBeenCalledWith("partial", 1000);
      expect(state.stderrFallbackBuffer).toBe("");
    });

    it("skips empty fallback lines", () => {
      const state = createBaseState();
      const deps = {
        ...createStreamDependencies(),
        stderrParser: {
          parseStderrLine: vi.fn((line: string) => ({ type: "text", line }) satisfies ParsedStderrOutput),
        },
      };
      const callbacks = { onOutput: vi.fn(), onError: vi.fn() };

      handleStderrFallbackData(Buffer.from("\nreal\n"), state, callbacks, deps as any);

      expect(deps.stderrParser.parseStderrLine).toHaveBeenCalledTimes(1);
      expect(deps.stderrParser.parseStderrLine).toHaveBeenCalledWith("real", 1000);
    });
  });
});
