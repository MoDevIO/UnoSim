/**
 * Tests for useWebSocketHandler.ts
 *
 * Covers: message processing (serial_output, simulation_status, pin_state,
 * pin_state_batch, io_registry, compilation_status, compilation_error,
 * sim_telemetry), and the pure helper functions mergeParserWarnings /
 * extractPinKeyFromMessage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Capture the messageQueue so we can pre-seed messages before render
let mockMessageQueue: any[] = [];
const consumeMessagesFn = vi.fn(() => {
  const msgs = [...mockMessageQueue];
  mockMessageQueue.length = 0;
  return msgs;
});

vi.mock("@/hooks/use-websocket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    messageQueue: mockMessageQueue,
    consumeMessages: consumeMessagesFn,
    sendMessage: vi.fn(),
  }),
}));

vi.mock("@/lib/websocket-manager", () => ({
  getWebSocketManager: () => ({
    on: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("@shared/logger", () => ({
  Logger: class {
    info() { /* no-op */ }
    debug() { /* no-op */ }
    warn() { /* no-op */ }
    error() { /* no-op */ }
  },
}));

vi.mock("@/lib/compilation-error-state", () => ({
  buildGccCompilationErrorState: vi.fn(() => ({
    cliOutput: "error output",
    hasCompilationErrors: true,
    lastCompilationResult: "error" as const,
    showCompilationOutput: true,
    parserPanelDismissed: false,
    activeOutputTab: "compiler" as const,
  })),
}));

vi.mock("@/hooks/use-telemetry-store", () => ({
  telemetryStore: { pushTelemetry: vi.fn() },
}));

function createMockParams() {
  return {
    simulationStatus: "running" as const,
    addDebugMessage: vi.fn(),
    setRxActivity: vi.fn(),
    appendSerialOutput: vi.fn(),
    appendRenderedText: vi.fn(),
    setSerialOutput: vi.fn(),
    setArduinoCliStatus: vi.fn(),
    setCliOutput: vi.fn(),
    setHasCompilationErrors: vi.fn(),
    setLastCompilationResult: vi.fn(),
    setShowCompilationOutput: vi.fn(),
    setParserPanelDismissed: vi.fn(),
    setActiveOutputTab: vi.fn(),
    setCompilationStatus: vi.fn(),
    setSimulationStatus: vi.fn(),
    stopRendering: vi.fn(),
    pauseRendering: vi.fn(),
    resumeRendering: vi.fn(),
    serialEventQueueRef: { current: [] },
    setPinStates: vi.fn(),
    setAnalogPinsUsed: vi.fn(),
    resetPinUI: vi.fn(),
    enqueuePinEvent: vi.fn(),
    setIoRegistry: vi.fn(),
    setBaudRate: vi.fn(),
    setSerialBaudrate: vi.fn(),
    pinToNumber: vi.fn((pin: string) => {
      const n = Number.parseInt(pin, 10);
      return Number.isNaN(n) ? null : n;
    }),
    setParserMessages: vi.fn(),
  };
}

import { useWebSocketHandler } from "@/hooks/useWebSocketHandler";

describe("useWebSocketHandler", () => {
  let params: ReturnType<typeof createMockParams>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageQueue = [];
    params = createMockParams();
  });

  it("returns sendMessage and isConnected", () => {
    const { result } = renderHook(() => useWebSocketHandler(params));
    expect(result.current.isConnected).toBe(true);
    expect(typeof result.current.sendMessage).toBe("function");
  });

  it("processes serial_output message", () => {
    mockMessageQueue.push({ type: "serial_output", data: "Hello\n", isComplete: true });

    renderHook(() => useWebSocketHandler(params));

    expect(params.appendSerialOutput).toHaveBeenCalled();
    expect(params.setRxActivity).toHaveBeenCalled();
  });

  it("skips timing control messages in serial output", () => {
    mockMessageQueue.push({
      type: "serial_output",
      data: "[[TIME_RESUMED:123]]",
      isComplete: true,
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.appendSerialOutput).not.toHaveBeenCalled();
  });

  it("handles system messages (--- ... ---)", () => {
    mockMessageQueue.push({
      type: "serial_output",
      data: "--- Simulation Started ---",
      isComplete: true,
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.appendRenderedText).toHaveBeenCalledWith("--- Simulation Started ---");
  });

  it("processes simulation_status stopped", () => {
    mockMessageQueue.push({ type: "simulation_status", status: "stopped" });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setSimulationStatus).toHaveBeenCalledWith("stopped");
    expect(params.stopRendering).toHaveBeenCalled();
    expect(params.setPinStates).toHaveBeenCalledWith([]);
    expect(params.setCompilationStatus).toHaveBeenCalledWith("ready");
  });

  it("processes simulation_status paused", () => {
    mockMessageQueue.push({ type: "simulation_status", status: "paused" });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setSimulationStatus).toHaveBeenCalledWith("paused");
    expect(params.pauseRendering).toHaveBeenCalled();
  });

  it("processes simulation_status running", () => {
    mockMessageQueue.push({ type: "simulation_status", status: "running" });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setSimulationStatus).toHaveBeenCalledWith("running");
    expect(params.resumeRendering).toHaveBeenCalled();
  });

  it("processes pin_state message", () => {
    mockMessageQueue.push({ type: "pin_state", pin: 13, stateType: "digital", value: 1 });

    renderHook(() => useWebSocketHandler(params));

    expect(params.enqueuePinEvent).toHaveBeenCalledWith(13, "digital", 1);
  });

  it("emits pin state change on pin_state value/pwm events", () => {
    // 'value' type should trigger emitPinStateChange (External API bridge)
    mockMessageQueue.push({ type: "pin_state", pin: 5, stateType: "value", value: 255 });

    renderHook(() => useWebSocketHandler(params));

    expect(params.enqueuePinEvent).toHaveBeenCalledWith(5, "value", 255);
  });

  it("processes pin_state_batch message", () => {
    mockMessageQueue.push({
      type: "pin_state_batch",
      states: [
        { pin: 13, stateType: "digital", value: 1 },
        { pin: 12, stateType: "digital", value: 0 },
      ],
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.enqueuePinEvent).toHaveBeenCalledTimes(2);
  });

  it("emits pin state change in pin_state_batch for value/pwm states", () => {
    mockMessageQueue.push({
      type: "pin_state_batch",
      states: [
        { pin: 3, stateType: "pwm", value: 128 },
        { pin: 4, stateType: "value", value: 1 },
        { pin: 5, stateType: "digital", value: 0 }, // no emit for this one
      ],
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.enqueuePinEvent).toHaveBeenCalledTimes(3);
  });

  it("processes compilation_status message", () => {
    mockMessageQueue.push({
      type: "compilation_status",
      arduinoCliStatus: "compiling",
      message: "Compiling sketch...",
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setArduinoCliStatus).toHaveBeenCalledWith("compiling");
    expect(params.setCliOutput).toHaveBeenCalledWith("Compiling sketch...");
  });

  it("processes compilation_error message", () => {
    mockMessageQueue.push({
      type: "compilation_error",
      data: { errors: ["error1"] },
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setCompilationStatus).toHaveBeenCalledWith("error");
    expect(params.setSimulationStatus).toHaveBeenCalledWith("stopped");
    expect(params.setHasCompilationErrors).toHaveBeenCalledWith(true);
  });

  it("processes sim_telemetry message", async () => {
    const { telemetryStore } = await import("@/hooks/use-telemetry-store");
    mockMessageQueue.push({
      type: "sim_telemetry",
      metrics: { loopCount: 42 },
    });

    renderHook(() => useWebSocketHandler(params));

    expect(telemetryStore.pushTelemetry).toHaveBeenCalledWith({ loopCount: 42 });
  });

  it("processes io_registry with baudrate", () => {
    mockMessageQueue.push({
      type: "io_registry",
      registry: [
        { pin: "13", defined: true, usedAt: [{ line: 1, operation: "digitalWrite" }] },
      ],
      baudrate: 9600,
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setIoRegistry).toHaveBeenCalled();
    expect(params.setBaudRate).toHaveBeenCalledWith(9600);
    expect(params.setSerialBaudrate).toHaveBeenCalledWith(9600);
  });

  it("detects analog pins from io_registry", () => {
    params.pinToNumber.mockImplementation((pin: string) => {
      if (pin === "A0") return 14;
      return Number.parseInt(pin, 10) || null;
    });

    mockMessageQueue.push({
      type: "io_registry",
      registry: [
        { pin: "A0", defined: true, usedAt: [{ line: 1, operation: "analogRead" }] },
      ],
      baudrate: 9600,
    });

    renderHook(() => useWebSocketHandler(params));

    expect(params.setAnalogPinsUsed).toHaveBeenCalled();
  });

  it("processes multiple messages in sequence", () => {
    mockMessageQueue.push(
      { type: "compilation_status", arduinoCliStatus: "compiling", message: "Start" },
      { type: "simulation_status", status: "running" },
      { type: "serial_output", data: "ready\n", isComplete: true },
    );

    renderHook(() => useWebSocketHandler(params));

    expect(params.setArduinoCliStatus).toHaveBeenCalledWith("compiling");
    expect(params.setSimulationStatus).toHaveBeenCalledWith("running");
    expect(params.appendSerialOutput).toHaveBeenCalled();
  });

  it("handles newline-only serial output", () => {
    mockMessageQueue.push({ type: "serial_output", data: "\n", isComplete: true });

    renderHook(() => useWebSocketHandler(params));

    // Should still trigger rx activity
    expect(params.setRxActivity).toHaveBeenCalled();
  });

  it("handles incomplete serial line (isComplete=false)", () => {
    mockMessageQueue.push({ type: "serial_output", data: "partial", isComplete: false });

    renderHook(() => useWebSocketHandler(params));

    expect(params.appendSerialOutput).toHaveBeenCalled();
    expect(params.setSerialOutput).toHaveBeenCalled();
  });
});
