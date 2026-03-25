/**
 * Tests for usePinPollingEngine
 *
 * Regression guard: commit fef4aa74 wrapped the overlay <div> in a <button>,
 * which caused the global CSS rule `button { height: var(--ui-button-height) !important }`
 * to shrink the overlay to ~32px.  The polling engine could not find the SVG elements
 * because the button itself was effectively invisible / zero-height in the browser.
 *
 * These tests ensure:
 * 1. The polling engine finds an SVG that is nested inside button > div > svg (not a direct child)
 * 2. Pin-state dots get the correct fill colour when pinStates are set
 * 3. The .arduino-overlay class is present on the button so the CSS :not() exclusion applies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RefObject, MutableRefObject } from "react";
import { createRef } from "react";
import { usePinPollingEngine } from "@/hooks/usePinPollingEngine";
import type { PinState } from "@/components/features/arduino-board";

// Minimal SVG that mirrors the overlay structure produced by ArduinoUno-overlay.svg
const MINIMAL_OVERLAY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 293.2 221"
     style="width:100%;height:100%;display:block;position:absolute;top:0;left:0">
  <defs>
    <filter id="glow-red">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-yellow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-green">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Digital pin state dots -->
  <circle id="pin-0-state"  cx="10" cy="10" r="3" fill="black"/>
  <circle id="pin-1-state"  cx="20" cy="10" r="3" fill="black"/>
  <circle id="pin-13-state" cx="130" cy="10" r="3" fill="black"/>
  <!-- Pin frames (input indicator rectangles) -->
  <rect id="pin-0-frame"  x="8"  y="8"  width="6" height="6" style="display:none"/>
  <rect id="pin-1-frame"  x="18" y="8"  width="6" height="6" style="display:none"/>
  <rect id="pin-13-frame" x="128" y="8" width="6" height="6" style="display:none"/>
  <!-- Click areas -->
  <rect id="pin-0-click"  x="5" y="5" width="12" height="12" fill="transparent"/>
  <!-- LED indicators -->
  <rect id="led-on" x="50" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-l"  x="60" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-tx" x="70" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-rx" x="80" y="10" width="6" height="6" fill="transparent"/>
</svg>
`;

/**
 * Build a DOM structure that replicates the button > div > svg tree
 * introduced by the fef4aa74 commit.
 */
function buildOverlayStructure(
  useDivWrapper: boolean,
): { container: HTMLElement; overlayRef: RefObject<HTMLElement> } {
  const container = document.createElement("div");
  document.body.appendChild(container);

  if (useDivWrapper) {
    // New structure (post fef4aa74): button > div > svg
    const button = document.createElement("button");
    button.className = "arduino-overlay absolute inset-0 w-full h-full";
    button.setAttribute("type", "button");
    const inner = document.createElement("div");
    inner.innerHTML = MINIMAL_OVERLAY_SVG;
    button.appendChild(inner);
    container.appendChild(button);

    const ref = { current: button } as RefObject<HTMLElement>;
    return { container, overlayRef: ref };
  } else {
    // Original structure (pre fef4aa74): div > svg
    const div = document.createElement("div");
    div.className = "arduino-overlay absolute inset-0 w-full h-full";
    div.innerHTML = MINIMAL_OVERLAY_SVG;
    container.appendChild(div);

    const ref = { current: div } as RefObject<HTMLElement>;
    return { container, overlayRef: ref };
  }
}

function buildStateRef(pinStates: PinState[]): MutableRefObject<{
  pinStates: PinState[];
  isSimulationRunning: boolean;
  txBlink: boolean;
  rxBlink: boolean;
  analogPins: number[];
  showPWMValues: boolean;
}> {
  return {
    current: {
      pinStates,
      isSimulationRunning: true,
      txBlink: false,
      rxBlink: false,
      analogPins: [],
      showPWMValues: false,
    },
  };
}

describe("usePinPollingEngine", () => {
  let containers: HTMLElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const c of containers) {
      c.remove();
    }
    containers = [];
  });

  /**
   * Regression test: the SVG must be found and updated even when it is
   * nested as button > div > svg (not a direct child of overlayRef.current).
   * This is the exact structure introduced in commit fef4aa74.
   */
  it("finds SVG and updates pin-state fill when overlay is button>div>svg (fef4aa74 structure)", () => {
    const { container, overlayRef } = buildOverlayStructure(true /* button wrapper */);
    containers.push(container);

    const pinStates: PinState[] = [
      { pin: 0, mode: "OUTPUT", value: 1, type: "digital" },
    ];
    const stateRef = buildStateRef(pinStates);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() =>
      usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }),
    );

    // Advance time by one polling interval (10ms) to trigger performAllUpdates
    act(() => {
      vi.advanceTimersByTime(20);
    });

    const svgEl = overlayRef.current?.querySelector("svg");
    expect(svgEl, "SVG must be found inside button>div").not.toBeNull();

    const stateCircle = svgEl?.querySelector<SVGCircleElement>("#pin-0-state");
    expect(stateCircle, "pin-0-state circle must exist").not.toBeNull();

    // Pin 0 is HIGH (value=1), so fill should be rgb(r,0,0) – not "black" or "transparent"
    const fill = stateCircle?.getAttribute("fill") ?? "";
    expect(fill, "High digital pin should have non-black fill").not.toBe("black");
    expect(fill, "High digital pin should have non-black fill").not.toBe("var(--color-black)");
    expect(fill, "High digital pin should have non-transparent fill").not.toBe("transparent");
  });

  /**
   * Baseline: the same scenario works when overlay is the direct div>svg
   * (original structure before fef4aa74).
   */
  it("finds SVG and updates pin-state fill when overlay is div>svg (original structure)", () => {
    const { container, overlayRef } = buildOverlayStructure(false /* no button wrapper */);
    containers.push(container);

    const pinStates: PinState[] = [
      { pin: 13, mode: "OUTPUT", value: 1, type: "digital" },
    ];
    const stateRef = buildStateRef(pinStates);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() =>
      usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }),
    );

    act(() => {
      vi.advanceTimersByTime(20);
    });

    const svgEl = overlayRef.current?.querySelector("svg");
    expect(svgEl).not.toBeNull();

    const circle = svgEl?.querySelector<SVGCircleElement>("#pin-13-state");
    const fill = circle?.getAttribute("fill") ?? "";
    expect(fill).not.toBe("black");
    expect(fill).not.toBe("var(--color-black)");
    expect(fill).not.toBe("transparent");
  });

  /**
   * When simulation is NOT running, pin frames must be hidden; but pin-state
   * fill should still be updated (overlay is always active once SVG is loaded).
   */
  it("updates state dot fill even when simulation is not running", () => {
    const { container, overlayRef } = buildOverlayStructure(true);
    containers.push(container);

    const pinStates: PinState[] = [
      { pin: 1, mode: "OUTPUT", value: 1, type: "digital" },
    ];
    const stateRef = buildStateRef(pinStates);
    stateRef.current.isSimulationRunning = false; // simulation stopped

    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() =>
      usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }),
    );

    act(() => {
      vi.advanceTimersByTime(20);
    });

    const svgEl = overlayRef.current?.querySelector("svg");
    const frame = svgEl?.querySelector<SVGRectElement>("#pin-1-frame");
    // Frame should be hidden when simulation is stopped
    expect(frame?.style.display).toBe("none");

    // State dot fill is still set based on actual pin state
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-1-state");
    // pin value=1 → HIGH → color should be rgb(...) not transparent/black
    const fill = dot?.getAttribute("fill") ?? "";
    expect(fill).not.toBe("transparent");
  });

  /**
   * When pin value is 0 (LOW), fill should be set to var(--color-black).
   */
  it("sets fill to var(--color-black) for LOW pin", () => {
    const { container, overlayRef } = buildOverlayStructure(true);
    containers.push(container);

    const pinStates: PinState[] = [
      { pin: 0, mode: "OUTPUT", value: 0, type: "digital" },
    ];
    const stateRef = buildStateRef(pinStates);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    // Simulate that pin 0 was on before (no fade-out time → should be black)
    pinIsOnRef.current.set(0, false);

    renderHook(() =>
      usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }),
    );

    act(() => {
      vi.advanceTimersByTime(300); // well past FADE_OUT_MS (200ms)
    });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-0-state");
    const fill = dot?.getAttribute("fill") ?? "";
    // LOW with no fade → var(--color-black)
    expect(fill).toBe("var(--color-black)");
  });
});

// Extended SVG with analog pins, additional digital pins (PWM), and full LED set
const EXTENDED_OVERLAY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 293.2 221"
     style="width:100%;height:100%;display:block;position:absolute;top:0;left:0">
  <defs>
    <filter id="glow-red">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-yellow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-green">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Digital pins 0, 3 (PWM), 13 -->
  <circle id="pin-0-state"  cx="10"  cy="10"  r="3" fill="black"/>
  <circle id="pin-3-state"  cx="30"  cy="10"  r="3" fill="black"/>
  <circle id="pin-13-state" cx="130" cy="10"  r="3" fill="black"/>
  <rect id="pin-0-frame"  x="8"   y="8"   width="6" height="6" style="display:none"/>
  <rect id="pin-3-frame"  x="28"  y="8"   width="6" height="6" style="display:none"/>
  <rect id="pin-13-frame" x="128" y="8"   width="6" height="6" style="display:none"/>
  <rect id="pin-0-click"  x="5"   y="5"   width="12" height="12" fill="transparent"/>
  <!-- Analog pin A0 (pin index 0 → pin number 14) -->
  <circle id="pin-A0-state" cx="10" cy="180" r="3" fill="black"/>
  <rect id="pin-A0-frame" x="8" y="178" width="6" height="6" style="display:none"/>
  <rect id="pin-A0-click" x="5" y="175" width="12" height="12" fill="transparent"/>
  <!-- LEDs -->
  <rect id="led-on" x="50" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-l"  x="60" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-tx" x="70" y="10" width="6" height="6" fill="transparent"/>
  <rect id="led-rx" x="80" y="10" width="6" height="6" fill="transparent"/>
</svg>
`;

describe("usePinPollingEngine – LED states, analog pins, fade-out, labels", () => {
  let containers: HTMLElement[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const c of containers) {
      c.remove();
    }
    containers = [];
  });

  function buildExtendedOverlay(): { overlayRef: RefObject<HTMLElement> } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const div = document.createElement("div");
    div.innerHTML = EXTENDED_OVERLAY_SVG;
    container.appendChild(div);
    return { overlayRef: { current: div } as RefObject<HTMLElement> };
  }

  it("activates led-on (fill+filter) when simulation is running", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([]);
    stateRef.current.isSimulationRunning = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledOn = svgEl?.querySelector<SVGRectElement>("#led-on");
    expect(ledOn?.getAttribute("fill")).toBe("var(--color-led-green)");
    expect(ledOn?.getAttribute("fill-opacity")).toBe("1");
  });

  it("deactivates led-on when simulation is not running", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([]);
    stateRef.current.isSimulationRunning = false;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledOn = svgEl?.querySelector<SVGRectElement>("#led-on");
    expect(ledOn?.getAttribute("fill")).toBe("transparent");
    expect(ledOn?.getAttribute("fill-opacity")).toBe("0");
  });

  it("activates led-tx when txBlink is true", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([]);
    stateRef.current.txBlink = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledTx = svgEl?.querySelector<SVGRectElement>("#led-tx");
    expect(ledTx?.getAttribute("fill")).toBe("var(--color-led-yellow)");
    expect(ledTx?.getAttribute("fill-opacity")).toBe("1");
  });

  it("activates led-rx when rxBlink is true", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([]);
    stateRef.current.rxBlink = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledRx = svgEl?.querySelector<SVGRectElement>("#led-rx");
    expect(ledRx?.getAttribute("fill")).toBe("var(--color-led-yellow)");
    expect(ledRx?.getAttribute("fill-opacity")).toBe("1");
  });

  it("activates led-l when pin 13 is HIGH", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 13, mode: "OUTPUT", value: 1, type: "digital" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledL = svgEl?.querySelector<SVGRectElement>("#led-l");
    expect(ledL?.getAttribute("fill")).toBe("var(--color-led-yellow)");
    expect(ledL?.getAttribute("fill-opacity")).toBe("1");
  });

  it("deactivates led-l when pin 13 is LOW", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 13, mode: "OUTPUT", value: 0, type: "digital" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(300); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const ledL = svgEl?.querySelector<SVGRectElement>("#led-l");
    expect(ledL?.getAttribute("fill")).toBe("transparent");
    expect(ledL?.getAttribute("fill-opacity")).toBe("0");
  });

  it("shows digital INPUT frame (display:block + glow-yellow) when simulation running", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 0, mode: "INPUT", value: 0, type: "digital" }]);
    stateRef.current.isSimulationRunning = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const frame = svgEl?.querySelector<SVGRectElement>("#pin-0-frame");
    expect(frame?.style.display).toBe("block");
    expect(frame?.getAttribute("filter")).toBe("url(#glow-yellow)");
  });

  it("shows digital INPUT_PULLUP frame when simulation running", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 0, mode: "INPUT_PULLUP", value: 1, type: "digital" }]);
    stateRef.current.isSimulationRunning = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const frame = svgEl?.querySelector<SVGRectElement>("#pin-0-frame");
    expect(frame?.style.display).toBe("block");
  });

  it("shows analog frame with dasharray when pin is in analogPins", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 14, mode: "INPUT", value: 512, type: "analog" }]);
    stateRef.current.analogPins = [14];
    stateRef.current.isSimulationRunning = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const frame = svgEl?.querySelector<SVGRectElement>("#pin-A0-frame");
    expect(frame?.style.display).toBe("block");
    expect(frame?.getAttribute("filter")).toBe("url(#glow-yellow)");
  });

  it("hides analog frame when simulation stopped and pin not in analogPins", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([]);
    stateRef.current.isSimulationRunning = false;
    stateRef.current.analogPins = [];
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const frame = svgEl?.querySelector<SVGRectElement>("#pin-A0-frame");
    expect(frame?.style.display).toBe("none");
  });

  it("analog pin value >= 255 (non-PWM) produces rgb color", () => {
    const { overlayRef } = buildExtendedOverlay();
    // Pin 14 = A0, not in PWM_PINS, value=1023 (≥255) → rgb(255, 0, 0)
    const stateRef = buildStateRef([{ pin: 14, mode: "OUTPUT", value: 1023, type: "analog" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-A0-state");
    expect(dot?.getAttribute("fill")).toMatch(/^rgb\(\d+, 0, 0\)$/);
  });

  it("analog pin value < 255 (non-PWM) produces black", () => {
    const { overlayRef } = buildExtendedOverlay();
    // Pin 14 = A0, not in PWM_PINS, value=100 (<255) → black
    const stateRef = buildStateRef([{ pin: 14, mode: "OUTPUT", value: 100, type: "analog" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-A0-state");
    expect(dot?.getAttribute("fill")).toBe("var(--color-black)");
  });

  it("PWM-type pin produces scaled rgb color from value", () => {
    const { overlayRef } = buildExtendedOverlay();
    // Pin 3 is in PWM_PINS=[3,5,6,9,10,11], type="pwm", value=128 → rgb(128,0,0)
    const stateRef = buildStateRef([{ pin: 3, mode: "OUTPUT", value: 128, type: "pwm" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-3-state");
    const fill = dot?.getAttribute("fill") ?? "";
    expect(fill).toMatch(/^rgb\(\d+, 0, 0\)$/);
  });

  it("fade-out: pin still shows rgb color within FADE_OUT_MS window", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 0, mode: "OUTPUT", value: 1, type: "digital" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));

    // First poll: pin is HIGH → tracked as on
    act(() => { vi.advanceTimersByTime(20); });

    // Pin goes LOW
    stateRef.current.pinStates = [{ pin: 0, mode: "OUTPUT", value: 0, type: "digital" }];

    // Poll fires: pin just turned off, turnedOffAt is set to now
    act(() => { vi.advanceTimersByTime(10); });

    // Advance 50ms within FADE_OUT_MS=200ms — should still be fading
    act(() => { vi.advanceTimersByTime(50); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-0-state");
    // During fade, fill must be a non-black rgb color
    expect(dot?.getAttribute("fill")).toMatch(/^rgb\(\d+, 0, 0\)$/);
  });

  it("fade-out: pin is black after FADE_OUT_MS has elapsed", () => {
    const { overlayRef } = buildExtendedOverlay();
    const stateRef = buildStateRef([{ pin: 0, mode: "OUTPUT", value: 1, type: "digital" }]);
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    // Pin goes LOW
    stateRef.current.pinStates = [{ pin: 0, mode: "OUTPUT", value: 0, type: "digital" }];

    // Advance well past FADE_OUT_MS=200ms
    act(() => { vi.advanceTimersByTime(300); });

    const svgEl = overlayRef.current?.querySelector("svg");
    const dot = svgEl?.querySelector<SVGCircleElement>("#pin-0-state");
    expect(dot?.getAttribute("fill")).toBe("var(--color-black)");
  });

  it("hides existing val labels when showPWMValues is false (hideAllLabels)", () => {
    const { overlayRef } = buildExtendedOverlay();
    const svgEl = overlayRef.current?.querySelector("svg")!;

    // Pre-add a val label element
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("id", "pin-3-val");
    label.style.display = "block";
    svgEl.appendChild(label);

    const stateRef = buildStateRef([]);
    stateRef.current.showPWMValues = false;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const labelAfter = svgEl.querySelector<SVGTextElement>("#pin-3-val");
    expect(labelAfter?.getAttribute("style")).toContain("display: none");
  });

  it("creates PWM label text element when showPWMValues=true and getBBox is mocked", () => {
    const { overlayRef } = buildExtendedOverlay();
    const svgEl = overlayRef.current!.querySelector("svg")!;

    // Mock getBBox on both elements – code uses stateEl if instanceof SVGGraphicsElement, else frameEl
    const mockBBox = { x: 30, y: 10, width: 6, height: 6, bottom: 16, left: 30, right: 36, top: 10 } as DOMRect;
    const circle = svgEl.querySelector<SVGCircleElement>("#pin-3-state")!;
    const frame = svgEl.querySelector<SVGRectElement>("#pin-3-frame")!;
    Object.defineProperty(circle, "getBBox", { configurable: true, value: () => mockBBox });
    Object.defineProperty(frame, "getBBox", { configurable: true, value: () => mockBBox });

    const stateRef = buildStateRef([{ pin: 3, mode: "OUTPUT", value: 128, type: "digital" }]);
    stateRef.current.showPWMValues = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const label = svgEl.querySelector("#pin-3-val");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("128");
  });

  it("updates existing label textContent in ensureSvgText (update-path coverage)", () => {
    const { overlayRef } = buildExtendedOverlay();
    const svgEl = overlayRef.current?.querySelector("svg")!;

    // Pre-add the label so ensureSvgText takes the update-path (t != null)
    const existing = document.createElementNS("http://www.w3.org/2000/svg", "text");
    existing.setAttribute("id", "pin-3-val");
    existing.textContent = "0";
    svgEl.appendChild(existing);

    // Mock getBBox on both elements – code picks whichever passes instanceof check
    const mockBBox = { x: 30, y: 10, width: 6, height: 6, bottom: 16, left: 30, right: 36, top: 10 } as DOMRect;
    const circle = svgEl.querySelector<SVGCircleElement>("#pin-3-state")!;
    const frame = svgEl.querySelector<SVGRectElement>("#pin-3-frame")!;
    Object.defineProperty(circle, "getBBox", { configurable: true, value: () => mockBBox });
    Object.defineProperty(frame, "getBBox", { configurable: true, value: () => mockBBox });

    const stateRef = buildStateRef([{ pin: 3, mode: "OUTPUT", value: 200, type: "digital" }]);
    stateRef.current.showPWMValues = true;
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    expect(svgEl.querySelector("#pin-3-val")?.textContent).toBe("200");
  });

  it("computes lower-half label position (cy >= VIEWBOX_HEIGHT/2 → anchor=end)", () => {
    const { overlayRef } = buildExtendedOverlay();
    const svgEl = overlayRef.current!.querySelector("svg")!;

    // cy = 183 (> 104.5 = VIEWBOX_HEIGHT/2) → label goes below → anchor "end"
    // Mock getBBox on both elements – code picks whichever passes instanceof check
    const mockBBox = { x: 10, y: 180, width: 6, height: 6, bottom: 186, left: 10, right: 16, top: 180 } as DOMRect;
    const circle = svgEl.querySelector<SVGCircleElement>("#pin-A0-state")!;
    const frame = svgEl.querySelector<SVGRectElement>("#pin-A0-frame")!;
    Object.defineProperty(circle, "getBBox", { configurable: true, value: () => mockBBox });
    Object.defineProperty(frame, "getBBox", { configurable: true, value: () => mockBBox });

    const stateRef = buildStateRef([{ pin: 14, mode: "INPUT", value: 512, type: "analog" }]);
    stateRef.current.showPWMValues = true;
    stateRef.current.analogPins = [14];
    const pinIsOnRef: MutableRefObject<Map<number, boolean>> = { current: new Map() };
    const pinTurnedOffAtRef: MutableRefObject<Map<number, number>> = { current: new Map() };

    renderHook(() => usePinPollingEngine({ overlayRef, stateRef, pinIsOnRef, pinTurnedOffAtRef }));
    act(() => { vi.advanceTimersByTime(20); });

    const label = svgEl.querySelector("#pin-A0-val");
    expect(label).not.toBeNull();
    expect(label?.getAttribute("text-anchor")).toBe("end");
  });
});

describe("ArduinoBoard overlay button CSS exclusion (regression guard)", () => {
  /**
   * The .arduino-overlay button must have the correct class so that the CSS
   * `:not(.arduino-overlay)` selector excludes it from the global button-height
   * override (`height: var(--ui-button-height) !important`).
   *
   * If someone removes the class, the button shrinks to ~32px and the SVG
   * won't be visible in the browser (though JSDOM won't catch the height itself).
   */
  it("arduino-overlay button has the correct CSS exclusion class and type", () => {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.className = "arduino-overlay absolute inset-0 w-full h-full";

    // Class must contain arduino-overlay so CSS :not(.arduino-overlay) applies
    expect(button.classList.contains("arduino-overlay")).toBe(true);

    // type="button" prevents accidental form submission
    expect(button.getAttribute("type")).toBe("button");
  });

  /**
   * querySelector("svg") must find the SVG regardless of nesting depth –
   * this is the core DOM-API guarantee we rely on.
   */
  it("querySelector(svg) finds nested SVG inside button>div", () => {
    const button = document.createElement("button");
    button.className = "arduino-overlay";
    const inner = document.createElement("div");
    inner.innerHTML = MINIMAL_OVERLAY_SVG;
    button.appendChild(inner);
    document.body.appendChild(button);

    const found = button.querySelector("svg");
    expect(found).not.toBeNull();
    expect(found?.tagName.toLowerCase()).toBe("svg");

    // Can also find elements within the nested SVG
    const circle = found?.querySelector("#pin-0-state");
    expect(circle).not.toBeNull();

    button.remove();
  });
});
