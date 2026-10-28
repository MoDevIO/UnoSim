/**
 * The polling loop draws the pins of the selected board (plan P5.4): the Mega's 54 digital pins and A0–A15, not the Uno's 0–13 and A0–A5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MutableRefObject, RefObject } from "react";
import { usePinPollingEngine } from "@/hooks/usePinPollingEngine";
import type { PinState } from "@/components/features/arduino-board";
import { setActiveBoard } from "@/lib/active-board";

/** One pin of the Mega drawing: state dot, input frame and click area, named as the generated overlay names them. */
const pinParts = (name: string, x: number) =>
  `<circle id="pin-${name}-state" cx="${x}" cy="8" r="2.5" fill="#000"/>
   <rect id="pin-${name}-frame" x="${x - 3.5}" y="4.5" width="7" height="7" style="display:none"/>
   <rect id="pin-${name}-click" x="${x - 4}" y="3" width="8" height="10"/>`;

const NAMES = ["0", "13", "21", "40", "53", "A0", "A8", "A15"];
const OVERLAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 414.4 221.2">
  <defs><filter id="glow-red"/><filter id="glow-yellow"/><filter id="glow-green"/></defs>
  ${NAMES.map((name, index) => pinParts(name, 10 + index * 12)).join("\n")}
  <rect id="led-l" x="40" y="78" width="5" height="2.6"/>
</svg>`;

function mount(pinStates: PinState[], analogPins: number[] = []) {
  const container = document.createElement("div");
  container.innerHTML = OVERLAY;
  document.body.appendChild(container);
  const overlayRef = { current: container } as RefObject<HTMLElement>;
  const stateRef: MutableRefObject<{ pinStates: PinState[]; isSimulationRunning: boolean; txBlink: boolean; rxBlink: boolean; analogPins: number[]; showPWMValues: boolean }> = {
    current: { pinStates, isSimulationRunning: true, txBlink: false, rxBlink: false, analogPins, showPWMValues: false },
  };
  const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
  const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };
  renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
  act(() => {
    vi.advanceTimersByTime(20);
  });
  const get = (id: string) => container.querySelector<SVGElement>(`#${id}`);
  return { container, get };
}

describe("usePinPollingEngine on the Mega 2560", () => {
  const containers: HTMLElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    setActiveBoard("mega2560");
  });

  afterEach(() => {
    vi.useRealTimers();
    setActiveBoard("uno");
    for (const container of containers.splice(0)) container.remove();
  });

  it("lights the state dot of a digital pin above 13", () => {
    const { container, get } = mount([{ pin: 40, mode: "OUTPUT", value: 1, type: "digital" }, { pin: 53, mode: "OUTPUT", value: 0, type: "digital" }]);
    containers.push(container);

    expect(get("pin-40-state")?.getAttribute("fill")).toMatch(/^rgb\(/);
    expect(get("pin-53-state")?.getAttribute("fill")).toBe("var(--color-black)");
  });

  it("shows the input frame of pin 21 and A15 while the simulation runs", () => {
    const { container, get } = mount(
      [{ pin: 21, mode: "INPUT_PULLUP", value: 1, type: "digital" }, { pin: 69, mode: "INPUT", value: 300, type: "analog" }],
      [69],
    );
    containers.push(container);

    expect(get("pin-21-frame")?.style.display).toBe("block");
    expect(get("pin-A15-frame")?.style.display).toBe("block");
    expect(get("pin-A8-frame")?.style.display).toBe("none"); // not used
  });

  it("lights the state dot of A8 when the sketch drives pin 62 high", () => {
    const { container, get } = mount([{ pin: 62, mode: "OUTPUT", value: 1, type: "digital" }]);
    containers.push(container);

    expect(get("pin-A8-state")?.getAttribute("fill")).toMatch(/^rgb\(/);
    expect(get("pin-A15-state")?.getAttribute("fill") ?? "").not.toMatch(/^rgb\(/);
  });

  it("keeps updating the elements it found first when the page calls back later", () => {
    const states: PinState[] = [{ pin: 13, mode: "OUTPUT", value: 1, type: "digital" }];
    const { container, get } = mount(states);
    containers.push(container);
    const dot = get("pin-13-state");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(get("pin-13-state")).toBe(dot);
    expect(dot?.getAttribute("fill")).toMatch(/^rgb\(/);
  });
});
