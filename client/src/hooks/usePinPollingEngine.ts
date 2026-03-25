import { useEffect } from "react";
import type { PinState } from "@/components/features/arduino-board";

// Constants
const VIEWBOX_HEIGHT = 209;
const PWM_PINS = [3, 5, 6, 9, 10, 11];
const FADE_OUT_MS = 200;

/**
 * Helper function to get computed typography token values
 * Reads CSS variables and returns the actual pixel value considering font scaling.
 * Handles calc() expressions by reading --ui-font-scale directly and multiplying.
 */
function getComputedTokenValue(tokenName: string): string {
  const BASE_SIZES: Record<string, number> = {
    '--fs-label-sm': 8,
    '--fs-label-lg': 12,
  };
  try {
    const computedStyle = getComputedStyle(document.documentElement);
    // Read --ui-font-scale (stored as plain number e.g. "1" or "1.25")
    const scaleStr = computedStyle.getPropertyValue('--ui-font-scale').trim();
    const scale = Number.parseFloat(scaleStr) || 1;
    const base = BASE_SIZES[tokenName];
    if (base !== undefined) return String(base * scale);
    // Fallback: try to parse the raw value (works for plain px values)
    const value = computedStyle.getPropertyValue(tokenName).trim();
    const n = Number.parseFloat(value.replace(/px$/, ''));
    return Number.isNaN(n) ? '8' : String(n);
  } catch {
    return String(BASE_SIZES[tokenName] ?? 8);
  }
}

/**
 * Gets computed spacing token values at runtime
 */
function getComputedSpacingToken(tokenName: string): number {
  try {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    const value = computedStyle.getPropertyValue(tokenName).trim();
    if (value.includes('rem')) {
      return Number.parseFloat(value) * 16;
    }
    if (value.includes('px')) {
      return Number.parseFloat(value);
    }
    return Number.parseFloat(value);
  } catch {
    if (tokenName === '--svg-safe-margin') return 4;
    if (tokenName === '--svg-label-padding') return 2;
    return 4;
  }
}

// ─── Pure module-level helpers (no hook state needed) ───────────────────────

type LabelRotateOpts = { translateY: number; localX: number; anchor: string };

function applyPinStateDot(el: SVGCircleElement | null, color: string): void {
  if (!el) return;
  const isOff = color === "transparent" || color === "var(--color-black)";
  if (isOff) {
    el.setAttribute("fill", "var(--color-black)");
    el.removeAttribute("filter");
  } else {
    el.setAttribute("fill", color);
    el.setAttribute("filter", "url(#glow-red)");
  }
}

function applyDigitalPinFrame(
  frame: SVGRectElement | null,
  isSimulationRunning: boolean,
  isInput: boolean,
): void {
  if (!frame) return;
  const show = isSimulationRunning && isInput;
  frame.style.display = show ? "block" : "none";
  if (show) {
    frame.setAttribute("filter", "url(#glow-yellow)");
  } else {
    frame.removeAttribute("filter");
  }
}

function applyAnalogPinFrame(
  frame: SVGRectElement | null,
  show: boolean,
  usedAsAnalog: boolean,
): void {
  if (!frame) return;
  frame.style.display = show ? "block" : "none";
  if (show) {
    frame.setAttribute("filter", "url(#glow-yellow)");
  } else {
    frame.removeAttribute("filter");
  }
  if (frame instanceof SVGGraphicsElement) {
    frame.style.strokeDasharray = show && usedAsAnalog ? "3,2" : "";
  }
}

function applyAnalogPinClick(
  click: SVGRectElement | null,
  isInput: boolean,
  usedAsAnalog: boolean,
): void {
  if (!click || !(click instanceof HTMLElement)) return;
  const clickable = isInput || usedAsAnalog;
  click.style.pointerEvents = clickable ? "auto" : "none";
  click.style.cursor = clickable ? "pointer" : "default";
}

function applyLedVisual(
  el: SVGRectElement | null,
  active: boolean,
  activeColor: string,
  glowFilter: string,
): void {
  if (!el) return;
  if (active) {
    el.setAttribute("fill", activeColor);
    el.setAttribute("fill-opacity", "1");
    el.style.filter = `url(${glowFilter})`;
  } else {
    el.setAttribute("fill", "transparent");
    el.setAttribute("fill-opacity", "0");
    el.style.filter = "none";
  }
}

function computeLabelPosition(bb: DOMRect, cy: number): LabelRotateOpts {
  const padding = getComputedSpacingToken("--svg-label-padding");
  const fontSize = Number.parseFloat(getComputedTokenValue("--fs-label-sm"));
  if (cy < VIEWBOX_HEIGHT / 2) {
    return {
      translateY: cy - bb.height / 2 - fontSize / 2 - padding,
      localX: -bb.width / 2 + padding,
      anchor: "start",
    };
  }
  return {
    translateY: cy + bb.height / 2 + fontSize / 2 + padding,
    localX: bb.width / 2 - padding,
    anchor: "end",
  };
}

function hideAllLabels(svgEl: SVGSVGElement): void {
  for (const n of svgEl.querySelectorAll('text[id^="pin-"][id$="-val"]')) {
    if (n instanceof SVGElement) n.setAttribute("style", "display: none;");
  }
}

interface SvgTextOpts {
  textValue: string;
  fill: string;
  showPWMValues: boolean;
  rotate?: LabelRotateOpts;
}

function ensureSvgText(
  svgEl: SVGSVGElement,
  id: string,
  x: number,
  y: number,
  opts: SvgTextOpts,
): void {
  const { textValue, fill, showPWMValues, rotate } = opts;
  let t = svgEl.querySelector<SVGTextElement>(`#${id}`);
  if (t) {
    t.setAttribute("font-size", getComputedTokenValue("--fs-label-sm"));
    if (rotate) t.setAttribute("text-anchor", rotate.anchor);
  } else {
    t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("id", id);
    t.setAttribute("text-anchor", rotate?.anchor ?? "middle");
    t.setAttribute("font-size", getComputedTokenValue("--fs-label-sm"));
    t.setAttribute("fill", fill);
    t.setAttribute("stroke", "var(--color-black)");
    t.setAttribute("stroke-width", "0.4");
    t.setAttribute("paint-order", "stroke");
    t.setAttribute("dominant-baseline", "middle");
    t.setAttribute("style", "pointer-events: none;");
    svgEl.appendChild(t);
  }
  t.textContent = textValue;
  if (rotate) {
    t.setAttribute("transform", `translate(${x} ${rotate.translateY}) rotate(-90)`);
    t.setAttribute("x", String(rotate.localX));
    t.setAttribute("y", "0");
  } else {
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.removeAttribute("transform");
  }
  t.style.display = textValue && showPWMValues ? "block" : "none";
}

function updateLabelForPin(
  svgEl: SVGSVGElement,
  stateElId: string,
  frameElId: string,
  labelId: string,
  pinValue: string,
  showPWMValues: boolean,
): void {
  const stateEl = svgEl.querySelector<SVGCircleElement>(`#${stateElId}`);
  const frameEl = svgEl.querySelector<SVGRectElement>(`#${frameElId}`);
  if (!stateEl && !frameEl) return;
  try {
    const refEl = (stateEl instanceof SVGGraphicsElement ? stateEl : frameEl) as SVGGraphicsElement | null;
    if (!refEl) return;
    const bb = refEl.getBBox();
    const cy = bb.y + bb.height / 2;
    const cx = bb.x + bb.width / 2;
    ensureSvgText(svgEl, labelId, cx, cy, {
      textValue: pinValue,
      fill: "var(--color-white)",
      showPWMValues,
      rotate: computeLabelPosition(bb, cy),
    });
  } catch {
    // ignore bbox errors
  }
}

/** Compute brightness for a pin considering the fade-out animation. */
function computeFadeBrightness(isHigh: boolean, turnedOffAt: number | undefined): number {
  if (isHigh) return 1;
  if (!turnedOffAt) return 0;
  const elapsed = Date.now() - turnedOffAt;
  return elapsed < FADE_OUT_MS ? 1 - elapsed / FADE_OUT_MS : 0;
}

/** Map a pin state + brightness to an RGB color string. */
function pinColorForState(state: PinState, pin: number, brightness: number): string {
  if (brightness <= 0) return "var(--color-black)";
  const intensity = Math.round(brightness * 255);
  if (state.type === "digital") return `rgb(${intensity}, 0, 0)`;
  if (PWM_PINS.includes(pin)) {
    const pwmIntensity = Math.round((state.value / 255) * intensity);
    return `rgb(${pwmIntensity}, 0, 0)`;
  }
  if (state.value >= 255) return `rgb(${intensity}, 0, 0)`;
  return "var(--color-black)";
}

// ─────────────────────────────────────────────────────────────────────────────

interface UsePinPollingEngineProps {
  overlayRef: React.RefObject<HTMLElement>;
  stateRef: React.MutableRefObject<{
    pinStates: PinState[];
    isSimulationRunning: boolean;
    txBlink: boolean;
    rxBlink: boolean;
    analogPins: number[];
    showPWMValues: boolean;
  }>;
  pinIsOnRef: React.MutableRefObject<Map<number, boolean>>;
  pinTurnedOffAtRef: React.MutableRefObject<Map<number, number>>;
}

/**
 * Custom hook that manages the 10ms polling loop for SVG pin/LED updates
 * Handles DOM manipulation for digital pins, analog pins, LEDs, and labels
 */
export function usePinPollingEngine({
  overlayRef,
  stateRef,
  pinIsOnRef,
  pinTurnedOffAtRef,
}: UsePinPollingEngineProps) {
  /**
   * Check if pin is INPUT mode
   */
  const isPinInputLocal = (pin: number): boolean => {
    const pinStates = stateRef.current.pinStates;
    const state = pinStates.find((p) => p.pin === pin);
    return (
      state !== undefined &&
      (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")
    );
  };

  /**
   * Get pin color with fade-out effect for OFF LEDs
   */
  const getPinColor = (pin: number): string => {
    const state = stateRef.current.pinStates.find((p) => p.pin === pin);
    if (!state) return "transparent";
    const turnedOffAt = pinTurnedOffAtRef.current.get(pin);
    const brightness = computeFadeBrightness(state.value > 0, turnedOffAt);
    return pinColorForState(state, pin, brightness);
  };

  /** Track LED fade-out state when a pin turns on/off. */
  const trackPinFadeState = (pin: number, isHigh: boolean) => {
    const wasOn = pinIsOnRef.current.get(pin) ?? false;
    if (wasOn !== isHigh) {
      pinIsOnRef.current.set(pin, isHigh);
      if (!isHigh) pinTurnedOffAtRef.current.set(pin, Date.now());
    }
  };
  const getPinState = (pin: number) => {
    return stateRef.current.pinStates.find((p) => p.pin === pin);
  };

  /** Update a single digital pin element. */
  const updateDigitalPin = (svgEl: SVGSVGElement, pin: number) => {
    const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-frame`);
    const state = svgEl.querySelector<SVGCircleElement>(`#pin-${pin}-state`);
    const click = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-click`);
    const isInput = isPinInputLocal(pin);
    const pinState = getPinState(pin);
    trackPinFadeState(pin, !!(pinState && pinState.value > 0));
    const color = getPinColor(pin);

    applyDigitalPinFrame(frame, stateRef.current.isSimulationRunning, isInput);
    applyPinStateDot(state, color);

    if (click) {
      click.style.pointerEvents = isInput ? "auto" : "none";
      click.style.cursor = isInput ? "pointer" : "default";
    }
  };

  /**
   * Update digital pins 0-13 visual representation
   */
  const updateDigitalPins = (svgEl: SVGSVGElement) => {
    for (let pin = 0; pin <= 13; pin++) {
      updateDigitalPin(svgEl, pin);
    }
  };

  /** Update a single analog pin element. */
  const updateAnalogPin = (svgEl: SVGSVGElement, pinIndex: number) => {
    const pinNumber = 14 + pinIndex;
    const frame = svgEl.querySelector<SVGRectElement>(`#pin-A${pinIndex}-frame`);
    const state = svgEl.querySelector<SVGCircleElement>(`#pin-A${pinIndex}-state`);
    const click = svgEl.querySelector<SVGRectElement>(`#pin-A${pinIndex}-click`);
    const isInput = isPinInputLocal(pinNumber);
    const pinState = getPinState(pinNumber);
    trackPinFadeState(pinNumber, !!(pinState && pinState.value > 0));
    const usedAsAnalog = stateRef.current.analogPins.includes(pinNumber);
    const color = getPinColor(pinNumber);
    const show = stateRef.current.isSimulationRunning && (isInput || usedAsAnalog);

    applyAnalogPinFrame(frame, show, usedAsAnalog);
    applyPinStateDot(state, color);
    applyAnalogPinClick(click, isInput, usedAsAnalog);
  };

  /**
   * Update analog pins A0-A5 visual representation
   */
  const updateAnalogPins = (svgEl: SVGSVGElement) => {
    for (let i = 0; i <= 5; i++) {
      updateAnalogPin(svgEl, i);
    }
  };

  /**
   * Update all LEDs (ON, L, TX, RX)
   */
  const updateLEDs = (svgEl: SVGSVGElement) => {
    const { pinStates, isSimulationRunning, txBlink, rxBlink } = stateRef.current;
    const ledOn = svgEl.querySelector<SVGRectElement>("#led-on");
    const ledL = svgEl.querySelector<SVGRectElement>("#led-l");
    const ledTx = svgEl.querySelector<SVGRectElement>("#led-tx");
    const ledRx = svgEl.querySelector<SVGRectElement>("#led-rx");
    const pin13On = (pinStates.find((p) => p.pin === 13)?.value ?? 0) > 0;
    applyLedVisual(ledOn, isSimulationRunning, "var(--color-led-green)", "#glow-green");
    applyLedVisual(ledL, pin13On, "var(--color-led-yellow)", "#glow-yellow");
    applyLedVisual(ledTx, txBlink, "var(--color-led-yellow)", "#glow-yellow");
    applyLedVisual(ledRx, rxBlink, "var(--color-led-yellow)", "#glow-yellow");
  };

  /**
   * Update numeric labels for PWM and analog pins
   */
  const updateLabels = (svgEl: SVGSVGElement) => {
    const { showPWMValues } = stateRef.current;

    if (!showPWMValues) {
      hideAllLabels(svgEl);
      return;
    }

    for (const pin of PWM_PINS) {
      const valStr = getPinState(pin)?.value?.toString() ?? "";
      updateLabelForPin(svgEl, `pin-${pin}-state`, `pin-${pin}-frame`, `pin-${pin}-val`, valStr, showPWMValues);
    }

    for (let i = 0; i <= 5; i++) {
      const pinNumber = 14 + i;
      const valStr = getPinState(pinNumber)?.value?.toString() ?? "";
      updateLabelForPin(svgEl, `pin-A${i}-state`, `pin-A${i}-frame`, `pin-A${i}-val`, valStr, showPWMValues);
    }
  };

  /**
   * Main update function that runs every 10ms
   */
  const performAllUpdates = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const svgEl = overlay.querySelector("svg");
    if (!svgEl) return;

    updateDigitalPins(svgEl);
    updateAnalogPins(svgEl);
    updateLEDs(svgEl);
    updateLabels(svgEl);
  };

  // Set up the polling loop
  useEffect(() => {
    const intervalId = setInterval(performAllUpdates, 10);
    performAllUpdates();

    return () => clearInterval(intervalId);
  }, []); // Empty dep array - polling loop never restarts, reads from stateRef which is always current
}
