import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExternalApi, sendMessageToParent, sendEventToParent, emitPinStateChange, emitSimulationStateEvent } from "../../../client/src/hooks/use-external-api";
import { SimulatorActionType, SimulatorEventType, API_VERSION } from "../../../client/src/types/external-api";

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
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ ...response, version: API_VERSION }),
      ALLOWED_ORIGIN,
    );
  });

  it("uses the provided target origin", () => {
    const spy = vi.spyOn(globalThis, "postMessage");
    const response = { type: "ping", success: true };

    sendMessageToParent(response, "*");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ ...response, version: API_VERSION }),
      "*",
    );
  });
});

// ─── API Versioning Tests ────────────────────────────────────────────────────

describe("API Versioning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sendMessageToParent includes API_VERSION in response", () => {
    const spy = vi.spyOn(globalThis, "postMessage");
    const response = { type: "test_response", success: true };

    sendMessageToParent(response, ALLOWED_ORIGIN);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ version: API_VERSION }),
      ALLOWED_ORIGIN,
    );
  });

  it("GET_PIN_STATE response includes version", () => {
    const params = { ...buildParams() };
    const postSpy = vi.spyOn(globalThis, "postMessage");
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({
        type: SimulatorActionType.GET_PIN_STATE,
        payload: { pin: 5 },
      });
    });

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: API_VERSION,
        type: SimulatorActionType.GET_PIN_STATE,
      }),
      ALLOWED_ORIGIN,
    );
  });
});

// ─── Batch-Operations Tests ──────────────────────────────────────────────────

describe("BATCH_SET_PIN_STATE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes BATCH_SET_PIN_STATE with multiple pins", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    act(() => {
      dispatchMessage({
        type: SimulatorActionType.BATCH_SET_PIN_STATE,
        payload: {
          pins: [
            { pin: 7, value: 1 },
            { pin: 8, value: 0 },
            { pin: 9, value: 1 },
          ],
        },
      });
    });

    // Verify all three pins were set
    expect(params.onSetPinState).toHaveBeenCalledTimes(3);
    expect(params.onSetPinState).toHaveBeenNthCalledWith(1, 7, 1);
    expect(params.onSetPinState).toHaveBeenNthCalledWith(2, 8, 0);
    expect(params.onSetPinState).toHaveBeenNthCalledWith(3, 9, 1);
  });

  it("silently handles empty pins array in BATCH_SET_PIN_STATE", () => {
    const params = buildParams();
    renderHook(() => useExternalApi(params));

    expect(() => {
      act(() => {
        dispatchMessage({
          type: SimulatorActionType.BATCH_SET_PIN_STATE,
          payload: { pins: [] },
        });
      });
    }).not.toThrow();

    expect(params.onSetPinState).not.toHaveBeenCalled();
  });
});

// ─── Event-Push System Tests ─────────────────────────────────────────────────

describe("Event-Push System (sendEventToParent)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sendEventToParent sends PIN_STATE_CHANGE_EVENT with version", () => {
    const spy = vi.spyOn(globalThis, "postMessage");

    sendEventToParent(
      {
        version: API_VERSION,
        type: SimulatorEventType.PIN_STATE_CHANGE_EVENT,
        success: true,
        data: { pin: 13, value: 1 },
      },
      ALLOWED_ORIGIN,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: API_VERSION,
        type: SimulatorEventType.PIN_STATE_CHANGE_EVENT,
        data: { pin: 13, value: 1 },
      }),
      ALLOWED_ORIGIN,
    );
  });

  it("sendEventToParent sends SIMULATION_STATE_EVENT", () => {
    const spy = vi.spyOn(globalThis, "postMessage");

    sendEventToParent(
      {
        version: API_VERSION,
        type: SimulatorEventType.SIMULATION_STATE_EVENT,
        success: true,
        data: { state: "RUNNING", message: "Simulation started" },
      },
      ALLOWED_ORIGIN,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: API_VERSION,
        type: SimulatorEventType.SIMULATION_STATE_EVENT,
        data: expect.objectContaining({ state: "RUNNING" }),
      }),
      ALLOWED_ORIGIN,
    );
  });

  it("event message includes version for compatibility tracking", () => {
    const spy = vi.spyOn(globalThis, "postMessage");

    sendEventToParent(
      {
        version: API_VERSION,
        type: SimulatorEventType.PIN_STATE_CHANGE_EVENT,
        success: true,
        data: { pin: 7, value: 0 },
      },
      "*",
    );

    const callArgs = spy.mock.calls[0];
    expect(callArgs[0]).toHaveProperty("version");
    expect(callArgs[0].version).toBe(API_VERSION);
  });
});

// ─── emitPinStateChange ──────────────────────────────────────────────────────

describe("emitPinStateChange", () => {
  afterEach(vi.restoreAllMocks);

  it("posts a PIN_STATE_CHANGE_EVENT with correct pin and value", () => {
    const spy = vi.spyOn(window.parent, "postMessage");

    emitPinStateChange(13, 1);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: API_VERSION,
        type: SimulatorEventType.PIN_STATE_CHANGE_EVENT,
        success: true,
        data: { pin: 13, value: 1 },
      }),
      expect.any(String),
    );
  });

  it("silently ignores postMessage errors", () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {
      throw new Error("cross-origin blocked");
    });

    expect(() => emitPinStateChange(7, 0)).not.toThrow();
  });
});

// ─── emitSimulationStateEvent ────────────────────────────────────────────────

describe("emitSimulationStateEvent", () => {
  afterEach(vi.restoreAllMocks);

  it("posts a SIMULATION_STATE_EVENT with the given state", () => {
    const spy = vi.spyOn(window.parent, "postMessage");

    emitSimulationStateEvent("RUNNING");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: API_VERSION,
        type: SimulatorEventType.SIMULATION_STATE_EVENT,
        success: true,
        data: expect.objectContaining({ state: "RUNNING" }),
      }),
      expect.any(String),
    );
  });

  it("includes optional message when provided", () => {
    const spy = vi.spyOn(window.parent, "postMessage");

    emitSimulationStateEvent("ERROR", "Sketch crashed");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "ERROR", message: "Sketch crashed" }),
      }),
      expect.any(String),
    );
  });

  it("silently ignores postMessage errors", () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {
      throw new Error("cross-origin blocked");
    });

    expect(() => emitSimulationStateEvent("STOPPED")).not.toThrow();
  });
});
