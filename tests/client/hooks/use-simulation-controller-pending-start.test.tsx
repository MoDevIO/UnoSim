import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSimulationImage } from "@unosim/avr-emulator/image";
import type { RuntimeKind } from "@shared/boards";
import { useSimulationController } from "../../../client/src/hooks/use-simulation-controller";

/**
 * A browser start waits for the emulator code to load. Stop, a new workspace or a discarded build in that
 * time must end it: the run must not start afterwards, and not with the build it was made for.
 */
const hex = readFileSync(join(__dirname, "../../../packages/avr-emulator/tests/fixtures/uno-serial_probe.hex"), "utf8");
const artifact = { ...buildSimulationImage({ board: "uno", hex }), buildId: "c".repeat(64) };

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

function setup() {
  const runtime = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), reset: vi.fn() };
  let release: () => void = () => undefined;
  const loaded = new Promise<void>((resolve) => { release = resolve; });
  let active: RuntimeKind | undefined;
  const runtimeHub = {
    load: vi.fn(async () => { await loaded; return runtime; }),
    peek: vi.fn(() => runtime),
    setActive: vi.fn((kind) => { active = kind; }),
    get active() { return active; },
  };
  const params = {
    code: "", hasCompilationErrors: false, ensureBackendConnected: vi.fn(() => true), sendMessage: vi.fn(), sendMessageImmediate: vi.fn(() => false),
    resetPinUI: vi.fn(), clearOutputs: vi.fn(), serialEventQueueRef: { current: [] }, pendingPinConflicts: [],
    uiFeedback: {
      logStopSimulation: vi.fn(), logPauseSimulation: vi.fn(), logResumeSimulation: vi.fn(), logStartSimulation: vi.fn(), logStartSimulationFallback: vi.fn(),
      showSimulationStartedToast: vi.fn(), showStartFailedToast: vi.fn(), showCodeModifiedToast: vi.fn(), showPauseFailedToast: vi.fn(),
      showResumeFailedToast: vi.fn(), showPinConflictWarning: vi.fn(), extractErrorMessage: vi.fn(() => "error"),
    },
    runtimeKind: "browser" as const, runtimeHub,
  };
  const hook = renderHook(() => useSimulationController(params as never), { wrapper: wrapper() });
  const startAndWaitForLoad = async () => {
    act(() => {
      hook.result.current.setCompiledArtifact(artifact);
      hook.result.current.handleStart();
    });
    await waitFor(() => expect(runtimeHub.load).toHaveBeenCalled());
  };
  const finishLoad = async () => {
    await act(async () => { release(); await loaded; });
  };
  return { runtime, runtimeHub, hook, startAndWaitForLoad, finishLoad };
}

describe("a browser start that is still loading the emulator", () => {
  it("does not start after Stop", async () => {
    const { runtime, runtimeHub, hook, startAndWaitForLoad, finishLoad } = setup();
    await startAndWaitForLoad();

    act(() => { hook.result.current.handleStop(); });
    await finishLoad();

    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtimeHub.setActive).not.toHaveBeenCalled();
    expect(hook.result.current.simulationStatus).toBe("idle");
  });

  it("does not start after the pending start was cancelled (new workspace, loaded example, replaced code)", async () => {
    const { runtime, hook, startAndWaitForLoad, finishLoad } = setup();
    await startAndWaitForLoad();

    act(() => {
      hook.result.current.cancelPendingStart();
      hook.result.current.setCompiledArtifact(undefined); // the build is discarded with it
    });
    await finishLoad();

    expect(runtime.start).not.toHaveBeenCalled();
    expect(hook.result.current.simulationStatus).not.toBe("queued");
  });

  it("starts with the build the start was made for", async () => {
    const { runtime, hook, startAndWaitForLoad, finishLoad } = setup();
    await startAndWaitForLoad();

    await finishLoad();

    await waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "browser", artifact }));
    expect(hook.result.current.simulationStatus).toBe("queued");
  });

  it("lets a new start win over a cancelled one", async () => {
    const { runtime, hook, startAndWaitForLoad, finishLoad } = setup();
    await startAndWaitForLoad();
    act(() => { hook.result.current.handleStop(); });

    act(() => { hook.result.current.handleStart(); });
    await finishLoad();

    await waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
  });
});
