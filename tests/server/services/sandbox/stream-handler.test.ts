import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamHandler } from "../../../../server/services/sandbox/stream-handler";

// Minimal mock for IProcessController
const createMockController = () => ({
  kill: vi.fn(),
  pid: 1234,
});

// Minimal mock for StreamHandlerState
const createMockState = (overrides: Record<string, unknown> = {}) => ({
  pinStateBatcher: null,
  serialOutputBatcher: null,
  backpressurePaused: false,
  isPaused: false,
  baudrate: 9600,
  registryManager: {
    startCollection: vi.fn(),
    finishCollection: vi.fn(),
    addPin: vi.fn(),
    updatePinMode: vi.fn(),
  },
  ...overrides,
});

const createMockCallbacks = () => ({
  onPinState: vi.fn(),
  onOutput: vi.fn(),
  onError: vi.fn(),
});

describe("StreamHandler", () => {
  let handler: StreamHandler;
  let controller: ReturnType<typeof createMockController>;

  beforeEach(() => {
    controller = createMockController();
    handler = new StreamHandler(controller as any);
  });

  describe("handlePinStateChange", () => {
    it("routes through batcher when available", () => {
      const batcher = { enqueue: vi.fn() };
      const state = createMockState({ pinStateBatcher: batcher });
      const callbacks = createMockCallbacks();

      handler.handlePinStateChange(13, "mode", 1, state as any, callbacks);

      expect(batcher.enqueue).toHaveBeenCalledWith(13, "mode", 1);
      expect(callbacks.onPinState).not.toHaveBeenCalled();
    });

    it("falls back to callback when no batcher", () => {
      const state = createMockState();
      const callbacks = createMockCallbacks();

      handler.handlePinStateChange(13, "value", 255, state as any, callbacks);

      expect(callbacks.onPinState).toHaveBeenCalledWith(13, "value", 255);
    });

    it("does nothing when no batcher and no callback", () => {
      const state = createMockState();
      expect(() =>
        handler.handlePinStateChange(13, "pwm", 128, state as any, {}),
      ).not.toThrow();
    });
  });

  describe("handleSerialEvent", () => {
    it("routes through serialOutputBatcher when available", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => false) };
      const state = createMockState({ serialOutputBatcher: batcher });
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("Hello", state as any, callbacks);

      expect(batcher.enqueue).toHaveBeenCalledWith("Hello");
      expect(callbacks.onOutput).not.toHaveBeenCalled();
    });

    it("falls back to onOutput when no batcher", () => {
      const state = createMockState();
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("test data", state as any, callbacks);

      expect(callbacks.onOutput).toHaveBeenCalledWith("test data", true);
    });

    it("activates backpressure when overloaded", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => true) };
      const state = createMockState({ serialOutputBatcher: batcher });
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("data", state as any, callbacks);

      expect(controller.kill).toHaveBeenCalledWith("SIGSTOP");
      expect(state.backpressurePaused).toBe(true);
    });

    it("skips backpressure when already paused", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => true) };
      const state = createMockState({
        serialOutputBatcher: batcher,
        backpressurePaused: true,
      });
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("data", state as any, callbacks);

      expect(controller.kill).not.toHaveBeenCalled();
    });

    it("skips backpressure at low baudrate", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => true) };
      const state = createMockState({
        serialOutputBatcher: batcher,
        baudrate: 300,
      });
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("data", state as any, callbacks);

      expect(controller.kill).not.toHaveBeenCalled();
    });

    it("skips backpressure when simulation isPaused", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => true) };
      const state = createMockState({
        serialOutputBatcher: batcher,
        isPaused: true,
      });
      const callbacks = createMockCallbacks();

      handler.handleSerialEvent("data", state as any, callbacks);

      expect(controller.kill).not.toHaveBeenCalled();
    });
  });

  describe("handleParsedLine", () => {
    it("handles registry_start", () => {
      const state = createMockState();
      handler.handleParsedLine({ type: "registry_start" }, state as any, {});
      expect(state.registryManager.startCollection).toHaveBeenCalled();
    });

    it("handles registry_end", () => {
      const state = createMockState();
      handler.handleParsedLine({ type: "registry_end" }, state as any, {});
      expect(state.registryManager.finishCollection).toHaveBeenCalled();
    });

    it("handles registry_pin", () => {
      const state = createMockState();
      const pinRecord = { pin: 13, isOutput: true, mode: 1, value: 0 };
      handler.handleParsedLine(
        { type: "registry_pin", pinRecord } as any,
        state as any,
        {},
      );
      expect(state.registryManager.addPin).toHaveBeenCalledWith(pinRecord);
    });

    it("handles pin_mode (updates registry + pin state)", () => {
      const batcher = { enqueue: vi.fn() };
      const state = createMockState({ pinStateBatcher: batcher });
      const callbacks = createMockCallbacks();

      handler.handleParsedLine(
        { type: "pin_mode", pin: 5, mode: 1 },
        state as any,
        callbacks,
      );

      expect(state.registryManager.updatePinMode).toHaveBeenCalledWith(5, 1);
      expect(batcher.enqueue).toHaveBeenCalledWith(5, "mode", 1);
    });

    it("handles pin_value", () => {
      const callbacks = createMockCallbacks();
      const state = createMockState();

      handler.handleParsedLine(
        { type: "pin_value", pin: 7, value: 512 },
        state as any,
        callbacks,
      );

      expect(callbacks.onPinState).toHaveBeenCalledWith(7, "value", 512);
    });

    it("handles pin_pwm", () => {
      const callbacks = createMockCallbacks();
      const state = createMockState();

      handler.handleParsedLine(
        { type: "pin_pwm", pin: 9, value: 200 },
        state as any,
        callbacks,
      );

      expect(callbacks.onPinState).toHaveBeenCalledWith(9, "pwm", 200);
    });

    it("handles serial_event", () => {
      const batcher = { enqueue: vi.fn(), isOverloaded: vi.fn(() => false) };
      const state = createMockState({ serialOutputBatcher: batcher });

      handler.handleParsedLine(
        { type: "serial_event", timestamp: 0, data: "abc" },
        state as any,
        {},
      );

      expect(batcher.enqueue).toHaveBeenCalledWith("abc");
    });

    it("handles ignored type without error", () => {
      const state = createMockState();
      expect(() =>
        handler.handleParsedLine({ type: "ignored" }, state as any, {}),
      ).not.toThrow();
    });

    it("handles text type by calling onError", () => {
      const state = createMockState();
      const callbacks = createMockCallbacks();

      handler.handleParsedLine(
        { type: "text", line: "some error" },
        state as any,
        callbacks,
      );

      expect(callbacks.onError).toHaveBeenCalledWith("some error");
    });
  });
});
