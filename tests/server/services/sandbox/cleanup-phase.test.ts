/**
 * Tests: cleanup-phase.ts
 * Phase 2.6 – Teilschritt 1: Cleanup-Verantwortlichkeiten extrahiert
 * 
 * Testet:
 * - flushMessageQueue()
 * - flushBatchers()
 * - cleanupDockerContainer()
 * - Error-Pfade und No-op-Pfade
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushMessageQueue, flushBatchers, cleanupDockerContainer } from "../../../../server/services/sandbox/execution-phases/cleanup-phase";
import type { ExecutionState } from "../../../../server/services/sandbox/execution-manager";
import type { PinStateBatcher } from "../../../../server/services/sandbox/pin-state-batcher";
import type { SerialOutputBatcher } from "../../../../server/services/sandbox/serial-output-batcher";

// Mocks für Dependencies
const createMockLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createMockProcessExecutor = () => ({
  execute: vi.fn(),
});

const createMockPinStateBatcher = () => ({
  stop: vi.fn(),
});

const createMockSerialOutputBatcher = () => ({
  stop: vi.fn(),
});

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
  state: "stopped" as any,
  processKilled: false,
  pendingCleanup: false,
  processController: {} as any,
  currentContainerName: undefined,
  dockerAvailable: undefined,
  dockerImageBuilt: undefined,
  outputCollector: undefined,
});

describe("cleanup-phase.ts", () => {
  describe("flushMessageQueue", () => {
    it("should do nothing when message queue is empty", () => {
      const state = createBaseState();
      state.messageQueue = [];

      flushMessageQueue(state);

      expect(state.messageQueue).toEqual([]);
    });

    it("should flush pinState messages to callback", () => {
      const state = createBaseState();
      const pinStateCalls: Array<{ pin: number; type: any; value: number }> = [];
      
      state.messageQueue = [
        { type: "pinState" as const, data: { pin: 13, stateType: "digital" as const, value: 1 } },
        { type: "pinState" as const, data: { pin: 12, stateType: "digital" as const, value: 0 } },
      ];
      state.pinStateCallback = (pin, type, value) => {
        pinStateCalls.push({ pin, type, value });
      };

      flushMessageQueue(state);

      expect(pinStateCalls).toHaveLength(2);
      expect(pinStateCalls[0]).toEqual({ pin: 13, type: "digital", value: 1 });
      expect(pinStateCalls[1]).toEqual({ pin: 12, type: "digital", value: 0 });
      expect(state.messageQueue).toEqual([]);
    });

    it("should flush output messages to callback", () => {
      const state = createBaseState();
      const outputCalls: Array<{ line: string; isComplete?: boolean }> = [];
      
      state.messageQueue = [
        { type: "output" as const, data: { line: "Hello", isComplete: false } },
        { type: "output" as const, data: { line: "World", isComplete: true } },
      ];
      state.onOutputCallback = (line, isComplete) => {
        outputCalls.push({ line, isComplete });
      };

      flushMessageQueue(state);

      expect(outputCalls).toHaveLength(2);
      expect(outputCalls[0]).toEqual({ line: "Hello", isComplete: false });
      expect(outputCalls[1]).toEqual({ line: "World", isComplete: true });
      expect(state.messageQueue).toEqual([]);
    });

    it("should flush error messages to callback", () => {
      const state = createBaseState();
      const errorCalls: string[] = [];
      
      state.messageQueue = [
        { type: "error" as const, data: { line: "Error 1" } },
        { type: "error" as const, data: { line: "Error 2" } },
      ];
      state.errorCallback = (line) => {
        errorCalls.push(line);
      };

      flushMessageQueue(state);

      expect(errorCalls).toHaveLength(2);
      expect(errorCalls[0]).toBe("Error 1");
      expect(errorCalls[1]).toBe("Error 2");
      expect(state.messageQueue).toEqual([]);
    });

    it("should handle mixed message types", () => {
      const state = createBaseState();
      const pinStateCalls: any[] = [];
      const outputCalls: any[] = [];
      const errorCalls: string[] = [];
      
      state.messageQueue = [
        { type: "pinState" as const, data: { pin: 13, stateType: "digital" as const, value: 1 } },
        { type: "output" as const, data: { line: "Output" } },
        { type: "error" as const, data: { line: "Error" } },
      ];
      state.pinStateCallback = (pin, type, value) => pinStateCalls.push({ pin, type, value });
      state.onOutputCallback = (line, isComplete) => outputCalls.push({ line, isComplete });
      state.errorCallback = (line) => errorCalls.push(line);

      flushMessageQueue(state);

      expect(pinStateCalls).toHaveLength(1);
      expect(outputCalls).toHaveLength(1);
      expect(errorCalls).toHaveLength(1);
      expect(state.messageQueue).toEqual([]);
    });

    it("should skip messages when callback is null", () => {
      const state = createBaseState();
      state.messageQueue = [
        { type: "pinState" as const, data: { pin: 13, stateType: "digital" as const, value: 1 } },
      ];
      state.pinStateCallback = null;

      flushMessageQueue(state);

      expect(state.messageQueue).toEqual([]);
    });
  });

  describe("flushBatchers", () => {
    it("should do nothing when batchers are null", () => {
      const state = createBaseState();
      state.pinStateBatcher = null;
      state.serialOutputBatcher = null;

      flushBatchers(state);

      expect(state.pinStateBatcher).toBeNull();
      expect(state.serialOutputBatcher).toBeNull();
    });

    it("should stop pinStateBatcher when present", () => {
      const state = createBaseState();
      const mockBatcher = createMockPinStateBatcher();
      state.pinStateBatcher = mockBatcher as any;
      state.serialOutputBatcher = null;

      flushBatchers(state);

      expect(mockBatcher.stop).toHaveBeenCalledTimes(1);
    });

    it("should stop serialOutputBatcher when present", () => {
      const state = createBaseState();
      const mockBatcher = createMockSerialOutputBatcher();
      state.pinStateBatcher = null;
      state.serialOutputBatcher = mockBatcher as any;

      flushBatchers(state);

      expect(mockBatcher.stop).toHaveBeenCalledTimes(1);
    });

    it("should stop both batchers when both present", () => {
      const state = createBaseState();
      const mockPinBatcher = createMockPinStateBatcher();
      const mockSerialBatcher = createMockSerialOutputBatcher();
      state.pinStateBatcher = mockPinBatcher as any;
      state.serialOutputBatcher = mockSerialBatcher as any;

      flushBatchers(state);

      expect(mockPinBatcher.stop).toHaveBeenCalledTimes(1);
      expect(mockSerialBatcher.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanupDockerContainer", () => {
    it("should do nothing when containerName is undefined", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();

      await cleanupDockerContainer(undefined, {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockExecutor.execute).not.toHaveBeenCalled();
    });

    it("should do nothing when containerName is empty string", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();

      await cleanupDockerContainer("", {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockExecutor.execute).not.toHaveBeenCalled();
    });

    it("should call docker rm -f with correct parameters", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();
      const containerName = "test-container-123";

      await cleanupDockerContainer(containerName, {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", containerName],
        { timeout: 5000, stdio: "pipe" }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(`Docker container cleanup: ${containerName}`);
    });

    it("should log success message after cleanup", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();
      const containerName = "test-container-456";

      await cleanupDockerContainer(containerName, {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(`Docker container cleanup: ${containerName}`);
    });

    it("should handle cleanup failure gracefully", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();
      const containerName = "test-container-789";
      const error = new Error("Docker not available");
      
      mockExecutor.execute.mockRejectedValueOnce(error);

      await cleanupDockerContainer(containerName, {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Docker cleanup failed for ${containerName}: ${error}`
      );
    });

    it("should handle non-Error exceptions gracefully", async () => {
      const mockExecutor = createMockProcessExecutor();
      const mockLogger = createMockLogger();
      const containerName = "test-container-abc";
      
      mockExecutor.execute.mockRejectedValueOnce("String error");

      await cleanupDockerContainer(containerName, {
        processExecutor: mockExecutor as any,
        logger: mockLogger as any,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Docker cleanup failed for ${containerName}: String error`
      );
    });
  });
});
