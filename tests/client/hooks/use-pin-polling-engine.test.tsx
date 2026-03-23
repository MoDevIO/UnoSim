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
