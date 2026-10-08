import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCompileAndRun, type CompileAndRunParams } from "../../../client/src/hooks/use-compile-and-run";
import { apiRequest } from "../../../client/src/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  return {
    promise,
    reject,
    complete: (success = true) => resolve(new Response(JSON.stringify({
      success, output: "compiled", ...(success ? {} : { errors: "old compile error" }),
    }), { headers: { "content-type": "application/json" } })),
  };
}

function setup() {
  const requests = [deferredResponse(), deferredResponse()];
  vi.mocked(apiRequest).mockImplementationOnce(() => requests[0].promise)
    .mockImplementationOnce(() => requests[1].promise);
  const params: CompileAndRunParams = {
    editorRef: { current: null },
    tabs: [{ id: "first", name: "sketch.ino", content: "void setup() {} void loop() {}" }],
    activeTabId: "first", code: "void setup() {} void loop() {}",
    setSerialOutput: vi.fn(), clearSerialOutput: vi.fn(), setParserMessages: vi.fn(),
    setParserPanelDismissed: vi.fn(), resetPinUI: vi.fn(), setIoRegistry: vi.fn(),
    setIsModified: vi.fn(), setDebugMessages: vi.fn(), addDebugMessage: vi.fn(),
    ensureBackendConnected: vi.fn(() => true), isBackendUnreachableError: vi.fn(() => false),
    triggerErrorGlitch: vi.fn(), toast: vi.fn(), sendMessage: vi.fn(),
    sendMessageImmediate: vi.fn(() => true), serialEventQueueRef: { current: [] },
    pendingPinConflicts: [], setPendingPinConflicts: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook((p) => useCompileAndRun(p), { initialProps: params, wrapper });
  const start = async () => {
    await act(async () => { hook.result.current.handleCompileAndStart(); });
  };
  const complete = async (index = 0, success = true) => {
    await act(async () => { requests[index].complete(success); });
    await waitFor(() => expect(client.isMutating()).toBe(0));
  };
  const starts = () => vi.mocked(params.sendMessageImmediate!).mock.calls
    .map(([message]) => message).filter((message) => message.type === "start_simulation");
  return { ...hook, params, requests, client, start, complete, starts };
}

describe("REST compile-to-start ownership", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([true, false])("does not start after Stop (backend reachable: %s)", async (reachable) => {
    const fixture = setup();
    await fixture.start();
    vi.mocked(fixture.params.ensureBackendConnected).mockReturnValue(reachable);
    act(() => fixture.result.current.handleStop());
    await fixture.complete();
    expect(fixture.starts()).toEqual([]);
    expect(fixture.params.setIsModified).not.toHaveBeenCalledWith(false);
  });

  it("does not start after the project is replaced", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.rerender({ ...fixture.params,
      tabs: [{ id: "replacement", name: "other.ino", content: "void setup() {} void loop() { delay(1); }" }],
      activeTabId: "replacement", code: "void setup() {} void loop() { delay(1); }",
    });
    await fixture.complete();
    expect(fixture.starts()).toEqual([]);
  });

  it("only starts the latest of two compile requests completed out of order", async () => {
    const fixture = setup();
    await fixture.start();
    await fixture.start();
    await act(async () => { fixture.requests[1].complete(); });
    await waitFor(() => expect(fixture.starts()).toHaveLength(1));
    await fixture.complete(0);
    expect(fixture.starts()).toHaveLength(1);
  });

  it("does not start again after a newer standalone Start", async () => {
    const fixture = setup();
    await fixture.start();
    await act(async () => { fixture.result.current.handleStart(); });
    await fixture.complete();
    expect(fixture.starts()).toHaveLength(1);
  });

  it("relinquishes ownership when the exposed Stop mutation is used directly", async () => {
    const fixture = setup();
    await fixture.start();
    act(() => fixture.result.current.stopMutation.mutate());
    await fixture.complete();
    expect(fixture.starts()).toEqual([]);
  });

  it("relinquishes ownership when the exposed Start mutation is used directly", async () => {
    const fixture = setup();
    await fixture.start();
    await act(async () => { await fixture.result.current.startMutation.mutateAsync(); });
    await fixture.complete();
    expect(fixture.starts()).toHaveLength(1);
  });

  it("does not let an old failing compile stop the newer running simulation", async () => {
    const fixture = setup();
    await fixture.start();
    await fixture.start();
    await act(async () => { fixture.requests[1].complete(); });
    await waitFor(() => expect(fixture.result.current.simulationStatus).toBe("running"));
    await fixture.complete(0, false);
    expect(fixture.result.current.simulationStatus).toBe("running");
    expect(fixture.result.current.hasCompilationErrors).toBe(false);
    expect(fixture.params.sendMessage).not.toHaveBeenCalledWith({ type: "stop_simulation" });
  });

  it("lets standalone Compile supersede an older compile-to-start result", async () => {
    const fixture = setup();
    await fixture.start();
    await act(async () => { fixture.result.current.handleCompile(); });
    await act(async () => { fixture.requests[1].complete(); });
    await fixture.complete(0, false);
    expect(fixture.starts()).toEqual([]);
    expect(fixture.result.current.hasCompilationErrors).toBe(false);
    expect(fixture.result.current.arduinoCliStatus).toBe("success");
  });

  it("does not start after unmount", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.unmount();
    await fixture.complete();
    expect(fixture.starts()).toEqual([]);
  });

  it.each(["offline Stop", "external code replacement"])("releases compile indicators after %s", async (cancellation) => {
    const fixture = setup();
    await fixture.start();
    expect(fixture.result.current.arduinoCliStatus).toBe("compiling");
    act(() => {
      if (cancellation === "offline Stop") {
        vi.mocked(fixture.params.ensureBackendConnected).mockReturnValue(false);
        fixture.result.current.handleStop();
      } else {
        fixture.result.current.invalidatePendingStart();
      }
    });
    expect(fixture.result.current.compilationStatus).toBe("ready");
    expect(fixture.result.current.arduinoCliStatus).toBe("idle");
    await fixture.complete();
    expect(fixture.result.current.compilationStatus).toBe("ready");
    expect(fixture.result.current.arduinoCliStatus).toBe("idle");
  });

  it("does not restore a busy indicator when Stop precedes mutation execution", async () => {
    const fixture = setup();
    await act(async () => {
      fixture.result.current.handleCompileAndStart();
      fixture.result.current.handleStop();
    });
    expect(fixture.result.current.compilationStatus).toBe("ready");
    expect(fixture.result.current.arduinoCliStatus).toBe("idle");
    await fixture.complete();
    expect(fixture.starts()).toEqual([]);
    expect(fixture.result.current.arduinoCliStatus).toBe("idle");
  });

  it("does not restart when Stop cancels a delayed Reset", async () => {
    const fixture = setup();
    vi.useFakeTimers();
    try {
      act(() => {
        fixture.result.current.handleReset();
        fixture.result.current.handleStop();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(apiRequest).not.toHaveBeenCalled();
      expect(fixture.starts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a new compile-to-start requested immediately after Stop", async () => {
    const fixture = setup();
    await fixture.start();
    await act(async () => {
      fixture.result.current.handleStop();
      fixture.result.current.handleCompileAndStart();
    });
    await act(async () => { fixture.requests[0].complete(); });
    await fixture.complete(1);
    expect(fixture.starts()).toHaveLength(1);
  });

  it("keeps the captured source when ordinary editor contents change", async () => {
    const fixture = setup();
    await fixture.start();
    fixture.rerender({ ...fixture.params, code: "edited while compiling" });
    await fixture.complete();
    expect(fixture.starts()).toEqual([{
      type: "start_simulation", timeout: 60, code: fixture.params.tabs[0].content,
    }]);
  });

  it("does not mistake navigation within the same project for replacement", async () => {
    const fixture = setup();
    const tabs = [...fixture.params.tabs, { id: "header", name: "pins.h", content: "#define PIN 13" }];
    fixture.rerender({ ...fixture.params, tabs });
    await fixture.start();
    fixture.rerender({ ...fixture.params, tabs: tabs.map((tab) => ({ ...tab })),
      activeTabId: "header", code: "#define PIN 13",
    });
    await fixture.complete();
    expect(fixture.starts()).toHaveLength(1);
    expect(fixture.starts()[0]).toMatchObject({ headers: [{ name: "pins.h", content: "#define PIN 13" }] });
  });

  it("ignores an old transport error after the replacement compile succeeds", async () => {
    const fixture = setup();
    await fixture.start();
    await fixture.start();
    await act(async () => { fixture.requests[1].complete(); });
    await waitFor(() => expect(fixture.result.current.simulationStatus).toBe("running"));
    vi.mocked(fixture.params.toast).mockClear();
    await act(async () => { fixture.requests[0].reject(new Error("old connection error")); });
    await waitFor(() => expect(fixture.client.isMutating()).toBe(0));
    expect(fixture.result.current.simulationStatus).toBe("running");
    expect(fixture.result.current.arduinoCliStatus).toBe("success");
    expect(fixture.params.toast).not.toHaveBeenCalled();
  });
});

describe("one server lifecycle per connection", () => {
  beforeEach(() => vi.resetAllMocks());

  const immediateMessages = (params: CompileAndRunParams) =>
    vi.mocked(params.sendMessageImmediate!).mock.calls.map(([message]) => message.type);

  it.each(["running", "paused", "queued"] as const)(
    "stops a %s simulation before Compile/Upload starts a new one",
    async (status) => {
      const fixture = setup();
      act(() => fixture.result.current.setSimulationStatus(status));
      await fixture.start();
      await fixture.complete();
      expect(immediateMessages(fixture.params)).toEqual(["stop_simulation", "start_simulation"]);
    },
  );

  it("does not send a stop when no simulation is held", async () => {
    const fixture = setup();
    await fixture.start();
    await fixture.complete();
    expect(immediateMessages(fixture.params)).toEqual(["start_simulation"]);
  });

  it("stops a paused simulation before Reset restarts it", async () => {
    const fixture = setup();
    act(() => fixture.result.current.setSimulationStatus("paused"));
    vi.useFakeTimers();
    try {
      act(() => fixture.result.current.handleReset());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    } finally {
      vi.useRealTimers();
    }
    await fixture.complete();
    const sent = immediateMessages(fixture.params);
    expect(sent.at(-1)).toBe("start_simulation");
    expect(sent.indexOf("stop_simulation")).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf("stop_simulation")).toBeLessThan(sent.indexOf("start_simulation"));
  });
});
