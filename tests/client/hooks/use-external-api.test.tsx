import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExternalApi, sendMessageToParent } from "../../../client/src/hooks/use-external-api";
import { SimulatorActionType } from "../../../client/src/types/external-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = "https://example.com";

/** Simulate an inbound postMessage with a given origin. */
function dispatchMessage(data: unknown, origin = ALLOWED_ORIGIN) {
  const event = new MessageEvent("message", { data, origin });
  window.dispatchEvent(event);
}

/** Build default mock params for the hook. */
const buildParams = () => ({
  allowedOrigin: ALLOWED_ORIGIN,
  onLoadCode: vi.fn<[string], void>(),
  onStartSimulation: vi.fn<[], void>(),
  onStopSimulation: vi.fn<[], void>(),
  onSetPinState: vi.fn<[number, number], void>(),
  getPinState: vi.fn<[number], number>(() => 1),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useExternalApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1: LOAD_CODE ────────────────────────────────────────────────────

  it("LOAD_CODE updates the editor content via onLoadCode callback", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({
        type: SimulatorActionType.LOAD_CODE,
        payload: { code: "void setup() {}" },
      });
    });

    expect(params.onLoadCode).toHaveBeenCalledOnce();
    expect(params.onLoadCode).toHaveBeenCalledWith("void setup() {}");
  });

  // ── Test 2: START_SIMULATION ─────────────────────────────────────────────

  it("START_SIMULATION triggers the handleCompileAndStart function", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({ type: SimulatorActionType.START_SIMULATION, payload: undefined });
    });

    expect(params.onStartSimulation).toHaveBeenCalledOnce();
  });

  // ── Test 3: SET_PIN_STATE ────────────────────────────────────────────────

  it("SET_PIN_STATE changes the value of a pin via onSetPinState callback", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({
        type: SimulatorActionType.SET_PIN_STATE,
        payload: { pin: 7, value: 1 },
      });
    });

    expect(params.onSetPinState).toHaveBeenCalledOnce();
    expect(params.onSetPinState).toHaveBeenCalledWith(7, 1);
  });

  // ── Test 4: Security – foreign origin is ignored ─────────────────────────

  it("ignores messages from a different origin (security check)", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage(
        { type: SimulatorActionType.START_SIMULATION, payload: undefined },
        "https://attacker.example.com",
      );
    });

    expect(params.onStartSimulation).not.toHaveBeenCalled();
  });

  // ── Test 5: STOP_SIMULATION ──────────────────────────────────────────────

  it("STOP_SIMULATION triggers the onStopSimulation callback", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({ type: SimulatorActionType.STOP_SIMULATION, payload: undefined });
    });

    expect(params.onStopSimulation).toHaveBeenCalledOnce();
  });

  // ── Test 6: GET_PIN_STATE ────────────────────────────────────────────────

  it("GET_PIN_STATE calls getPinState and posts a response", () => {
    const params = buildParams();
    const postMessageSpy = vi.spyOn(globalThis, "postMessage");
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({
        type: SimulatorActionType.GET_PIN_STATE,
        payload: { pin: 3 },
      });
    });

    expect(params.getPinState).toHaveBeenCalledWith(3);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GET_PIN_STATE", success: true, data: 1 }),
      ALLOWED_ORIGIN,
    );
  });

  // ── Test 7: Listener is removed on unmount ───────────────────────────────

  it("removes the message listener when the component unmounts", () => {
    const params = buildParams();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useExternalApi(params));

    const added = addSpy.mock.calls.find(([event]) => event === "message");
    const handler = added?.[1];
    expect(handler).toBeDefined();

    unmount();

    const removed = removeSpy.mock.calls.find(
      ([event, fn]) => event === "message" && fn === handler,
    );
    expect(removed).toBeDefined();
  });

  // ── Test 8: Wildcard origin ("*") allows all origins ────────────────────

  it("accepts messages from any origin when allowedOrigin is '*'", () => {
    const params = { ...buildParams(), allowedOrigin: "*" };
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage(
        { type: SimulatorActionType.START_SIMULATION, payload: undefined },
        "https://any-origin.com",
      );
    });

    expect(params.onStartSimulation).toHaveBeenCalledOnce();
  });

  // ── Test 9: Malformed / non-object message is silently ignored ───────────

  it("silently ignores non-object messages without throwing", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    expect(() => {
      act(() => {
        dispatchMessage("not-an-object");
      });
    }).not.toThrow();

    expect(params.onLoadCode).not.toHaveBeenCalled();
    expect(params.onStartSimulation).not.toHaveBeenCalled();
  });

  // ── Test 10: Unknown action type is silently ignored ─────────────────────

  it("silently ignores messages with an unknown action type", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({ type: "UNKNOWN_ACTION", payload: {} });
    });

    expect(params.onLoadCode).not.toHaveBeenCalled();
    expect(params.onStartSimulation).not.toHaveBeenCalled();
    expect(params.onSetPinState).not.toHaveBeenCalled();
  });
});

// ─── sendMessageToParent ──────────────────────────────────────────────────────

describe("sendMessageToParent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls window.postMessage with the correct target origin", () => {
    const spy = vi.spyOn(globalThis, "postMessage");
    const response = { type: "serial_output", success: true, data: "hello\n" };

    sendMessageToParent(response, ALLOWED_ORIGIN);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(response, ALLOWED_ORIGIN);
  });

  it("uses the provided target origin", () => {
    const spy = vi.spyOn(globalThis, "postMessage");
    const response = { type: "ping", success: true };

    sendMessageToParent(response, "*");

    expect(spy).toHaveBeenCalledWith(response, "*");
  });
});
