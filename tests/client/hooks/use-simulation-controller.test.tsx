import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSimulationImage } from "@unosim/avr-emulator/image";
import type { RuntimeKind } from "@shared/boards";
import { useSimulationController } from "../../../client/src/hooks/use-simulation-controller";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const buildParams = () => ({
  code: "",
  hasCompilationErrors: false,
  ensureBackendConnected: vi.fn(() => true),
  sendMessage: vi.fn(),
  sendMessageImmediate: vi.fn(() => false),
  resetPinUI: vi.fn(),
  clearOutputs: vi.fn(),
  serialEventQueueRef: { current: [] as Array<{ payload: never; receivedAt: number }> },
  pendingPinConflicts: [],
  uiFeedback: {
    logStopSimulation: vi.fn(),
    logPauseSimulation: vi.fn(),
    logResumeSimulation: vi.fn(),
    logStartSimulation: vi.fn(),
    logStartSimulationFallback: vi.fn(),
    showSimulationStartedToast: vi.fn(),
    showStartFailedToast: vi.fn(),
    showCodeModifiedToast: vi.fn(),
    showPauseFailedToast: vi.fn(),
    showResumeFailedToast: vi.fn(),
    showPinConflictWarning: vi.fn(),
    extractErrorMessage: vi.fn(() => "error"),
  },
});

describe("useSimulationController", () => {
  it("sends compiled code and falls back to buffered WebSocket delivery", async () => {
    const params = buildParams();
    const { result } = renderHook(() => useSimulationController(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setCompiledCode("compiled sketch");
      result.current.handleStart();
    });

    await waitFor(() => expect(result.current.simulationStatus).toBe("running"));
    expect(params.sendMessageImmediate).toHaveBeenCalledWith({
      type: "start_simulation",
      timeout: 60,
      code: "compiled sketch",
    });
    expect(params.sendMessage).toHaveBeenCalledWith({
      type: "start_simulation",
      timeout: 60,
      code: "compiled sketch",
    });
    expect(params.uiFeedback.logStartSimulationFallback).toHaveBeenCalledOnce();
  });

  it("performs synchronous stop cleanup for reset callers", () => {
    const params = buildParams();
    const { result } = renderHook(() => useSimulationController(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.stopSimulationImmediately();
    });

    expect(params.sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(params.serialEventQueueRef.current).toEqual([]);
    expect(params.resetPinUI).toHaveBeenCalledWith({ keepDetected: true });
    expect(result.current.simulationStatus).toBe("idle");
  });

  describe("browser emulation (plan P3.4)", () => {
    const hex = readFileSync(join(__dirname, "../../../packages/avr-emulator/tests/fixtures/uno-serial_probe.hex"), "utf8");
    const artifact = { ...buildSimulationImage({ board: "uno", hex }), buildId: "c".repeat(64) };

    function browserSetup(overrides: { hostMockUsable?: boolean } = {}) {
      const runtime = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), reset: vi.fn() };
      let active: RuntimeKind | undefined;
      const runtimeHub = { load: vi.fn(async () => runtime), peek: vi.fn(() => runtime), setActive: vi.fn((kind) => { active = kind; }), get active() { return active; } };
      const params = { ...buildParams(), runtimeKind: "browser" as const, runtimeHub, ...overrides };
      const hook = renderHook(() => useSimulationController(params as never), { wrapper: createWrapper() });
      return { params, runtime, runtimeHub, hook };
    }

    it("starts the artifact in the browser runtime, without any server message and without the connection check", async () => {
      const { params, runtime, hook } = browserSetup();

      act(() => {
        hook.result.current.setCompiledArtifact(artifact);
        hook.result.current.handleStart();
      });

      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));
      expect(runtime.start).toHaveBeenCalledWith({ kind: "browser", artifact, timeoutSec: 60 });
      expect(params.sendMessage).not.toHaveBeenCalled();
      expect(params.sendMessageImmediate).not.toHaveBeenCalled();
      expect(params.ensureBackendConnected).not.toHaveBeenCalled();
    });

    it("falls back to the host mock when the build has no image and the server offers it", async () => {
      const { params, runtime, runtimeHub, hook } = browserSetup({ hostMockUsable: true });

      act(() => {
        hook.result.current.setCompiledCode("compiled sketch");
        hook.result.current.setCompiledArtifact({ not: "an artifact" });
        hook.result.current.handleStart();
      });

      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));
      expect(runtime.start).not.toHaveBeenCalled();
      expect(runtimeHub.setActive).toHaveBeenLastCalledWith("host-mock");
      expect(params.sendMessageImmediate).toHaveBeenCalledWith(expect.objectContaining({ type: "start_simulation", code: "compiled sketch" }));
    });

    it("reports a start without an image when the host mock is not available either", async () => {
      const { params, runtime, hook } = browserSetup({ hostMockUsable: false });

      act(() => {
        hook.result.current.handleStart();
      });

      await waitFor(() => expect(params.uiFeedback.showStartFailedToast).toHaveBeenCalled());
      expect(runtime.start).not.toHaveBeenCalled();
      expect(hook.result.current.simulationStatus).toBe("idle");
    });

    it("pauses, resumes and stops a browser run without the connection check", async () => {
      const { params, hook } = browserSetup();
      act(() => {
        hook.result.current.setCompiledArtifact(artifact);
        hook.result.current.handleStart();
      });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));

      act(() => { hook.result.current.handlePause(); });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("paused"));
      act(() => { hook.result.current.handleResume(); });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));
      act(() => { hook.result.current.handleStop(); });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));

      expect(params.ensureBackendConnected).not.toHaveBeenCalled();
    });

    it("still stops, pauses and resumes a browser run while the browser reports being offline", async () => {
      const { params, hook } = browserSetup();
      act(() => {
        hook.result.current.setCompiledArtifact(artifact);
        hook.result.current.handleStart();
      });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));

      onlineManager.setOnline(false);
      try {
        act(() => { hook.result.current.handlePause(); });
        await waitFor(() => expect(hook.result.current.simulationStatus).toBe("paused"));
        act(() => { hook.result.current.handleResume(); });
        await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));
        act(() => { hook.result.current.handleStop(); });
        await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));
        expect(params.sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("resets a running browser emulation without compiling again", async () => {
      const { params, runtime, hook } = browserSetup();
      expect(hook.result.current.resetWithoutCompile()).toBe(false); // nothing running
      act(() => {
        hook.result.current.setCompiledArtifact(artifact);
        hook.result.current.handleStart();
      });
      await waitFor(() => expect(hook.result.current.simulationStatus).toBe("running"));

      let done = false;
      act(() => { done = hook.result.current.resetWithoutCompile(); });

      expect(done).toBe(true);
      expect(runtime.reset).toHaveBeenCalledOnce();
      expect(params.clearOutputs).toHaveBeenCalled();
      expect(params.resetPinUI).toHaveBeenCalledWith({ keepDetected: true });
    });
  });
});
