import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitSerialOutput, useExternalApi } from "../../../client/src/hooks/use-external-api";
import { API_VERSION, SimulatorActionType, SimulatorEventType } from "../../../client/src/types/external-api";

const ALLOWED_ORIGIN = "https://example.com";

const dispatchMessage = (data: unknown) => globalThis.dispatchEvent(new MessageEvent("message", { data, origin: ALLOWED_ORIGIN }));

const buildParams = () => ({
  allowedOrigin: ALLOWED_ORIGIN,
  onLoadCode: vi.fn<[string], void>(),
  onStartSimulation: vi.fn<[], void>(),
  onStopSimulation: vi.fn<[], void>(),
  onPauseSimulation: vi.fn<[], void>(),
  onResumeSimulation: vi.fn<[], void>(),
  onSetPinState: vi.fn<[number, number], void>(),
  getPinState: vi.fn<[number], number>(() => 1),
  onSerialInput: vi.fn<[string, number?], void>(),
  onSetSimulationTimeout: vi.fn<[number], void>(),
  onSetOutputTab: vi.fn<[string], void>(),
  getSimulationState: vi.fn<[], string>(() => "IDLE"),
});

const mega = () => ({ board: "mega2560" as const, boardName: "Arduino Mega 2560", runtime: "browser" as const, serialPorts: 4 });
const lastResponse = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe("external API with the serial ports of the Mega 2560 (plan P5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET_STATE reports the number of serial ports: 4 on the Mega, 1 without board information", () => {
    const post = vi.spyOn(globalThis, "postMessage");
    const withBoard = { ...buildParams(), getBoardInfo: mega };
    const { unmount } = renderHook(() => useExternalApi(withBoard));
    act(() => dispatchMessage({ type: SimulatorActionType.GET_STATE, payload: undefined }));
    expect(lastResponse(post)).toMatchObject({ data: { board: "mega2560", serialPorts: 4 } });
    unmount();

    renderHook(() => useExternalApi(buildParams()));
    act(() => dispatchMessage({ type: SimulatorActionType.GET_STATE, payload: undefined }));
    expect(lastResponse(post)).toMatchObject({ data: { board: "uno", serialPorts: 1 } });
  });

  it("SERIAL_INPUT without a port goes to Serial, as before", () => {
    const params = { ...buildParams(), getBoardInfo: mega };
    renderHook(() => useExternalApi(params));

    act(() => dispatchMessage({ type: SimulatorActionType.SERIAL_INPUT, payload: { data: "hi\n" } }));
    act(() => dispatchMessage({ type: SimulatorActionType.SERIAL_INPUT, payload: { data: "zero\n", port: 0 } }));

    expect(params.onSerialInput.mock.calls).toEqual([["hi\n"], ["zero\n"]]);
  });

  it("SERIAL_INPUT with a port sends to Serial1 to Serial3 of the Mega", () => {
    const post = vi.spyOn(globalThis, "postMessage");
    const params = { ...buildParams(), getBoardInfo: mega };
    renderHook(() => useExternalApi(params));

    act(() => dispatchMessage({ type: SimulatorActionType.SERIAL_INPUT, payload: { data: "x", port: 3 } }));

    expect(params.onSerialInput).toHaveBeenCalledWith("x", 3);
    expect(lastResponse(post)).toMatchObject({ type: SimulatorActionType.SERIAL_INPUT, success: true });
  });

  it.each([[1, 1], [4, 4], [-1, 4], [1.5, 4], ["1", 4], [1, undefined]] as const)("SERIAL_INPUT refuses port %j on a board with %j serial ports", (port, serialPorts) => {
    const post = vi.spyOn(globalThis, "postMessage");
    const params = { ...buildParams(), getBoardInfo: () => ({ board: "uno" as const, boardName: "Arduino UNO", ...(serialPorts === undefined ? {} : { serialPorts }) }) };
    renderHook(() => useExternalApi(params));

    act(() => dispatchMessage({ type: SimulatorActionType.SERIAL_INPUT, payload: { data: "x", port } }));

    expect(params.onSerialInput).not.toHaveBeenCalled();
    expect(lastResponse(post)).toMatchObject({
      success: false,
      error: `payload.port must be an integer from 0 to ${(serialPorts ?? 1) - 1}`,
    });
  });

  it("SET_PIN_STATE accepts the pins 0–69 of the Mega and refuses 70", () => {
    const post = vi.spyOn(globalThis, "postMessage");
    const params = { ...buildParams(), getBoardInfo: mega };
    renderHook(() => useExternalApi(params));

    act(() => dispatchMessage({ type: SimulatorActionType.SET_PIN_STATE, payload: { pin: 69, value: 1 } }));
    expect(params.onSetPinState).toHaveBeenCalledWith(69, 1);

    act(() => dispatchMessage({ type: SimulatorActionType.SET_PIN_STATE, payload: { pin: 70, value: 1 } }));
    expect(lastResponse(post)).toMatchObject({ success: false, error: "pin 70 does not exist on Arduino Mega 2560" });
  });

  it("emits SERIAL_OUTPUT_EVENT with the port only for Serial1 to Serial3", () => {
    const parent = vi.spyOn(globalThis, "postMessage");

    emitSerialOutput("zero");
    emitSerialOutput("one", 1);

    expect(parent.mock.calls.map(([event]) => event)).toEqual([
      { version: API_VERSION, type: SimulatorEventType.SERIAL_OUTPUT_EVENT, success: true, data: "zero" },
      { version: API_VERSION, type: SimulatorEventType.SERIAL_OUTPUT_EVENT, port: 1, success: true, data: "one" },
    ]);
  });
});
