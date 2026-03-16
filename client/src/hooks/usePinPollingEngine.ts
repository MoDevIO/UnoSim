import { useEffect } from "react";
import type { PinState } from "@/components/features/arduino-board";

// Constants
const VIEWBOX_HEIGHT = 209;
const PWM_PINS = [3, 5, 6, 9, 10, 11];
const FADE_OUT_MS = 200;

/**
 * Helper function to get computed typography token values
 * Reads CSS variables and returns the actual pixel value considering font scaling
 */
function getComputedTokenValue(tokenName: string): string {
  try {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    const value = computedStyle.getPropertyValue(tokenName).trim();
    return value.replace(/px$/, '');
  } catch {
    if (tokenName === '--fs-label-sm') return '8';
    if (tokenName === '--fs-label-lg') return '12';
    return '8';
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

interface UsePinPollingEngineProps {
  overlayRef: React.RefObject<HTMLDivElement>;
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
    const pinStates = stateRef.current.pinStates;
    const state = pinStates.find((p) => p.pin === pin);
    if (!state) return "transparent";

    const isPWM = PWM_PINS.includes(pin);
    const isHigh = state.value > 0;

    let brightness = 0;
    if (isHigh) {
      brightness = 1.0;
    } else {
      const turnedOffAt = pinTurnedOffAtRef.current.get(pin);
      if (turnedOffAt) {
        const timeSinceTurnedOff = Date.now() - turnedOffAt;
        if (timeSinceTurnedOff < FADE_OUT_MS) {
          brightness = 1.0 - (timeSinceTurnedOff / FADE_OUT_MS);
        } else {
          brightness = 0;
        }
      }
    }

    if (brightness <= 0) {
      return "var(--color-black)";
    }

    const intensity = Math.round(brightness * 255);

    if (state.type === "digital") {
      return `rgb(${intensity}, 0, 0)`;
    } else if (isPWM) {
      const pwmIntensity = Math.round((state.value / 255) * intensity);
      return `rgb(${pwmIntensity}, 0, 0)`;
    } else if (state.value >= 255) {
      return `rgb(${intensity}, 0, 0)`;
    }
    return "var(--color-black)";
  };

  /**
   * Update digital pins 0-13 visual representation
   */
  const updateDigitalPins = (svgEl: SVGSVGElement) => {
    const pinStates = stateRef.current.pinStates;
    const isSimulationRunning = stateRef.current.isSimulationRunning;

    for (let pin = 0; pin <= 13; pin++) {
      const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-frame`);
      const state = svgEl.querySelector<SVGCircleElement>(`#pin-${pin}-state`);
      const click = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-click`);

      const isInput = isPinInputLocal(pin);

      // Track state changes for fade-out effect
      const pinState = pinStates.find((p) => p.pin === pin);
      const isHigh = pinState && pinState.value > 0;
      const wasOn = pinIsOnRef.current.get(pin) ?? false;
      if (wasOn !== isHigh) {
        pinIsOnRef.current.set(pin, isHigh ?? false);
        if (!isHigh) {
          pinTurnedOffAtRef.current.set(pin, Date.now());
        }
      }

      const color = getPinColor(pin);

      if (frame) {
        frame.style.display = isSimulationRunning && isInput ? "block" : "none";
        if (isSimulationRunning && isInput) {
          frame.setAttribute('filter', 'url(#glow-yellow)');
        } else {
          frame.removeAttribute('filter');
        }
      }

      if (state) {
        if (color === "transparent" || color === "var(--color-black)") {
          state.setAttribute("fill", "var(--color-black)");
          state.removeAttribute('filter');
        } else {
          state.setAttribute("fill", color);
          state.setAttribute('filter', 'url(#glow-red)');
        }
      }

      if (click) {
        click.style.pointerEvents = isInput ? "auto" : "none";
        click.style.cursor = isInput ? "pointer" : "default";
      }
    }
  };

  /**
   * Update analog pins A0-A5 visual representation
   */
  const updateAnalogPins = (svgEl: SVGSVGElement) => {
    const pinStates = stateRef.current.pinStates;
    const isSimulationRunning = stateRef.current.isSimulationRunning;
    const analogPins = stateRef.current.analogPins;

    for (let i = 0; i <= 5; i++) {
      const pinId = `A${i}`;
      const pinNumber = 14 + i;

      const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pinId}-frame`);
      const state = svgEl.querySelector<SVGCircleElement>(`#pin-${pinId}-state`);
      const click = svgEl.querySelector<SVGRectElement>(`#pin-${pinId}-click`);

      const isInput = isPinInputLocal(pinNumber);

      // Track state changes for fade-out effect
      const pinState = pinStates.find((p) => p.pin === pinNumber);
      const isHigh = pinState && pinState.value > 0;
      const wasOn = pinIsOnRef.current.get(pinNumber) ?? false;
      if (wasOn !== isHigh) {
        pinIsOnRef.current.set(pinNumber, isHigh ?? false);
        if (!isHigh) {
          pinTurnedOffAtRef.current.set(pinNumber, Date.now());
        }
      }

      const usedAsAnalog = analogPins.includes(pinNumber);
      const color = getPinColor(pinNumber);

      if (frame) {
        const show = isSimulationRunning && (isInput || usedAsAnalog);
        frame.style.display = show ? "block" : "none";
        if (show) {
          frame.setAttribute('filter', 'url(#glow-yellow)');
        } else {
          frame.removeAttribute('filter');
        }
        if (frame instanceof SVGGraphicsElement) {
          if (show && usedAsAnalog) {
            frame.style.strokeDasharray = "3,2";
          } else {
            frame.style.strokeDasharray = "";
          }
        }
      }

      if (state) {
        if (color === "transparent" || color === "var(--color-black)") {
          state.setAttribute("fill", "var(--color-black)");
          state.removeAttribute('filter');
        } else {
          state.setAttribute("fill", color);
          state.setAttribute('filter', 'url(#glow-red)');
        }
      }

      if (click && click instanceof HTMLElement) {
        const clickable = isInput || usedAsAnalog;
        click.style.pointerEvents = clickable ? "auto" : "none";
        click.style.cursor = clickable ? "pointer" : "default";
      }
    }
  };

  /**
   * Update all LEDs (ON, L, TX, RX)
   */
  const updateLEDs = (svgEl: SVGSVGElement) => {
    const pinStates = stateRef.current.pinStates;
    const isSimulationRunning = stateRef.current.isSimulationRunning;
    const txBlink = stateRef.current.txBlink;
    const rxBlink = stateRef.current.rxBlink;

    const ledOn = svgEl.querySelector<SVGRectElement>("#led-on");
    const ledL = svgEl.querySelector<SVGRectElement>("#led-l");
    const ledTx = svgEl.querySelector<SVGRectElement>("#led-tx");
    const ledRx = svgEl.querySelector<SVGRectElement>("#led-rx");

    if (ledOn) {
      if (isSimulationRunning) {
        ledOn.setAttribute("fill", "var(--color-led-green)");
        ledOn.setAttribute("fill-opacity", "1");
        ledOn.style.filter = "url(#glow-green)";
      } else {
        ledOn.setAttribute("fill", "transparent");
        ledOn.setAttribute("fill-opacity", "0");
        ledOn.style.filter = "none";
      }
    }

    const pin13State = pinStates.find((p) => p.pin === 13);
    const pin13On = pin13State && pin13State.value > 0;
    if (ledL) {
      if (pin13On) {
        ledL.setAttribute("fill", "var(--color-led-yellow)");
        ledL.setAttribute("fill-opacity", "1");
        ledL.style.filter = "url(#glow-yellow)";
      } else {
        ledL.setAttribute("fill", "transparent");
        ledL.setAttribute("fill-opacity", "0");
        ledL.style.filter = "none";
      }
    }

    if (ledTx) {
      if (txBlink) {
        ledTx.setAttribute("fill", "var(--color-led-yellow)");
        ledTx.setAttribute("fill-opacity", "1");
        ledTx.style.filter = "url(#glow-yellow)";
      } else {
        ledTx.setAttribute("fill", "transparent");
        ledTx.setAttribute("fill-opacity", "0");
        ledTx.style.filter = "none";
      }
    }

    if (ledRx) {
      if (rxBlink) {
        ledRx.setAttribute("fill", "var(--color-led-yellow)");
        ledRx.setAttribute("fill-opacity", "1");
        ledRx.style.filter = "url(#glow-yellow)";
      } else {
        ledRx.setAttribute("fill", "transparent");
        ledRx.setAttribute("fill-opacity", "0");
        ledRx.style.filter = "none";
      }
    }
  };

  /**
   * Update numeric labels for PWM and analog pins
   */
  const updateLabels = (svgEl: SVGSVGElement) => {
    const pinStates = stateRef.current.pinStates;
    const showPWMValues = stateRef.current.showPWMValues;

    /**
     * Create or update a text element (label) in the SVG
     */
    const ensureText = (
      id: string,
      x: number,
      y: number,
      textValue: string,
      fill = "var(--color-white)",
      rotateLeft = false,
      translateYOverride?: number,
      localXOverride?: number,
      anchorOverride?: string,
    ) => {
      let t = svgEl.querySelector<SVGTextElement>(`#${id}`);
      if (!t) {
        t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("id", id);
        t.setAttribute("text-anchor", anchorOverride || "middle");
        t.setAttribute("font-size", getComputedTokenValue('--fs-label-sm'));
        t.setAttribute("fill", fill);
        t.setAttribute("stroke", "var(--color-black)");
        t.setAttribute("stroke-width", "0.4");
        t.setAttribute("paint-order", "stroke");
        t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("style", "pointer-events: none;");
        svgEl.appendChild(t);
      } else {
        t.setAttribute("font-size", getComputedTokenValue('--fs-label-sm'));
        if (anchorOverride) t.setAttribute("text-anchor", anchorOverride);
      }
      t.textContent = textValue;
      if (rotateLeft) {
        const fontSize = Number.parseFloat(getComputedTokenValue('--fs-label-sm'));
        const half = fontSize / 2;
        const translateY =
          typeof translateYOverride === "number" ? translateYOverride : y;
        const localX =
          typeof localXOverride === "number" ? localXOverride : half;
        t.setAttribute(
          "transform",
          `translate(${x} ${translateY}) rotate(-90)`,
        );
        t.setAttribute("x", String(localX));
        t.setAttribute("y", "0");
      } else {
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(y));
        t.removeAttribute("transform");
      }
      t.style.display = textValue && showPWMValues ? "block" : "none";
    };

    if (!showPWMValues) {
      const existing = svgEl.querySelectorAll('text[id^="pin-"][id$="-val"]');
      existing.forEach((n) => {
        if (n instanceof SVGElement) {
          n.setAttribute("style", "display: none;");
        }
      });
    } else {
      // PWM pins
      for (const pin of PWM_PINS) {
        const stateEl = svgEl.querySelector<SVGCircleElement>(
          `#pin-${pin}-state`,
        );
        const frameEl = svgEl.querySelector<SVGRectElement>(
          `#pin-${pin}-frame`,
        );
        if (!stateEl && !frameEl) continue;
        try {
          const refEl = frameEl instanceof SVGGraphicsElement ? frameEl : stateEl;
          if (!(refEl instanceof SVGGraphicsElement)) continue;
          const bb = refEl.getBBox();
          const cx = bb.x + bb.width / 2;
          const cy = bb.y + bb.height / 2;
          const state = pinStates.find((p) => p.pin === pin);
          const valStr = state ? String(state.value) : "";
          
          let translateY: number | undefined = undefined;
          let localX: number | undefined = undefined;
          let anchor: string | undefined = undefined;
          const padding = getComputedSpacingToken('--svg-label-padding');
          const fontSize = Number.parseFloat(getComputedTokenValue('--fs-label-sm'));
          
          if (cy < VIEWBOX_HEIGHT / 2) {
            translateY = cy - bb.height / 2 - fontSize / 2 - padding;
            localX = -bb.width / 2 + padding;
            anchor = "start";
          } else {
            translateY = cy + bb.height / 2 + fontSize / 2 + padding;
            localX = bb.width / 2 - padding;
            anchor = "end";
          }
          
          ensureText(
            `pin-${pin}-val`,
            cx,
            cy,
            valStr,
            "var(--color-white)",
            true,
            translateY,
            localX,
            anchor,
          );
        } catch {
          // ignore bbox errors
        }
      }

      // Analog pins A0-A5
      for (let i = 0; i <= 5; i++) {
        const el = svgEl.querySelector<SVGCircleElement>(`#pin-A${i}-state`);
        const frameEl = svgEl.querySelector<SVGRectElement>(
          `#pin-A${i}-frame`,
        );
        if (!el && !frameEl) continue;
        try {
          const refEl = frameEl instanceof SVGGraphicsElement ? frameEl : el;
          if (!(refEl instanceof SVGGraphicsElement)) continue;
          const bb = refEl.getBBox();
          const cx = bb.x + bb.width / 2;
          const cy = bb.y + bb.height / 2;
          const pinNumber = 14 + i;
          const state = pinStates.find((p) => p.pin === pinNumber);
          const valStr = state ? String(state.value) : "";
          
          let translateYAnal: number | undefined = undefined;
          let localXAnal: number | undefined = undefined;
          let anchorAnal: string | undefined = undefined;
          const paddingAnal = getComputedSpacingToken('--svg-label-padding');
          const fontSizeAnal = Number.parseFloat(getComputedTokenValue('--fs-label-sm'));
          
          if (cy < VIEWBOX_HEIGHT / 2) {
            translateYAnal =
              cy - bb.height / 2 - fontSizeAnal / 2 - paddingAnal;
            localXAnal = -bb.width / 2 + paddingAnal;
            anchorAnal = "start";
          } else {
            translateYAnal =
              cy + bb.height / 2 + fontSizeAnal / 2 + paddingAnal;
            localXAnal = bb.width / 2 - paddingAnal;
            anchorAnal = "end";
          }
          
          ensureText(
            `pin-A${i}-val`,
            cx,
            cy,
            valStr,
            "var(--color-white)",
            true,
            translateYAnal,
            localXAnal,
            anchorAnal,
          );
        } catch {}
      }
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
