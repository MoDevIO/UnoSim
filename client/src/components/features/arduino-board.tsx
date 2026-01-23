import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Cpu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logger } from "@shared/logger";

const logger = new Logger("ArduinoBoard");

interface PinState {
  pin: number;
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
  value: number; // analog: 0-1023, pwm: 0-255, digital: 0 or 1
  type: "digital" | "analog" | "pwm";
}

interface ArduinoBoardProps {
  pinStates?: PinState[];
  isSimulationRunning?: boolean;
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
const SAFE_MARGIN = 4; // px gap to window edges

// PWM-capable pins on Arduino UNO
const PWM_PINS = [3, 5, 6, 9, 10, 11];

export function ArduinoBoard({
  pinStates = [],
  isSimulationRunning = false,
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
      return window.localStorage.getItem("unoBoardColor") || "#0f7391";
    } catch {
      return "#0f7391";
    }
  });
  const [overlaySvgContent, setOverlaySvgContent] = useState<string>("");
  const [txBlink, setTxBlink] = useState(false);
  const [rxBlink, setRxBlink] = useState(false);
  const [showPWMValues, setShowPWMValues] = useState(false);
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
          "#0f7391";
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

  // Get pin color based on state
  const getPinColor = useCallback(
    (pin: number): string => {
      const state = pinStates.find((p) => p.pin === pin);
      if (!state) return "transparent";

      if (state.type === "pwm" && PWM_PINS.includes(pin)) {
        const intensity = Math.round((state.value / 255) * 255);
        if (intensity <= 0) return "transparent";
        return `rgb(${intensity}, 0, 0)`;
      }

      if (state.type === "analog") {
        // analog values expected 0..1023 -> map to 0..255 red intensity
        const v = Math.max(0, Math.min(1023, state.value));
        const intensity = Math.round((v / 1023) * 255);
        if (intensity <= 0) return "transparent";
        return `rgb(${intensity}, 0, 0)`;
      }

      // digital
      if (state.value > 0) {
        return "#ff0000";
      } else {
        return "#000000";
      }
    },
    [pinStates],
  );

  // Check if pin is INPUT
  const isPinInput = useCallback(
    (pin: number): boolean => {
      const state = pinStates.find((p) => p.pin === pin);
      return (
        state !== undefined &&
        (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")
      );
    },
    [pinStates],
  );

  // Stable reference to ALL current state for polling - updated on every render
  const stateRef = useRef({
    pinStates,
    isSimulationRunning,
    txBlink,
    rxBlink,
    analogPins,
    showPWMValues,
  });
  stateRef.current = {
    pinStates,
    isSimulationRunning,
    txBlink,
    rxBlink,
    analogPins,
    showPWMValues,
  };

  // Single stable polling loop for ALL SVG updates - runs ONCE, never restarts
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const performAllUpdates = () => {
      const svgEl = overlay.querySelector("svg");
      if (!svgEl) return;

      const { pinStates, isSimulationRunning, txBlink, rxBlink, analogPins } =
        stateRef.current;

      // Helper to check if pin is INPUT
      const isPinInput = (pin: number): boolean => {
        const state = pinStates.find((p) => p.pin === pin);
        return (
          state !== undefined &&
          (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")
        );
      };

      // Helper to get pin color
      const getPinColor = (pin: number): string => {
        const state = pinStates.find((p) => p.pin === pin);
        if (!state) return "transparent";

        const isPWM = PWM_PINS.includes(pin);
        if (state.type === "digital") {
          return state.value > 0 ? "#ff0000" : "#000000";
        } else if (isPWM && state.value > 0 && state.value < 255) {
          return "#ffa500";
        } else if (state.value >= 255) {
          return "#ff0000";
        }
        return "#000000";
      };

      // Update digital pins 0-13
      for (let pin = 0; pin <= 13; pin++) {
        const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-frame`);
        const state = svgEl.querySelector<SVGCircleElement>(
          `#pin-${pin}-state`,
        );
        const click = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-click`);

        const isInput = isPinInput(pin);
        const color = getPinColor(pin);

        if (frame) {
          frame.style.display = isInput ? "block" : "none";
          frame.style.filter = isInput
            ? "drop-shadow(0 0 2px #ffff00)"
            : "none";
        }

        if (state) {
          if (color === "transparent" || color === "#000000") {
            state.setAttribute("fill", "#000000");
            state.style.filter = "none";
          } else {
            state.setAttribute("fill", color);
            state.style.filter = `drop-shadow(0 0 3px ${color})`;
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

        const isInput = isPinInput(pinNumber);
        const usedAsAnalog = analogPins.includes(pinNumber);
        const color = getPinColor(pinNumber);

        if (frame) {
          const show = isInput || (usedAsAnalog && isSimulationRunning);
          frame.style.display = show ? "block" : "none";
          frame.style.filter = show ? "drop-shadow(0 0 2px #ffff00)" : "none";
          const pinState = pinStates.find((p) => p.pin === pinNumber);
          if (
            show &&
            usedAsAnalog &&
            (!pinState || pinState.type === "analog")
          ) {
            (frame as any).style.strokeDasharray = "3,2";
          } else {
            (frame as any).style.strokeDasharray = "";
          }
        }

        if (state) {
          if (color === "transparent" || color === "#000000") {
            state.setAttribute("fill", "#000000");
            state.style.filter = "none";
          } else {
            state.setAttribute("fill", color);
            state.style.filter = `drop-shadow(0 0 3px ${color})`;
          }
        }

        if (click) {
          const clickable = isInput || usedAsAnalog;
          click.style.pointerEvents = clickable ? "auto" : "none";
          click.style.cursor = clickable ? "pointer" : "default";
        }
      }

      // Update ALL LEDs
      const ledOn = svgEl.querySelector<SVGRectElement>("#led-on");
      const ledL = svgEl.querySelector<SVGRectElement>("#led-l");
      const ledTx = svgEl.querySelector<SVGRectElement>("#led-tx");
      const ledRx = svgEl.querySelector<SVGRectElement>("#led-rx");

      if (ledOn) {
        if (isSimulationRunning) {
          ledOn.setAttribute("fill", "#00ff00");
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
          ledL.setAttribute("fill", "#ffff00");
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
          ledTx.setAttribute("fill", "#ffff00");
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
          ledRx.setAttribute("fill", "#ffff00");
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
      const showLabels = !!showPWMValues;

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
        fill = "#ffffff",
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
          t.setAttribute("font-size", "8");
          t.setAttribute("fill", fill);
          t.setAttribute("stroke", "#000000");
          t.setAttribute("stroke-width", "0.4");
          t.setAttribute("paint-order", "stroke");
          t.setAttribute("dominant-baseline", "middle");
          (t as any).style.pointerEvents = "none";
          svgEl.appendChild(t);
        } else {
          if (anchorOverride) t.setAttribute("text-anchor", anchorOverride);
        }
        t.textContent = textValue;
        if (rotateLeft) {
          const fontSize = 8; // match actual font-size attribute
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
        existing.forEach((n) => ((n as SVGTextElement).style.display = "none"));
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
            const bb = (frameEl ?? (stateEl as any)).getBBox();
            const cx = bb.x + bb.width / 2;
            const cy = bb.y + bb.height / 2;
            const state = pinStates.find((p) => p.pin === pin);
            const valStr = state ? String(state.value) : "";
            // Place label either above (upper pins) or below (lower pins) the frame, and align inside the frame
            let translateY: number | undefined = undefined;
            let localX: number | undefined = undefined;
            let anchor: string | undefined = undefined;
            const padding = 2; // px gap to avoid overlap
            const fontSize = 8;
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
              "#ffffff",
              true,
              translateY,
              localX,
              anchor,
            );
          } catch (err) {
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
            const bb = (frameEl ?? (el as any)).getBBox();
            const cx = bb.x + bb.width / 2;
            const cy = bb.y + bb.height / 2;
            const pinNumber = 14 + i;
            const state = pinStates.find((p) => p.pin === pinNumber);
            const valStr = state ? String(state.value) : "";
            // Place analog pin label above (upper half) or below (lower half) and align inside the frame
            let translateYAnal: number | undefined = undefined;
            let localXAnal: number | undefined = undefined;
            let anchorAnal: string | undefined = undefined;
            const paddingAnal = 2;
            const fontSizeAnal = 8;
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
              "#ffffff",
              true,
              translateYAnal,
              localXAnal,
              anchorAnal,
            );
          } catch (err) {}
        }
      }
    };

    // Stable 10ms polling - interval NEVER restarts, reads current state from ref
    const intervalId = setInterval(performAllUpdates, 10);
    performAllUpdates();

    return () => clearInterval(intervalId);
  }, [isPinInput, getPinColor]); // Only depends on stable callbacks

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
        const bbox = (found as any).getBBox();
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
      } catch (err) {
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
          pin = parseInt(digitalMatch[1], 10);
        } else if (analogMatch) {
          // A0-A5 map to pins 14-19
          pin = 14 + parseInt(analogMatch[1], 10);
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
    // Replace the default board color (#0f7391) in the SVG with the chosen color.
    // We replace hex occurrences case-insensitively.
    try {
      modified = modified.replace(/#0f7391/gi, boardColor);
    } catch {}
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block;" preserveAspectRatio="xMidYMid meet">`,
    );
    return modified;
  };

  // Modify overlay SVG
  const getOverlaySvg = () => {
    if (!overlaySvgContent) return "";
    let modified = overlaySvgContent;
    modified = modified.replace(/<\?xml[^?]*\?>/g, "");
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; position: absolute; top: 0; left: 0;" preserveAspectRatio="xMidYMid meet">`,
    );
    return modified;
  };

  return (
    <div className="h-full flex flex-col bg-card border-t border-border">
      {/* Header */}
      <div className="bg-muted px-4 border-b border-border flex items-center justify-between h-[var(--ui-button-height)] overflow-hidden">
        <div className="flex items-center space-x-2 min-w-0 whitespace-nowrap">
          <Cpu className="text-white opacity-95 h-5 w-5" strokeWidth={1.67} />
          <span className="sr-only">Arduino UNO Board</span>
        </div>
        <div className="flex items-center ml-4">
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
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                }}
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
    const dialogWidth = 220;
    const dialogHeight = 84;
    let left = rect.left + rect.width / 2 - dialogWidth / 2;
    let top =
      dialog.placement === "below"
        ? rect.bottom + 6
        : rect.top - dialogHeight - 6;
    // clamp to viewport
    left = Math.max(8, Math.min(window.innerWidth - dialogWidth - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - dialogHeight - 8, top));

    return createPortal(
      <div
        style={{
          position: "fixed",
          left,
          top,
          width: dialogWidth,
          background: "rgba(20,20,20,0.95)",
          color: "#eee",
          padding: 8,
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          zIndex: 10000,
        }}
      >
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          {dialog.pin >= 14 && dialog.pin <= 19
            ? `A${dialog.pin - 14}`
            : dialog.pin}
        </div>
        <DialogInner dialog={dialog} onClose={onClose} onConfirm={onConfirm} />
      </div>,
      document.body,
    );
  } catch (err) {
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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            color: "#eee",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "4px",
            borderRadius: 4,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: "#ccc",
            border: "none",
            padding: "6px 8px",
            borderRadius: 4,
          }}
        >
          Abbrechen
        </button>
        <button
          onClick={() => onConfirm(dialog.pin, val)}
          style={{
            background: "#1f6feb",
            color: "#fff",
            border: "none",
            padding: "6px 8px",
            borderRadius: 4,
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
