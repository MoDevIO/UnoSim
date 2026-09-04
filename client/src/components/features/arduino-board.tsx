import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { Cpu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import { usePinPollingEngine } from "@/hooks/usePinPollingEngine";
import { onCustomEvent, offCustomEvent } from "@/utils/event-utils";
import { Logger } from "@shared/logger";
import type { RuntimeSimulationStatus } from "@shared/types/arduino.types";

const logger = new Logger("ArduinoBoard");

type TelemetryData = {
  intendedPinChangesPerSecond: number;
  droppedPinChangesPerSecond: number;
  batchesPerSecond: number;
  avgStatesPerBatch: number;
};

/** Displays live telemetry metrics in the board header (debug mode). */
const TelemetryMetrics = memo(function TelemetryMetrics({
  telemetry,
}: {
  telemetry: TelemetryData | null;
}) {
  return (
    <div
      className="ml-4 flex items-center gap-4 text-muted-foreground border-l border-muted-foreground/30 pl-4"
      style={{ fontSize: "var(--fs-body-xs)" }}
      data-testid="telemetry-metrics"
    >
      {telemetry ? (
        <>
          <div className="flex flex-col leading-tight" data-testid="telemetry-pin-changes">
            <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Pin Changes</span>
            <span className="font-mono text-cyan-400" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }} data-testid="telemetry-pin-changes-value">
              {telemetry.intendedPinChangesPerSecond.toFixed(0)} /s
              {telemetry.droppedPinChangesPerSecond > 0 && (
                <span className="ml-1 text-amber-400/80" data-testid="telemetry-dropped">
                  ({telemetry.droppedPinChangesPerSecond.toFixed(0)} dropped)
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col leading-tight" data-testid="telemetry-batching">
            <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Batching</span>
            <span className="font-mono text-cyan-400" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }} data-testid="telemetry-batching-value">
              {telemetry.batchesPerSecond.toFixed(0)} bat/s ·{" "}
              {telemetry.avgStatesPerBatch.toFixed(0)} st/bat
            </span>
          </div>
        </>
      ) : (
        <div className="flex flex-col leading-tight" data-testid="telemetry-loading">
          <span className="uppercase tracking-wider text-cyan-500/50" style={{ fontSize: "calc(9px * var(--ui-font-scale))" }}>Metrics</span>
          <span className="font-mono text-cyan-400/50" style={{ fontSize: "calc(11px * var(--ui-font-scale))" }}>…</span>
        </div>
      )}
    </div>
  );
});

/** Eye/EyeOff toggle button for I/O value visibility. */
const VisibilityToggle = memo(function VisibilityToggle({
  showPWMValues,
  onToggle,
}: {
  showPWMValues: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center ml-3">
      <Button
        variant="outline"
        size="sm"
        className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
        onClick={onToggle}
        title={showPWMValues ? "Hide I/O values" : "Show I/O values"}
        aria-label={showPWMValues ? "Hide I/O values" : "Show I/O values"}
      >
        {showPWMValues ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
});

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
  return content.replaceAll(/<\?xml[^?]*\?>/g, "");
}

/**
 * Parse pin number from a click-area element id (e.g. "pin-5-click", "pin-A2-click")
 */
function parsePinFromElement(el: Element): number | undefined {
  const digitalMatch = /^pin-(\d+)-click$/.exec(el.id);
  if (digitalMatch) return Number.parseInt(digitalMatch[1], 10);
  const analogMatch = /^pin-A(\d+)-click$/.exec(el.id);
  if (analogMatch) return 14 + Number.parseInt(analogMatch[1], 10);
  return undefined;
}

type SliderPosition = {
  pin: number;
  leftPct: number;
  topPct: number;
  value: number;
  sliderLen: number;
  placement: "above" | "below";
};

/**
 * Derive dialog placement from slider info and y-position.
 * Extracted to fix S3358 (nested ternary).
 */
function getAnalogDialogPlacement(
  info: SliderPosition | undefined,
  topPct: number,
): "above" | "below" {
  if (info) return info.placement;
  return topPct < 50 ? "below" : "above";
}

/**
 * Read a CSS custom property from :root and parse it as a number (px or raw).
 */
function getCssNumber(prop: string, fallback: number): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? fallback : n;
  } catch {
    return fallback;
  }
}

// SVG viewBox dimensions (from ArduinoUno.svg)
const VIEWBOX_WIDTH = 285.2;
const VIEWBOX_HEIGHT = 209;

/**
 * Gets computed spacing token values at runtime
 * Allows us to keep SVG scaling calculations using semantic variables
 */
function getComputedSpacingToken(tokenName: string): number {
  const FALLBACKS: Record<string, number> = {
    '--svg-safe-margin': 4,
    '--svg-label-padding': 2,
  };
  return getCssNumber(tokenName, FALLBACKS[tokenName] ?? 4);
}
/**
 * Compute slider positions for all analog pins from the overlay SVG element.
 * Extracted to reduce Cognitive Complexity of the slider-positions useEffect (S3776).
 */
function computeSliderPositionsFromSvg(
  svgEl: SVGSVGElement,
  analogPins: number[],
): SliderPosition[] {
  const positions: SliderPosition[] = [];
  for (const pin of analogPins) {
    if (pin < 14 || pin > 19) continue;
    const idx = pin - 14;
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
      if (el) { found = el; break; }
    }
    if (!found) continue;
    try {
      const bbox = found.getBBox();
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const leftPct = (cx / VIEWBOX_WIDTH) * 100;
      const topPct = (cy / VIEWBOX_HEIGHT) * 100;
      const rawLen = Math.max(16, Math.min(80, bbox.width * 3));
      const placement: "above" | "below" = cy < VIEWBOX_HEIGHT / 2 ? "below" : "above";
      positions.push({ pin, leftPct, topPct, value: 0, sliderLen: rawLen, placement });
    } catch {
      // ignore
    }
  }
  return positions;
}

/**
 * Dispatch a click on a pin element: opens analog dialog for analog pins,
 * or toggles value for digital INPUT pins.
 * Extracted to reduce Cognitive Complexity of handleOverlayClick (S3776).
 */
function dispatchPinClick(
  pin: number,
  pinStates: PinState[],
  analogPins: number[],
  sliderPositions: SliderPosition[],
  onPinToggle: (pin: number, newValue: number) => void,
  onAnalogChange: ((pin: number, value: number) => void) | undefined,
  onOpenAnalogDialog: (
    pin: number,
    value: number,
    leftPct: number,
    topPct: number,
    placement: "above" | "below",
  ) => void,
): void {
  const state = pinStates.find((p) => p.pin === pin);
  const usedAsAnalog = analogPins.includes(pin);
  if (pin >= 14 && pin <= 19 && onAnalogChange != null && usedAsAnalog) {
    const info = sliderPositions.find((s) => s.pin === pin);
    const val = state?.value ?? 0;
    const leftPct = info?.leftPct ?? 50;
    const topPct = info?.topPct ?? 50;
    const placement = getAnalogDialogPlacement(info, topPct);
    onOpenAnalogDialog(pin, val, leftPct, topPct, placement);
  } else if (state && (state.mode === "INPUT" || state.mode === "INPUT_PULLUP")) {
    const newValue = state.value > 0 ? 0 : 1;
    logger.debug(`[ArduinoBoard] Pin ${pin} clicked, toggling to ${newValue}`);
    onPinToggle(pin, newValue);
  }
}

/** Manages board color state, including persistence and custom event subscription. */
function useBoardColor(): string {
  const [boardColor, setBoardColor] = useState<string>(() => {
    try {
      return globalThis.localStorage.getItem("unoBoardColor") || "var(--color-brand-primary)";
    } catch {
      return "var(--color-brand-primary)";
    }
  });

  useEffect(() => {
    const onColor = (e: Event) => {
      const detail = (e as CustomEvent<{ color?: string }>).detail;
      const color = detail?.color || globalThis.localStorage.getItem("unoBoardColor") || "var(--color-brand-primary)";
      setBoardColor(color);
    };
    onCustomEvent(document, "arduinoColorChange", onColor);
    return () => offCustomEvent(document, "arduinoColorChange", onColor);
  }, []);

  return boardColor;
}

/** Manages debug mode state, including localStorage init and custom event subscription. */
function useDebugMode(): boolean {
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try {
      return globalThis.localStorage.getItem("unoDebugMode") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (ev: Event) => {
      const newValue = Boolean((ev as CustomEvent<{ value: boolean }>).detail?.value);
      setDebugMode(newValue);
    };
    onCustomEvent(document, "debugModeChange", handler);
    return () => offCustomEvent(document, "debugModeChange", handler);
  }, []);

  return debugMode;
}

export function ArduinoBoard({
  pinStates = [],
  isSimulationRunning = false,
  simulationStatus = "idle",
  txActive = 0,
  rxActive = 0,
  onReset,
  onPinToggle,
  analogPins = [],
  onAnalogChange,
}: ArduinoBoardProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const boardColor = useBoardColor();
  const [overlaySvgContent, setOverlaySvgContent] = useState<string>("");
  const [txBlink, setTxBlink] = useState(false);
  const [rxBlink, setRxBlink] = useState(false);
  const [showPWMValues, setShowPWMValues] = useState(false);
  const debugMode = useDebugMode();
  const { last: telemetry } = useTelemetryStore();
  const txTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
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
    setSliderPositions(computeSliderPositionsFromSvg(svgEl, analogPins));
  }, [overlaySvgContent, analogPins]);

  // Update slider values when pinStates changes (without triggering re-calculation of positions)
  useEffect(() => {
    setSliderPositions((prev) => {
      if (prev.length === 0) return prev;

      const pinMap = new Map(pinStates.map((p) => [p.pin, p]));
      let changed = false;
      const updated = prev.map((slider) => {
        const pinState = pinMap.get(slider.pin);
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
      if (pinClick && onPinToggle) {
        const pin = parsePinFromElement(pinClick);
        if (pin !== undefined) {
          dispatchPinClick(
            pin, pinStates, analogPins, sliderPositions, onPinToggle, onAnalogChange,
            (p, v, l, t, pl) => setAnalogDialog({ open: true, pin: p, value: v, leftPct: l, topPct: t, placement: pl }),
          );
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
    [onPinToggle, onReset, pinStates, sliderPositions, onAnalogChange, analogPins],
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

  // Derived SVG strings (memoized to avoid recomputation on every render)
  const modifiedSvg = useMemo(() => {
    if (!svgContent) return "";
    let modified = preprocessSvg(svgContent);
    try {
      const DEFAULT_BOARD_HEX = '#0f7391';
      modified = modified.replaceAll(new RegExp(DEFAULT_BOARD_HEX, 'gi'), boardColor);
    } catch { /* ignore regex errors */ }
    const opacity = 1;  // Always show board at full opacity (user requirement: board must be visible before-start and after-stop)
    return modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; opacity: ${opacity};" preserveAspectRatio="xMidYMid meet">`,
    );
  }, [svgContent, boardColor, simulationStatus]);

  const overlaySvg = useMemo(() => {
    if (!overlaySvgContent) return "";
    const modified = preprocessSvg(overlaySvgContent)
      .replaceAll('class="click-area"', 'class="click-area cursor-pointer"')
      .replace(
        /<svg([^>]*)>/,
        `<svg$1 style="width: 100%; height: 100%; display: block; position: absolute; top: 0; left: 0;" preserveAspectRatio="xMidYMid meet">`,
      );
    return modified;
  }, [overlaySvgContent]);

  return (
    <div className="h-full flex flex-col bg-card border-t border-border">
      {/* Header */}
      <div className="bg-muted px-[var(--header-padding-x)] border-b border-border flex items-center justify-between h-[var(--ui-header-height)] overflow-hidden">
        <div className="flex items-center space-x-2 min-w-0 whitespace-nowrap">
          <Cpu className="text-white opacity-95 h-5 w-5" strokeWidth={1.67} />
          <span className="sr-only">Arduino UNO Board</span>
          {debugMode && isSimulationRunning && (
            <TelemetryMetrics telemetry={telemetry} />
          )}
        </div>
        <VisibilityToggle
          showPWMValues={showPWMValues}
          onToggle={() => setShowPWMValues(!showPWMValues)}
        />
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
                opacity: 0,  // Overlay always hidden to keep board fully visible (user requirement: no black screen)
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
                dangerouslySetInnerHTML={{ __html: modifiedSvg }}
              />
              {/* TH Köln identity mark, placed on the ATmega chip block. */}
              <img
                src="/TH_Koeln_Logo.svg"
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{
                  left: "175px",
                  top: "135px",
                  width: "54px",
                  height: "18px",
                  objectFit: "contain",
                }}
              />
              {/* Overlay SVG - dynamic visualization and click handling */}
              <button
                type="button"
                ref={overlayRef as React.Ref<HTMLButtonElement>}
                className="arduino-overlay absolute inset-0 w-full h-full"
                aria-label="Arduino board interactive overlay. Click pins to toggle their state."
                onClick={handleOverlayClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleOverlayClick(e as unknown as React.MouseEvent);
                  }
                }}
                style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", display: "block", width: "100%", height: "100%" }}
              >
                <div dangerouslySetInnerHTML={{ __html: overlaySvg }} />
              </button>
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

interface AnalogDialogPortalProps {
  readonly dialog:
    | {
        open: true;
        pin: number;
        value: number;
        leftPct: number;
        topPct: number;
        placement: "above" | "below";
      }
    | null;
  readonly overlayRef: React.RefObject<HTMLElement> | null;
  readonly onClose: () => void;
  readonly onConfirm: (pin: number, value: number) => void;
}

function getAnalogDialogCoordinates(
  overlayRef: React.RefObject<HTMLElement> | null,
  dialog: {
    open: true;
    pin: number;
    placement: "above" | "below";
  },
) {
  if (!overlayRef?.current) return null;

  const svgEl = overlayRef.current.querySelector("svg");
  if (!svgEl) return null;

  const idx = dialog.pin - 14;
  const el =
    svgEl.querySelector<SVGGraphicsElement>(`#pin-A${idx}-state`) ||
    svgEl.querySelector<SVGGraphicsElement>(`#pin-${dialog.pin}-state`);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const dialogWidth = getCssNumber("--dialog-width-small", 220);
  const dialogHeight = getCssNumber("--dialog-height-small", 84);
  const pointerOffset = getCssNumber("--dialog-offset-pointer", 6);
  const viewportMargin = 8;

  let left = rect.left + rect.width / 2 - dialogWidth / 2;
  let top =
    dialog.placement === "below"
      ? rect.bottom + pointerOffset
      : rect.top - dialogHeight - pointerOffset;

  left = Math.max(viewportMargin, Math.min(globalThis.innerWidth - dialogWidth - viewportMargin, left));
  top = Math.max(viewportMargin, Math.min(globalThis.innerHeight - dialogHeight - viewportMargin, top));

  const pinLabel = dialog.pin >= 14 && dialog.pin <= 19 ? `A${dialog.pin - 14}` : `${dialog.pin}`;

  return { left, top, dialogWidth, dialogHeight, pinLabel };
}

function AnalogDialogPortal(props: AnalogDialogPortalProps) {
  const { dialog, overlayRef, onClose, onConfirm } = props;
  if (!dialog) return null;

  const coords = getAnalogDialogCoordinates(overlayRef, dialog);
  if (!coords) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: coords.left,
        top: coords.top,
        width: coords.dialogWidth,
        background: "rgba(20,20,20,0.95)",
        color: "var(--color-surface-muted)",
        padding: "var(--dialog-padding-inline)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        zIndex: 10000,
      }}
    >
      <div style={{ fontSize: "var(--fs-label-lg)", marginBottom: "var(--dialog-offset-pointer)" }}>
        {coords.pinLabel}
      </div>
      <DialogInner dialog={dialog} onClose={onClose} onConfirm={onConfirm} />
    </div>,
    document.body,
  );
}


function DialogInner(props: {
  readonly dialog: { open: true; pin: number; value: number };
  readonly onClose: () => void;
  readonly onConfirm: (pin: number, value: number) => void;
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
