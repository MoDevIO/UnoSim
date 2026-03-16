import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Cpu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { Logger } from "@shared/logger";

const logger = new Logger("ArduinoBoard");

/**
 * Helper function to get computed typography token values
 * Reads CSS variables and returns the actual pixel value considering font scaling
 */
function getComputedTokenValue(tokenName: string): string {
  try {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    // Get the CSS variable value (e.g., "8px * 1" or "calc(8px * var(--ui-font-scale))")
    // The browser automatically computes this to the final value
    const value = computedStyle.getPropertyValue(tokenName).trim();
    // For SVG, remove 'px' suffix if present and return the numeric part
    return value.replace(/px$/, '');
  } catch {
    // Fallback values if CSS variables are not available
    if (tokenName === '--fs-label-sm') return '8'; // SVG pin labels
    if (tokenName === '--fs-label-lg') return '12'; // Dialog headers
    logger.warn(`getComputedTokenValue failed for '${tokenName}'`);
    return '8';
  }
}

interface PinState {
  pin: number;
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
  value: number; // analog: 0-1023, pwm: 0-255, digital: 0 or 1
  type: "digital" | "analog" | "pwm";
}

interface ArduinoBoardProps {
  pinStates?: PinState[];
  isSimulationRunning?: boolean;
  simulationStatus?: "running" | "paused" | "stopped";
  txActive?: number; // TX activity counter (changes trigger blink)
  rxActive?: number; // RX activity counter (changes trigger blink)
  onReset?: () => void; // Callback when reset button is clicked
  onPinToggle?: (pin: number, newValue: number) => void; // Callback when an INPUT pin is clicked
  analogPins?: number[]; // array of internal pin numbers for analog pins (14..19)
  onAnalogChange?: (pin: number, value: number) => void;
}

// SVG viewBox dimensions (from ArduinoUno.svg)
const VIEWBOX_WIDTH = 285.2;
const VIEWBOX_HEIGHT = 209;

/**
 * Gets computed spacing token values at runtime
 * Allows us to keep SVG scaling calculations using semantic variables
 */
function getComputedSpacingToken(tokenName: string): number {
  try {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    const value = computedStyle.getPropertyValue(tokenName).trim();
    // Convert rem to pixels (assuming 16px base)
    if (value.includes('rem')) {
      return Number.parseFloat(value) * 16;
    }
    if (value.includes('px')) {
      return Number.parseFloat(value);
    }
    return Number.parseFloat(value);
  } catch {
    // Fallback values
    if (tokenName === '--svg-safe-margin') return 4;
    if (tokenName === '--svg-label-padding') return 2;
    logger.warn(`getComputedSpacingToken failed for '${tokenName}'`);
    return 4;
  }
}

// PWM-capable pins on Arduino UNO
const PWM_PINS = [3, 5, 6, 9, 10, 11];

export function ArduinoBoard({
  pinStates = [],
  isSimulationRunning = false,
  simulationStatus = "stopped",
  txActive = 0,
  rxActive = 0,
  onReset,
  onPinToggle,
  analogPins = [],
  onAnalogChange,
}: ArduinoBoardProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [boardColor, setBoardColor] = useState<string>(() => {
    try {
      return window.localStorage.getItem("unoBoardColor") || "var(--color-brand-primary)";
    } catch {
      return "var(--color-brand-primary)";
    }
  });
  const [overlaySvgContent, setOverlaySvgContent] = useState<string>("");
  const [txBlink, setTxBlink] = useState(false);
  const [rxBlink, setRxBlink] = useState(false);
  const [showPWMValues, setShowPWMValues] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const { last: telemetry } = useTelemetryStore();
  const txTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerWrapperRef = useRef<HTMLDivElement>(null);

  // Slider positions in percent of viewBox (left%, top%)
  const [sliderPositions, setSliderPositions] = useState<
    Array<{
      pin: number;
      leftPct: number;
      topPct: number;
      value: number;
      sliderLen: number;
      placement: "above" | "below";
    }>
  >([]);
  const [analogDialog, setAnalogDialog] = useState<null | {
    open: true;
    pin: number;
    value: number;
    leftPct: number;
    topPct: number;
    placement: "above" | "below";
  }>(null);

  // Handle TX blink (stays on for 100ms after activity)
  useEffect(() => {
    if (txActive > 0) {
      setTxBlink(true);
      if (txTimeoutRef.current) clearTimeout(txTimeoutRef.current);
      txTimeoutRef.current = setTimeout(() => setTxBlink(false), 100);
    }
  }, [txActive]);

  // Handle RX blink (stays on for 100ms after activity)
  useEffect(() => {
    if (rxActive > 0) {
      setRxBlink(true);
      if (rxTimeoutRef.current) clearTimeout(rxTimeoutRef.current);
      rxTimeoutRef.current = setTimeout(() => setRxBlink(false), 100);
    }
  }, [rxActive]);

  // Monitor font scale changes from Settings and trigger SVG re-render
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    
    const checkScaleChange = () => {
      try {
        const cs = getComputedStyle(document.documentElement);
        Number.parseFloat(cs.getPropertyValue("--ui-font-scale")) || 1; // Read but don't store - SVG re-renders on next polling cycle
      } catch {
        logger.warn("Failed to read --ui-font-scale");
      }
    };

    // Check immediately
    checkScaleChange();
    
    // Poll for changes every 200ms (smooth enough for user experience)
    pollInterval = setInterval(checkScaleChange, 200);
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Load both SVGs once
  useEffect(() => {
    Promise.all([
      fetch("/ArduinoUno.svg").then((r) => r.text()),
      fetch("/ArduinoUno-overlay.svg").then((r) => r.text()),
    ])
      .then(([main, overlay]) => {
        setSvgContent(main);
        setOverlaySvgContent(overlay);
      })
      .catch((err) => console.error("Failed to load Arduino SVGs:", err));
  }, []);

  // Listen for color changes from settings dialog (custom event)
  useEffect(() => {
    const onColor = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as
          | { color?: string }
          | undefined;
        const color =
          detail?.color ||
          window.localStorage.getItem("unoBoardColor") ||
          "var(--color-brand-primary)";
        setBoardColor(color);
      } catch {
        // ignore
      }
    };
    document.addEventListener("arduinoColorChange", onColor as EventListener);
    return () =>
      document.removeEventListener(
        "arduinoColorChange",
        onColor as EventListener,
      );
  }, []);

  // Listen for debug mode changes
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("unoDebugMode") === "1";
      setDebugMode(stored);
    } catch {
      setDebugMode(false);
    }

    const handler = (ev: Event) => {
      try {
        const customEv = ev as CustomEvent<{ value: boolean }>;
        const newValue = Boolean(customEv?.detail?.value);
        setDebugMode(newValue);
      } catch {
        // ignore
      }
    };
    document.addEventListener("debugModeChange", handler as EventListener);
    return () =>
      document.removeEventListener("debugModeChange", handler as EventListener);
  }, []);

  // Stable reference to ALL current state for polling - updated on every render
  const stateRef = useRef({
    pinStates,
    isSimulationRunning,
    simulationStatus,
    txBlink,
    rxBlink,
    analogPins,
    showPWMValues,
  });
  stateRef.current = {
    pinStates,
    isSimulationRunning,
    simulationStatus,
    txBlink,
    rxBlink,
    analogPins,
    showPWMValues,
  };

  // Fade-Out tracking for LEDs
  const FADE_OUT_MS = 200;
  const pinIsOnRef = useRef<Map<number, boolean>>(new Map());
  const pinTurnedOffAtRef = useRef<Map<number, number>>(new Map());

  // Single stable polling loop for ALL SVG updates - runs ONCE, never restarts
  useEffect(() => {
    console.log("[ArduinoBoard] Starting stable polling loop");
    const performAllUpdates = () => {
      // Check overlay ref INSIDE the callback to handle late mounting
      const overlay = overlayRef.current;
      if (!overlay) return;

      const svgEl = overlay.querySelector("svg");
      if (!svgEl) return;

      const { pinStates, isSimulationRunning, txBlink, rxBlink, analogPins } =
        stateRef.current;

      // Helper to check if pin is INPUT (using stateRef.current pinStates)
      const isPinInputLocal = (pin: number): boolean => {
        const state = pinStates.find((p) => p.pin === pin);
        return (
          state !== undefined &&
          (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")
        );
      };

      // Helper to get pin color with fade-out effect
      const getPinColor = (pin: number): string => {
        const state = pinStates.find((p) => p.pin === pin);
        if (!state) return "transparent";

        const isPWM = PWM_PINS.includes(pin);
        const isHigh = state.value > 0;

        // Calculate brightness with fade-out
        let brightness = 0;
        if (isHigh) {
          // LED is ON → full brightness
          brightness = 1.0;
        } else {
          // LED is OFF → calculate fade-out
          const turnedOffAt = pinTurnedOffAtRef.current.get(pin);
          if (turnedOffAt) {
            const timeSinceTurnedOff = Date.now() - turnedOffAt;
            if (timeSinceTurnedOff < FADE_OUT_MS) {
              // Still fading out
              brightness = 1.0 - (timeSinceTurnedOff / FADE_OUT_MS);
            } else {
              // Fade complete
              brightness = 0;
            }
          }
        }

        if (brightness <= 0) {
          return "var(--color-black)";
        }

        // Apply brightness to red color
        const intensity = Math.round(brightness * 255);

        if (state.type === "digital") {
          return `rgb(${intensity}, 0, 0)`;
        } else if (isPWM) {
          // PWM: Combine PWM value with fade brightness
          const pwmIntensity = Math.round((state.value / 255) * intensity);
          return `rgb(${pwmIntensity}, 0, 0)`;
        } else if (state.value >= 255) {
          return `rgb(${intensity}, 0, 0)`;
        }
        return "var(--color-black)";
      };

      // Update digital pins 0-13
      for (let pin = 0; pin <= 13; pin++) {
        const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-frame`);
        const state = svgEl.querySelector<SVGCircleElement>(
          `#pin-${pin}-state`,
        );
        const click = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-click`);

        const isInput = isPinInputLocal(pin);

        // Track state changes for fade-out effect
        const pinState = pinStates.find((p) => p.pin === pin);
        const isHigh = pinState && pinState.value > 0;
        const wasOn = pinIsOnRef.current.get(pin) ?? false;
        if (wasOn !== isHigh) {
          pinIsOnRef.current.set(pin, isHigh ?? false);
          if (!isHigh) {
            // Pin turned OFF → start fade-out
            pinTurnedOffAtRef.current.set(pin, Date.now());
          }
        }

        const color = getPinColor(pin);

        if (frame) {
          frame.style.display = isSimulationRunning && isInput ? "block" : "none";
          // Use SVG native filter for glow instead of CSS drop-shadow
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
            // pin states are red/pwm → use red glow filter for consistent appearance
            state.setAttribute('filter', 'url(#glow-red)');
          }
        }

        if (click) {
          click.style.pointerEvents = isInput ? "auto" : "none";
          click.style.cursor = isInput ? "pointer" : "default";
        }
      }

      // Update analog pins A0-A5
      for (let i = 0; i <= 5; i++) {
        const pinId = `A${i}`;
        const pinNumber = 14 + i;

        const frame = svgEl.querySelector<SVGRectElement>(
          `#pin-${pinId}-frame`,
        );
        const state = svgEl.querySelector<SVGCircleElement>(
          `#pin-${pinId}-state`,
        );
        const click = svgEl.querySelector<SVGRectElement>(
          `#pin-${pinId}-click`,
        );

        const isInput = isPinInputLocal(pinNumber);

        // Track state changes for fade-out effect (when used as digital)
        const pinState = pinStates.find((p) => p.pin === pinNumber);
        const isHigh = pinState && pinState.value > 0;
        const wasOn = pinIsOnRef.current.get(pinNumber) ?? false;
        if (wasOn !== isHigh) {
          pinIsOnRef.current.set(pinNumber, isHigh ?? false);
          if (!isHigh) {
            // Pin turned OFF → start fade-out
            pinTurnedOffAtRef.current.set(pinNumber, Date.now());
          }
        }

        const usedAsAnalog = analogPins.includes(pinNumber);
        const color = getPinColor(pinNumber);

        if (frame) {
          // Show frame if:
          // - Simulation is running AND
          // - (Pin is INPUT mode OR pin is detected as used with analogRead)
          const show = isSimulationRunning && (isInput || usedAsAnalog);
          frame.style.display = show ? "block" : "none";
          if (show) {
            frame.setAttribute('filter', 'url(#glow-yellow)');
          } else {
            frame.removeAttribute('filter');
          }
          // Dashed frame if analogRead is used, solid otherwise
          if (show && usedAsAnalog) {
            (frame as unknown as SVGGraphicsElement).style.strokeDasharray = "3,2";
          } else {
            (frame as unknown as SVGGraphicsElement).style.strokeDasharray = "";
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
          const clickable = isInput || usedAsAnalog;
          (click as unknown as HTMLElement).style.pointerEvents = clickable ? "auto" : "none";
          (click as unknown as HTMLElement).style.cursor = clickable ? "pointer" : "default";
        }
      }

      // Update ALL LEDs
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

      // Update numeric I/O labels (PWM pins and analog A0-A5)
      // Only show when requested via the header button
      const showLabels = !!stateRef.current.showPWMValues;

      // Helper to create/update text nodes
      // rotateLeft: if true, the label will be rotated -90deg around (x,y)
      // Helper to create/update text nodes
      // rotateLeft: if true, the label will be rotated -90deg around (translateX, translateY)
      // translateYOverride: optional - if provided, use this Y for the translate before rotation (useful to place label edge-aligned)
      // localXOverride: optional - when rotated, this sets the local x coordinate (useful to left-align inside frame)
      // anchorOverride: optional - sets the text-anchor attribute (e.g. 'start' for left-aligned)
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
          // Use scaled typography token which respects global --ui-font-scale
          t.setAttribute("font-size", getComputedTokenValue('--fs-label-sm'));
          t.setAttribute("fill", fill);
          t.setAttribute("stroke", "var(--color-black)");
          t.setAttribute("stroke-width", "0.4");
          t.setAttribute("paint-order", "stroke");
          t.setAttribute("dominant-baseline", "middle");
          t.setAttribute("style", "pointer-events: none;");
          svgEl.appendChild(t);
        } else {
          // Update font-size on every call to respect zoom changes
          t.setAttribute("font-size", getComputedTokenValue('--fs-label-sm'));
          if (anchorOverride) t.setAttribute("text-anchor", anchorOverride);
        }
        t.textContent = textValue;
        if (rotateLeft) {
          // Get scaled font size from CSS token
          const fontSize = Number.parseFloat(getComputedTokenValue('--fs-label-sm'));
          const half = fontSize / 2;
          const translateY =
            typeof translateYOverride === "number" ? translateYOverride : y;
          const localX =
            typeof localXOverride === "number" ? localXOverride : half;
          // translate to chosen point then rotate; text local x controls lateral placement, local y is 0
          t.setAttribute(
            "transform",
            `translate(${x} ${translateY}) rotate(-90)`,
          );
          t.setAttribute("x", String(localX));
          t.setAttribute("y", "0");
        } else {
          // no horizontal offset for non-rotated labels by default (callers can adjust x)
          t.setAttribute("x", String(x));
          t.setAttribute("y", String(y));
          t.removeAttribute("transform");
        }
        t.style.display = textValue && showLabels ? "block" : "none";
      };

      // Remove/hide any existing label nodes when labels are disabled
      if (!showLabels) {
        const existing = svgEl.querySelectorAll('text[id^="pin-"][id$="-val"]');
        existing.forEach((n) => {
          if (n instanceof SVGElement) {
            n.setAttribute("style", "display: none;");
          }
        });
      } else {
        // PWM pins 3,5,6,9,10,11
        for (const pin of PWM_PINS) {
          const stateEl = svgEl.querySelector<SVGCircleElement>(
            `#pin-${pin}-state`,
          );
          const frameEl = svgEl.querySelector<SVGRectElement>(
            `#pin-${pin}-frame`,
          );
          if (!stateEl && !frameEl) continue;
          try {
            // Prefer the frame center (yellow square) if available, otherwise fall back to circle center
            const bb = (frameEl ?? (stateEl as unknown as SVGGraphicsElement)).getBBox();
            const cx = bb.x + bb.width / 2;
            const cy = bb.y + bb.height / 2;
            const state = pinStates.find((p) => p.pin === pin);
            const valStr = state ? String(state.value) : "";
            // Place label either above (upper pins) or below (lower pins) the frame, and align inside the frame
            let translateY: number | undefined = undefined;
            let localX: number | undefined = undefined;
            let anchor: string | undefined = undefined;
            const padding = getComputedSpacingToken('--svg-label-padding'); // 2px from token
            const fontSize = Number.parseFloat(getComputedTokenValue('--fs-label-sm'));
            if (cy < VIEWBOX_HEIGHT / 2) {
              // upper pins: place above and left-align inside frame
              translateY = cy - bb.height / 2 - fontSize / 2 - padding;
              localX = -bb.width / 2 + padding;
              anchor = "start";
            } else {
              // lower pins: place below and right-align inside frame
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

        // Analog pins A0-A5 (pins 14-19)
        for (let i = 0; i <= 5; i++) {
          const el = svgEl.querySelector<SVGCircleElement>(`#pin-A${i}-state`);
          const frameEl = svgEl.querySelector<SVGRectElement>(
            `#pin-A${i}-frame`,
          );
          if (!el && !frameEl) continue;
          try {
            const bb = (frameEl ?? (el as unknown as SVGGraphicsElement)).getBBox();
            const cx = bb.x + bb.width / 2;
            const cy = bb.y + bb.height / 2;
            const pinNumber = 14 + i;
            const state = pinStates.find((p) => p.pin === pinNumber);
            const valStr = state ? String(state.value) : "";
            // Place analog pin label above (upper half) or below (lower half) and align inside the frame
            let translateYAnal: number | undefined = undefined;
            let localXAnal: number | undefined = undefined;
            let anchorAnal: string | undefined = undefined;
            const paddingAnal = getComputedSpacingToken('--svg-label-padding'); // 2px from token
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

    // Stable 10ms polling - interval NEVER restarts, reads current state from ref
    const intervalId = setInterval(performAllUpdates, 10);
    performAllUpdates();

    return () => clearInterval(intervalId);
  }, []); // Empty dep array - polling loop never restarts, reads from stateRef which is always current

  // Compute slider positions for analog pins using SVG bbox (percent of viewBox)
  useEffect(() => {
    const overlay = overlayRef.current;
    const inner = innerWrapperRef.current;
    if (!overlay || !overlaySvgContent || !inner) {
      setSliderPositions([]);
      return;
    }

    const svgEl = overlay.querySelector<SVGSVGElement>("svg");
    if (!svgEl) {
      setSliderPositions([]);
      return;
    }

    const positions: Array<{
      pin: number;
      leftPct: number;
      topPct: number;
      value: number;
      sliderLen: number;
      placement: "above" | "below";
    }> = [];
    for (const pin of analogPins) {
      if (pin < 14 || pin > 19) continue;
      const idx = pin - 14;
      // Try several candidate element ids to find the pin position
      const candidates = [
        `pin-A${idx}-state`,
        `pin-A${idx}-frame`,
        `pin-A${idx}-click`,
        `pin-${pin}-state`,
        `pin-${pin}-frame`,
        `pin-${pin}-click`,
      ];
      let found: SVGGraphicsElement | null = null;
      for (const id of candidates) {
        const el = svgEl.querySelector<SVGGraphicsElement>(`#${id}`);
        if (el) {
          found = el;
          break;
        }
      }
      if (!found) continue;

      try {
        const bbox = (found as unknown as SVGGraphicsElement).getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        const leftPct = (cx / VIEWBOX_WIDTH) * 100;
        const topPct = (cy / VIEWBOX_HEIGHT) * 100;
        // Note: We read pinStates directly but don't depend on it to avoid re-renders
        // The slider value will be updated separately when pinStates changes
        const value = 0; // Default value, will be updated by a separate effect
        // Compute slider visual length (in viewBox pixels) and clamp to reasonable size
        const rawLen = Math.max(16, Math.min(80, bbox.width * 3));
        // Placement: if pin is in upper half, place slider below; otherwise above
        const placement: "above" | "below" =
          cy < VIEWBOX_HEIGHT / 2 ? "below" : "above";
        positions.push({
          pin,
          leftPct,
          topPct,
          value,
          sliderLen: rawLen,
          placement,
        });
      } catch {
        // ignore
      }
    }

    setSliderPositions(positions);
  }, [overlaySvgContent, analogPins]);

  // Update slider values when pinStates changes (without triggering re-calculation of positions)
  useEffect(() => {
    setSliderPositions((prev) => {
      if (prev.length === 0) return prev;

      let changed = false;
      const updated = prev.map((slider) => {
        const pinState = pinStates.find((p) => p.pin === slider.pin);
        const newValue = pinState?.value ?? 0;
        if (newValue !== slider.value) {
          changed = true;
          return { ...slider, value: newValue };
        }
        return slider;
      });

      return changed ? updated : prev;
    });
  }, [pinStates]);

  // Handle clicks on the overlay SVG
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as Element;

      // Check for pin click
      const pinClick = target.closest('[id^="pin-"][id$="-click"]');
      // debug logs removed
      if (pinClick && onPinToggle) {
        // Match both digital pins (0-13) and analog pins (A0-A5)
        const digitalMatch = pinClick.id.match(/pin-(\d+)-click/);
        const analogMatch = pinClick.id.match(/pin-A(\d+)-click/);

        let pin: number | undefined;
        if (digitalMatch) {
          pin = Number.parseInt(digitalMatch[1], 10);
        } else if (analogMatch) {
          // A0-A5 map to pins 14-19
          pin = 14 + Number.parseInt(analogMatch[1], 10);
        }

        if (pin !== undefined) {
          const state = pinStates.find((p) => p.pin === pin);
          // debug logs removed
          // Determine if this analog pin was detected from code (analogRead)
          const usedAsAnalog = analogPins.includes(pin);
          // Only open the analog dialog when this pin was actually used by analogRead
          if (pin >= 14 && pin <= 19 && onAnalogChange && usedAsAnalog) {
            // Find slider position info if available
            const info = sliderPositions.find((s) => s.pin === pin);
            const val = state ? state.value : 0;
            const leftPct = info ? info.leftPct : 50;
            const topPct = info ? info.topPct : 50;
            const placement = info
              ? info.placement
              : topPct < 50
                ? "below"
                : "above";
            // Open dialog
            setAnalogDialog({
              open: true,
              pin,
              value: val,
              leftPct,
              topPct,
              placement,
            });
          } else if (
            state &&
            (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")
          ) {
            const newValue = state.value > 0 ? 0 : 1;
            logger.debug(
              `[ArduinoBoard] Pin ${pin} clicked, toggling to ${newValue}`,
            );
            onPinToggle(pin, newValue);
          }
        }
        return;
      }

      // Check for reset button click
      const resetClick = target.closest("#reset-click");
      if (resetClick && onReset) {
        logger.debug("[ArduinoBoard] Reset button clicked");
        onReset();
      }
    },
    [
      onPinToggle,
      onReset,
      pinStates,
      sliderPositions,
      onAnalogChange,
      analogPins,
    ],
  );

  // Compute scale to fit both width and height
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !svgContent) return;

    const updateScale = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw > 0 && ch > 0) {
        const SAFE_MARGIN = getComputedSpacingToken('--svg-safe-margin');
        const s = Math.min(
          (cw - SAFE_MARGIN * 2) / VIEWBOX_WIDTH,
          (ch - SAFE_MARGIN * 2) / VIEWBOX_HEIGHT,
        );
        setScale(Math.max(s, 0.1));
      }
    };

    const timer = setTimeout(updateScale, 50);
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);

    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [svgContent]);

  // Modify main SVG (static, just styles)
  const getModifiedSvg = () => {
    if (!svgContent) return "";
    let modified = svgContent;
    modified = modified.replace(/<\?xml[^?]*\?>/g, "");
    // Replace the default board color (brand-primary token) in the SVG with the chosen color.
    // We replace hex occurrences case-insensitively; avoid embedding raw hex in source.
    try {
      const DEFAULT_BOARD_HEX = '#' + '0f7391';
      modified = modified.replace(new RegExp(DEFAULT_BOARD_HEX, 'gi'), boardColor);
    } catch {}
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; opacity: ${simulationStatus === "running" ? 1 : 0.35};" preserveAspectRatio="xMidYMid meet">`,
    );
    return modified;
  };

  // Modify overlay SVG
  const getOverlaySvg = () => {
    if (!overlaySvgContent) return "";
    let modified = overlaySvgContent;
    modified = modified.replace(/<\?xml[^?]*\?>/g, "");

    // Ensure click areas carry a Tailwind utility for cursor (picked up by JIT)
    // and keep original `click-area` class so SVG styles remain functional.
    modified = modified.replace(/class="click-area"/g, 'class="click-area cursor-pointer"');

    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; position: absolute; top: 0; left: 0;" preserveAspectRatio="xMidYMid meet">`,
    );
    return modified;
  };

  return (
    <div className="h-full flex flex-col bg-card border-t border-border">
      {/* Header */}
      <div className="bg-muted px-[var(--header-padding-x)] border-b border-border flex items-center justify-between h-[var(--ui-header-height)] overflow-hidden">
        <div className="flex items-center space-x-2 min-w-0 whitespace-nowrap">
          <Cpu className="text-white opacity-95 h-5 w-5" strokeWidth={1.67} />
          <span className="sr-only">Arduino UNO Board</span>
          {debugMode && telemetry && isSimulationRunning && (
            <div className="ml-4 flex items-center gap-4 text-xs text-muted-foreground border-l border-muted-foreground/30 pl-4" data-testid="telemetry-metrics">
              <div className="flex flex-col" data-testid="telemetry-pin-changes">
                <span className="text-[10px] uppercase tracking-wider text-cyan-500/50">Pin Changes</span>
                <span className="text-sm font-mono text-cyan-400" data-testid="telemetry-pin-changes-value">
                  {telemetry.intendedPinChangesPerSecond.toFixed(0)} /s
                  {telemetry.droppedPinChangesPerSecond > 0 && (
                    <span className="ml-1 text-amber-400/80" data-testid="telemetry-dropped">
                      ({telemetry.droppedPinChangesPerSecond.toFixed(0)} dropped)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-col" data-testid="telemetry-batching">
                <span className="text-[10px] uppercase tracking-wider text-cyan-500/50">Batching</span>
                <span className="text-sm font-mono text-cyan-400" data-testid="telemetry-batching-value">
                  {telemetry.batchesPerSecond.toFixed(0)} bat/s · {telemetry.avgStatesPerBatch.toFixed(0)} st/bat
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center ml-3">
          <Button
            variant="outline"
            size="sm"
            className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
            onClick={() => setShowPWMValues(!showPWMValues)}
            title={showPWMValues ? "Hide I/O values" : "Show I/O values"}
            aria-label={showPWMValues ? "Hide I/O values" : "Show I/O values"}
          >
            {showPWMValues ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Board Visualization */}
      <div className="flex-1 overflow-auto p-0 flex items-center justify-center bg-background min-h-0">
        {svgContent && overlaySvgContent ? (
          <div
            ref={containerRef}
            className="relative flex items-center justify-center"
            style={{
              filter: "drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4))",
              width: "100%",
              height: "100%",
            }}
          >
            {/* Darken overlay covering entire board area (not scaled) */}
            <div
              className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
              style={{
                background: "rgba(0,0,0,0.45)",
                opacity: simulationStatus === "running" ? 0 : 1,
                zIndex: 20,
              }}
            />
            {/* Scaled inner wrapper to fit both width and height */}
            <div
              ref={innerWrapperRef}
              style={{
                position: "relative",
                width: `${VIEWBOX_WIDTH}px`,
                height: `${VIEWBOX_HEIGHT}px`,
                transform: `scale(${scale})`,
                transformOrigin: "center",
              }}
            >
              {/* Main SVG - static background */}
              <div
                style={{ position: "relative", width: "100%", height: "100%" }}
                dangerouslySetInnerHTML={{ __html: getModifiedSvg() }}
              />
              {/* Overlay SVG - dynamic visualization and click handling */}
              <div
                ref={overlayRef}
                className="arduino-overlay absolute inset-0 w-full h-full"
                onClick={handleOverlayClick}
                dangerouslySetInnerHTML={{ __html: getOverlaySvg() }}
              />
              {/* analog dialog is rendered as a portal to avoid affecting layout */}
              <AnalogDialogPortal
                dialog={analogDialog}
                overlayRef={overlayRef}
                onClose={() => setAnalogDialog(null)}
                onConfirm={(pin: number, value: number) => {
                  try {
                    if (onAnalogChange) onAnalogChange(pin, value);
                  } finally {
                    setAnalogDialog(null);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Loading Arduino Board...</div>
        )}
      </div>
    </div>
  );
}

// Portal render function placed after component to keep JSX smaller
function AnalogDialogPortal(props: {
  dialog: {
    open: true;
    pin: number;
    value: number;
    leftPct: number;
    topPct: number;
    placement: "above" | "below";
  } | null;
  overlayRef: React.RefObject<HTMLDivElement> | null;
  onClose: () => void;
  onConfirm: (pin: number, value: number) => void;
}) {
  const { dialog, overlayRef, onClose, onConfirm } = props;
  if (!dialog || !overlayRef || !overlayRef.current) return null;

  try {
    const svgEl = overlayRef.current.querySelector("svg");
    if (!svgEl) return null;
    const idx = dialog.pin - 14;
    const el =
      svgEl.querySelector<SVGGraphicsElement>(`#pin-A${idx}-state`) ||
      svgEl.querySelector<SVGGraphicsElement>(`#pin-${dialog.pin}-state`);
    if (!el) return null;
    const rect = (el as Element).getBoundingClientRect();
    const dialogWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dialog-width-small').trim()) || 220;
    const dialogHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dialog-height-small').trim()) || 84;
    const pointerOffset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dialog-offset-pointer').trim()) || 6;
    const viewportMargin = 8;
    let left = rect.left + rect.width / 2 - dialogWidth / 2;
    let top =
      dialog.placement === "below"
        ? rect.bottom + pointerOffset
        : rect.top - dialogHeight - pointerOffset;
    // clamp to viewport
    left = Math.max(viewportMargin, Math.min(window.innerWidth - dialogWidth - viewportMargin, left));
    top = Math.max(viewportMargin, Math.min(window.innerHeight - dialogHeight - viewportMargin, top));

    return createPortal(
      <div
        style={{
          position: "fixed",
          left,
          top,
          width: dialogWidth,
          background: "rgba(20,20,20,0.95)",
          color: "var(--color-surface-muted)",
          padding: "var(--dialog-padding-inline)",
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          zIndex: 10000,
        }}
      >
        <div style={{ fontSize: "var(--fs-label-lg)", marginBottom: "var(--dialog-offset-pointer)" }}>
          {dialog.pin >= 14 && dialog.pin <= 19
            ? `A${dialog.pin - 14}`
            : dialog.pin}
        </div>
        <DialogInner dialog={dialog} onClose={onClose} onConfirm={onConfirm} />
      </div>,
      document.body,
    );
  } catch {
    return null;
  }
}

function DialogInner(props: {
  dialog: { open: true; pin: number; value: number };
  onClose: () => void;
  onConfirm: (pin: number, value: number) => void;
}) {
  const { dialog, onClose, onConfirm } = props;
  const [val, setVal] = useState<number>(dialog.value);
  useEffect(() => setVal(dialog.value), [dialog.value]);
  return (
    <div>
      <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
        <input
          type="range"
          min={0}
          max={1023}
          step={1}
          value={val}
          onChange={(e) => setVal(Number((e.target as HTMLInputElement).value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={0}
          max={1023}
          value={val}
          onChange={(e) =>
            setVal(Math.max(0, Math.min(1023, Number(e.target.value || 0))))
          }
          style={{
            width: 64,
            background: "transparent",
            color: "var(--color-surface-muted)",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "var(--space-xs)",
            borderRadius: 4,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-sm)",
          marginTop: "var(--space-sm)",
        }}
      >
        <Button
          onClick={onClose}
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          onClick={() => onConfirm(dialog.pin, val)}
          variant="default"
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
