import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSimulationImage } from "@unosim/avr-emulator/image";
import type { Command } from "@unosim/avr-emulator/protocol";
import type { RuntimeKind } from "@shared/boards";
import { useSimulationController } from "../../../client/src/hooks/use-simulation-controller";
import { BrowserRuntime, type EmulatorWorker } from "../../../client/src/lib/runtime/browser-runtime";
import { createRuntimeCommandRouter } from "../../../client/src/lib/runtime/runtime-commands";

/**
 * Editing the code while the run is starting (the emulator is loading, or the worker has not yet confirmed
 * the run) stops it like an edit of a running sketch: the confirmation that comes later must not start the
 * old source.
 */
const hex = readFileSync(join(__dirname, "../../../packages/avr-emulator/tests/fixtures/uno-serial_probe.hex"), "utf8");
const artifact = { ...buildSimulationImage({ board: "uno", hex }), buildId: "c".repeat(64) };

class FakeWorker implements EmulatorWorker {
  readonly sent: Command[] = [];
  terminated = false;
  private listener: (event: { data: unknown }) => void = () => undefined;
  postMessage(command: Command): void { this.sent.push(command); }
  terminate(): void { this.terminated = true; }
  addEventListener(type: "message" | "error" | "messageerror", listener: never): void { if (type === "message") this.listener = listener; }
  emit(event: unknown): void { this.listener({ data: event }); }
  last<T extends Command["type"]>(type: T): Extract<Command, { type: T }> {
    const found = [...this.sent].reverse().find((command) => command.type === type);
    if (!found) throw new Error(`no ${type} command sent`);
    return found as Extract<Command, { type: T }>;
  }
}

/** Lets the effects and the stop they may start run to the end. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

function setup(initial: { code: string; sourceSignature?: string } = { code: "void loop() {}" }) {
  const worker = new FakeWorker();
  const runtime = new BrowserRuntime({ createWorker: () => worker });
  let active: RuntimeKind | undefined;
  const hub = { load: vi.fn(async () => runtime), peek: vi.fn(() => runtime), setActive: vi.fn((kind) => { active = kind; }), get active() { return active; } };
  const router = createRuntimeCommandRouter(hub as never);
  const sendMessage = vi.fn((message: never) => router.route(message));
  const params = {
    hasCompilationErrors: false, ensureBackendConnected: vi.fn(() => true), sendMessage, sendMessageImmediate: vi.fn(() => false),
    resetPinUI: vi.fn(), clearOutputs: vi.fn(), serialEventQueueRef: { current: [] }, pendingPinConflicts: [],
    uiFeedback: {
      logStopSimulation: vi.fn(), logPauseSimulation: vi.fn(), logResumeSimulation: vi.fn(), logStartSimulation: vi.fn(), logStartSimulationFallback: vi.fn(),
      showSimulationStartedToast: vi.fn(), showStartFailedToast: vi.fn(), showCodeModifiedToast: vi.fn(), showPauseFailedToast: vi.fn(),
      showResumeFailedToast: vi.fn(), showPinConflictWarning: vi.fn(), extractErrorMessage: vi.fn(() => "error"),
    },
    runtimeKind: "browser" as const, runtimeHub: hub,
  };
  const hook = renderHook(
    ({ code, sourceSignature }: { code: string; sourceSignature?: string }) =>
      useSimulationController({ ...params, code, ...(sourceSignature === undefined ? {} : { sourceSignature }) } as never),
    { wrapper: wrapper(), initialProps: initial },
  );
  // What the WebSocket handler does with the runtime's status events.
  runtime.subscribe((event) => {
    if (event.type === "simulation_status") act(() => hook.result.current.setSimulationStatus(event.status === "stopped" ? "idle" : event.status));
  });
  const start = async () => {
    act(() => {
      hook.result.current.setCompiledArtifact(artifact);
      hook.result.current.handleStart();
    });
    await waitFor(() => expect(hook.result.current.simulationStatus).toBe("queued"));
  };
  const confirmRun = () => {
    const load = worker.last("load");
    worker.emit({ type: "ready", runId: load.runId, protocolVersion: 1, board: "uno", buildId: artifact.buildId });
    const startCommand = worker.sent.find((command) => command.type === "start");
    if (startCommand) worker.emit({ type: "status", runId: startCommand.runId, state: "running" });
  };
  return { worker, hook, start, confirmRun, hub };
}

describe("which changes stop a browser run", () => {
  const files = (sketch: string, header: string) => JSON.stringify([sketch, header]);
  const runningRun = async (initial?: { code: string; sourceSignature?: string }) => {
    const context = setup(initial);
    await context.start();
    context.confirmRun();
    await waitFor(() => expect(context.hook.result.current.simulationStatus).toBe("running"));
    return context;
  };

  it("keeps the run when another tab is opened: the shown code changes, the files of the project do not", async () => {
    const { hook } = await runningRun({ code: "void loop() {}", sourceSignature: files("void loop() {}", "const int A = 1;") });

    hook.rerender({ code: "const int A = 1;", sourceSignature: files("void loop() {}", "const int A = 1;") }); // the header tab is shown
    await settle();

    expect(hook.result.current.simulationStatus).toBe("running");
  });

  it("stops the run when a file other than the shown one is edited", async () => {
    const { hook } = await runningRun({ code: "void loop() {}", sourceSignature: files("void loop() {}", "const int A = 1;") });

    hook.rerender({ code: "void loop() {}", sourceSignature: files("void loop() {}", "const int A = 2;") });

    await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));
  });

  it("without a project signature the shown code decides, as before", async () => {
    const { hook } = await runningRun();

    hook.rerender({ code: "void loop() { /* edited */ }" });

    await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));
  });
});

describe("an edit while the browser run is starting", () => {
  it("stops the run that waits for the emulator, and the late confirmation does not start the old source", async () => {
    const { worker, hook, start, confirmRun } = setup();
    await start();

    hook.rerender({ code: "void loop() { /* edited */ }" });
    await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));
    confirmRun();

    expect(hook.result.current.simulationStatus).toBe("idle");
    expect(worker.terminated).toBe(true); // the starting worker is ended, not left to run the old source
  });

  it("stops the run the worker has started but not yet confirmed", async () => {
    const { worker, hook, start } = setup();
    await start();
    const load = worker.last("load");
    worker.emit({ type: "ready", runId: load.runId, protocolVersion: 1, board: "uno", buildId: artifact.buildId });
    expect(worker.last("start")).toBeDefined(); // started, not confirmed

    hook.rerender({ code: "void loop() { /* edited */ }" });
    await waitFor(() => expect(hook.result.current.simulationStatus).toBe("idle"));
    worker.emit({ type: "status", runId: worker.last("start").runId, state: "running" }); // the late confirmation

    expect(hook.result.current.simulationStatus).toBe("idle");
  });

  it("does not stop a run for an edit before it was started", async () => {
    const { hook } = setup();

    hook.rerender({ code: "void loop() { /* edited */ }" });

    expect(hook.result.current.simulationStatus).toBe("idle");
  });
});
