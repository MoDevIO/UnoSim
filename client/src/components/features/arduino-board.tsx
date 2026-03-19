import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Cpu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { usePinPollingEngine } from "@/hooks/usePinPollingEngine";
import { onCustomEvent, offCustomEvent } from "@/utils/event-utils";
import { Logger } from "@shared/logger";
import type { RuntimeSimulationStatus } from "@shared/types/arduino.types";

const logger = new Logger("ArduinoBoard");

export interface PinState {
  pin: number;
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
  value: number; // analog: 0-1023, pwm: 0-255, digital: 0 or 1
  type: "digital" | "analog" | "pwm";
}

interface ArduinoBoardProps {
  readonly pinStates?: PinState[];
  readonly isSimulationRunning?: boolean;
  readonly simulationStatus?: RuntimeSimulationStatus;
  readonly txActive?: number; // TX activity counter (changes trigger blink)
  readonly rxActive?: number; // RX activity counter (changes trigger blink)
  readonly onReset?: () => void; // Callback when reset button is clicked
  readonly onPinToggle?: (pin: number, newValue: number) => void; // Callback when an INPUT pin is clicked
  readonly analogPins?: number[]; // array of internal pin numbers for analog pins (14..19)
  readonly onAnalogChange?: (pin: number, value: number) => void;
}

/**
 * Helper to clean up XML declarations and apply consistent SVG styles
 */
function preprocessSvg(content: string): string {
  return content.replace(/<\?xml[^?]*\?>/g, "");
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
      return globalThis.localStorage.getItem("unoBoardColor") || "var(--color-brand-primary)";
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
        // Read but don't store - SVG re-renders on next polling cycle
        cs.getPropertyValue("--ui-font-scale");
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
      .catch(() => {
        // Silently handle SVG loading failure
      });
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
          globalThis.localStorage.getItem("unoBoardColor") ||
          "var(--color-brand-primary)";
        setBoardColor(color);
      } catch {
        // ignore
      }
    };
    onCustomEvent(document, "arduinoColorChange", onColor);
    return () => offCustomEvent(document, "arduinoColorChange", onColor);
  }, []);

  // Listen for debug mode changes
  useEffect(() => {
    try {
      const stored = globalThis.localStorage.getItem("unoDebugMode") === "1";
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
    onCustomEvent(document, "debugModeChange", handler);
    return () => offCustomEvent(document, "debugModeChange", handler);
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
  const pinIsOnRef = useRef<Map<number, boolean>>(new Map());
  const pinTurnedOffAtRef = useRef<Map<number, number>>(new Map());

  // Use the polling engine hook for all SVG updates
  usePinPollingEngine({
    overlayRef,
    stateRef,
    pinIsOnRef,
    pinTurnedOffAtRef,
  });

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
        const bbox = found.getBBox();
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
  const getModifiedSvg = (): string => {
    if (!svgContent) return "";
    let modified = preprocessSvg(svgContent);
    
    // Replace the default board color (brand-primary token) in the SVG with the chosen color.
    try {
      const DEFAULT_BOARD_HEX = '#0f7391';
      modified = modified.replace(new RegExp(DEFAULT_BOARD_HEX, 'gi'), boardColor);
    } catch {
      // Ignore regex errors
    }
    
    // Apply opacity based on simulation status
    const opacity = simulationStatus === "running" ? 1 : 0.35;
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; opacity: ${opacity};" preserveAspectRatio="xMidYMid meet">`,
    );
    return modified;
  };

  // Modify overlay SVG (interactive, with click handlers)
  const getOverlaySvg = (): string => {
    if (!overlaySvgContent) return "";
    let modified = preprocessSvg(overlaySvgContent);
    
    // Add cursor pointer class for click areas
    modified = modified.replaceAll('class="click-area"', 'class="click-area cursor-pointer"');

    // Position absolutely and fill space
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
          {debugMode && isSimulationRunning && (
            <div className="ml-4 flex items-center gap-4 text-xs text-muted-foreground border-l border-muted-foreground/30 pl-4" data-testid="telemetry-metrics">
              {telemetry ? (
                <>
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
                </>
              ) : (
                <div className="flex flex-col" data-testid="telemetry-loading">
                  <span className="text-[10px] uppercase tracking-wider text-cyan-500/50">Metrics</span>
                  <span className="text-sm font-mono text-cyan-400/50">…</span>
                </div>
              )}
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
    left = Math.max(viewportMargin, Math.min(globalThis.innerWidth - dialogWidth - viewportMargin, left));
    top = Math.max(viewportMargin, Math.min(globalThis.innerHeight - dialogHeight - viewportMargin, top));

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
