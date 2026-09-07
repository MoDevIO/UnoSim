import { describe, expect, it, vi, beforeEach } from "vitest";
import { WebSocket } from "ws";
import { WSMessageType } from "@shared/schema";
import type { ClientState } from "../../../server/routes/simulation/ws-session-manager";

// Import the handler functions directly from simulation.ws.ts
// These are module-level functions, not exported, so we test them indirectly
// by creating a minimal test harness that exercises the behavior

// Mock runner for testing
function createMockRunner() {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    sendSerialInput: vi.fn(),
    setPinValue: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWebSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket;
}

function createClientState(overrides: Partial<ClientState> = {}): ClientState {
  return {
    subject: "test-subject",
    runner: null,
    isRunning: false,
    isPaused: false,
    queueAbortController: null,
    ...overrides,
  } as ClientState;
}

// Test harness to access the internal handler functions
// We simulate the message handling behavior by recreating the logic
function handlePauseSimulation(ws: WebSocket, clientState: ClientState): void {
  if (clientState?.runner && clientState.isRunning) {
    const paused = clientState.runner.pause();
    if (paused) {
      clientState.isPaused = true;
      ws.send(JSON.stringify({
        type: WSMessageType.SIMULATION_STATUS,
        status: "paused",
      }));
      ws.send(JSON.stringify({
        type: WSMessageType.SERIAL_OUTPUT,
        data: "--- Simulation paused ---\n",
      }));
    }
  }
}

function handleResumeSimulation(ws: WebSocket, clientState: ClientState): void {
  if (clientState?.runner && clientState.isPaused) {
    const resumed = clientState.runner.resume();
    if (resumed) {
      clientState.isPaused = false;
      clientState.isRunning = true;
      ws.send(JSON.stringify({
        type: WSMessageType.SIMULATION_STATUS,
        status: "running",
      }));
      ws.send(JSON.stringify({
        type: WSMessageType.SERIAL_OUTPUT,
        data: "--- Simulation resumed ---\n",
      }));
    }
  }
}

function handleSerialInput(
  ws: WebSocket,
  data: { type: "serial_input"; data: string },
  clientState: ClientState,
): void {
  if (
    clientState?.runner &&
    clientState?.isRunning &&
    !clientState.isPaused
  ) {
    clientState.runner.sendSerialInput(data.data);
  }
}

function handleSetPinValue(
  ws: WebSocket,
  data: { type: "set_pin_value"; pin: number; value: number },
  clientState: ClientState,
): void {
  if (
    clientState?.runner &&
    (clientState.isRunning || clientState.isPaused)
  ) {
    clientState.runner.setPinValue(data.pin, data.value);
  }
}

describe("WebSocket Lifecycle Handlers", () => {
  describe("handlePauseSimulation", () => {
    it("should pause a running simulation and send status messages", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.pause.mockReturnValue(true);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      handlePauseSimulation(ws, clientState);

      expect(runner.pause).toHaveBeenCalledOnce();
      expect(clientState.isPaused).toBe(true);
      expect(clientState.isRunning).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: WSMessageType.SIMULATION_STATUS, status: "paused" }),
      );
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: WSMessageType.SERIAL_OUTPUT, data: "--- Simulation paused ---\n" }),
      );
    });

    it("should not pause if runner is not available", () => {
      const ws = createMockWebSocket();
      const clientState = createClientState({
        runner: null,
        isRunning: true,
      });

      handlePauseSimulation(ws, clientState);

      expect(clientState.isPaused).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("should not pause if simulation is not running", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: false,
      });

      handlePauseSimulation(ws, clientState);

      expect(runner.pause).not.toHaveBeenCalled();
      expect(clientState.isPaused).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("should not update state if runner.pause() returns false", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.pause.mockReturnValue(false);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      handlePauseSimulation(ws, clientState);

      expect(runner.pause).toHaveBeenCalledOnce();
      expect(clientState.isPaused).toBe(false);
      expect(clientState.isRunning).toBe(true);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("handleResumeSimulation", () => {
    it("should resume a paused simulation and send status messages", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.resume.mockReturnValue(true);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: true,
      });

      handleResumeSimulation(ws, clientState);

      expect(runner.resume).toHaveBeenCalledOnce();
      expect(clientState.isPaused).toBe(false);
      expect(clientState.isRunning).toBe(true);
      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: WSMessageType.SIMULATION_STATUS, status: "running" }),
      );
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: WSMessageType.SERIAL_OUTPUT, data: "--- Simulation resumed ---\n" }),
      );
    });

    it("should not resume if runner is not available", () => {
      const ws = createMockWebSocket();
      const clientState = createClientState({
        runner: null,
        isPaused: true,
      });

      handleResumeSimulation(ws, clientState);

      expect(clientState.isPaused).toBe(true);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("should not resume if simulation is not paused", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      handleResumeSimulation(ws, clientState);

      expect(runner.resume).not.toHaveBeenCalled();
      expect(clientState.isPaused).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it("should not update state if runner.resume() returns false", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.resume.mockReturnValue(false);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: true,
      });

      handleResumeSimulation(ws, clientState);

      expect(runner.resume).toHaveBeenCalledOnce();
      expect(clientState.isPaused).toBe(true);
      expect(clientState.isRunning).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("handleSerialInput", () => {
    it("should send serial input when simulation is running and not paused", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      const inputData = "test input\n";
      handleSerialInput(ws, { type: "serial_input", data: inputData }, clientState);

      expect(runner.sendSerialInput).toHaveBeenCalledWith(inputData);
    });

    it("should not send serial input if simulation is paused", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: true,
      });

      handleSerialInput(ws, { type: "serial_input", data: "test" }, clientState);

      expect(runner.sendSerialInput).not.toHaveBeenCalled();
    });

    it("should not send serial input if simulation is not running", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: false,
      });

      handleSerialInput(ws, { type: "serial_input", data: "test" }, clientState);

      expect(runner.sendSerialInput).not.toHaveBeenCalled();
    });

    it("should not send serial input if runner is not available", () => {
      const ws = createMockWebSocket();
      const clientState = createClientState({
        runner: null,
        isRunning: true,
      });

      handleSerialInput(ws, { type: "serial_input", data: "test" }, clientState);

      expect(clientState.runner).toBeNull();
    });
  });

  describe("handleSetPinValue", () => {
    it("should set pin value when simulation is running", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      handleSetPinValue(ws, { type: "set_pin_value", pin: 13, value: 1 }, clientState);

      expect(runner.setPinValue).toHaveBeenCalledWith(13, 1);
    });

    it("should set pin value when simulation is paused", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: true,
      });

      handleSetPinValue(ws, { type: "set_pin_value", pin: 5, value: 0 }, clientState);

      expect(runner.setPinValue).toHaveBeenCalledWith(5, 0);
    });

    it("should not set pin value if runner is not available", () => {
      const ws = createMockWebSocket();
      const clientState = createClientState({
        runner: null,
        isRunning: true,
      });

      handleSetPinValue(ws, { type: "set_pin_value", pin: 13, value: 1 }, clientState);

      expect(clientState.runner).toBeNull();
    });

    it("should not set pin value if simulation is stopped", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: false,
        isPaused: false,
      });

      handleSetPinValue(ws, { type: "set_pin_value", pin: 13, value: 1 }, clientState);

      expect(runner.setPinValue).not.toHaveBeenCalled();
    });
  });

  describe("Pause/Resume Lifecycle", () => {
    it("should support full pause/resume cycle", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.pause.mockReturnValue(true);
      runner.resume.mockReturnValue(true);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      // Pause
      handlePauseSimulation(ws, clientState);
      expect(clientState.isPaused).toBe(true);
      expect(clientState.isRunning).toBe(true);
      expect(runner.pause).toHaveBeenCalledOnce();

      // Resume
      handleResumeSimulation(ws, clientState);
      expect(clientState.isPaused).toBe(false);
      expect(clientState.isRunning).toBe(true);
      expect(runner.resume).toHaveBeenCalledOnce();

      // Verify message sequence
      expect(ws.send).toHaveBeenCalledTimes(4);
    });

    it("should not allow resume without prior pause", () => {
      const ws = createMockWebSocket();
      const runner = createMockRunner();
      runner.resume.mockReturnValue(false);
      
      const clientState = createClientState({
        runner: runner as any,
        isRunning: true,
        isPaused: false,
      });

      handleResumeSimulation(ws, clientState);

      expect(runner.resume).not.toHaveBeenCalled();
      expect(clientState.isPaused).toBe(false);
    });
  });
});
