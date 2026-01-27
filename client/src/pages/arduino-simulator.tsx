//arduino-simulator.tsx

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cpu,
  Terminal,
  Wrench,
  Trash2,
  ChevronsDown,
  BarChart,
  Monitor,
  Columns,
  X,
} from "lucide-react";
import { InputGroup } from "@/components/ui/input-group";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/features/code-editor";
import { SerialMonitor } from "@/components/features/serial-monitor";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { SketchTabs } from "@/components/features/sketch-tabs";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { ArduinoBoard } from "@/components/features/arduino-board";
import { AppHeader } from "@/components/features/app-header";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type {
  Sketch,
  ParserMessage,
  IOPinRecord,
  OutputLine,
} from "@shared/schema";
import { isMac } from "@/lib/platform";

// Lazy load SerialPlotter to defer recharts (~400KB) until needed
const SerialPlotter = lazy(() =>
  import("@/components/features/serial-plotter").then((m) => ({
    default: m.SerialPlotter,
  })),
);

// Loading placeholder for lazy components
const LoadingPlaceholder = () => (
  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
    <span className="text-ui-sm">Loading chart...</span>
  </div>
);

// Logger import
import { Logger } from "@shared/logger";
const logger = new Logger("ArduinoSimulator");

// Pin state interface for Arduino board visualization
interface PinState {
  pin: number;
  mode: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
  value: number;
  type: "digital" | "analog" | "pwm";
}

export default function ArduinoSimulator() {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState("");
  const [cliOutput, setCliOutput] = useState("");
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  const outputPanelRef = useRef<any>(null);
  const outputTabsHeaderRef = useRef<HTMLDivElement | null>(null);
  const [outputPanelMinPercent, setOutputPanelMinPercent] = useState<number>(3);

  // Tab management
  const [tabs, setTabs] = useState<
    Array<{ id: string; name: string; content: string }>
  >([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // CHANGED: Store OutputLine objects instead of plain strings
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [parserMessages, setParserMessages] = useState<ParserMessage[]>([]);
  const parserMessagesContainerRef = useRef<HTMLDivElement | null>(null);
  // Track if user manually dismissed the parser panel (reset on new compile with messages)
  const [parserPanelDismissed, setParserPanelDismissed] = useState(false);

  // Initialize I/O Registry with all 20 Arduino pins (will be populated at runtime)
  const [ioRegistry, setIoRegistry] = useState<IOPinRecord[]>(() => {
    const pins: IOPinRecord[] = [];
    // Digital pins 0-13
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    // Analog pins A0-A5
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    return pins;
  });

  const [compilationStatus, setCompilationStatus] = useState<
    "ready" | "compiling" | "success" | "error"
  >("ready");
  const [arduinoCliStatus, setArduinoCliStatus] = useState<
    "idle" | "compiling" | "success" | "error"
  >("idle");
  const [gccStatus, setGccStatus] = useState<
    "idle" | "compiling" | "success" | "error"
  >("idle");
  const [hasCompilationErrors, setHasCompilationErrors] = useState(false);
  const [lastCompilationResult, setLastCompilationResult] = useState<
    "success" | "error" | null
  >(null);
  const [compilationPanelSize, setCompilationPanelSize] = useState(3);
  const [activeOutputTab, setActiveOutputTab] = useState<
    "compiler" | "messages" | "registry"
  >("compiler");
  const [showCompilationOutput, setShowCompilationOutput] = useState<boolean>(
    () => {
      try {
        const stored = window.localStorage.getItem("unoShowCompileOutput");
        return stored === null ? true : stored === "1";
      } catch {
        return true;
      }
    },
  );
  const [simulationStatus, setSimulationStatus] = useState<
    "running" | "stopped" | "paused"
  >("stopped");
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [isModified, setIsModified] = useState(false);

  // Pin states for Arduino board visualization
  const [pinStates, setPinStates] = useState<PinState[]>([]);
  // Serial view mode (monitor / both / plotter)
  const [serialViewMode, setSerialViewMode] = useState<
    "monitor" | "plotter" | "both"
  >("monitor");
  const showSerialMonitor = serialViewMode !== "plotter";
  const showSerialPlotter = serialViewMode !== "monitor";
  // Autoscroll toggle for serial monitor
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);

  const cycleSerialViewMode = () => {
    setSerialViewMode((prev) => {
      if (prev === "monitor") return "both";
      if (prev === "both") return "plotter";
      return "monitor";
    });
  };
  // Analog pins detected in the code that need sliders (internal pin numbers 14..19)
  const [analogPinsUsed, setAnalogPinsUsed] = useState<number[]>([]);
  // Detected explicit pinMode(...) declarations found during parsing.
  // We store modes for pins so that we can apply them when the simulation starts.
  const [detectedPinModes, setDetectedPinModes] = useState<
    Record<number, "INPUT" | "OUTPUT" | "INPUT_PULLUP">
  >({});
  // Pins that have a detected pinMode(...) declaration which conflicts with analogRead usage
  const [pendingPinConflicts, setPendingPinConflicts] = useState<number[]>([]);

  // Centralized helper to reset UI pin-related state. Pass { keepDetected: true }
  // to preserve detected pinMode declarations and pending conflicts when desired.
  const resetPinUI = useCallback((opts?: { keepDetected?: boolean }) => {
    setPinStates([]);
    // Only clear detected/derived data when keepDetected is not requested.
    if (!opts?.keepDetected) {
      setAnalogPinsUsed([]);
      setDetectedPinModes({});
      setPendingPinConflicts([]);
    }
  }, []);

  // Simulation timeout setting (in seconds)
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);

  // Selected board and baud rate (moved to Tools menu)
  const [board, _setBoard] = useState<string>("Arduino UNO");
  const [baudRate, _setBaudRate] = useState<number>(115200);

  // Serial input box state (always visible at bottom of serial frame)
  const [serialInputValue, setSerialInputValue] = useState("");

  // Hidden file input for File → Load Files
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Listen for debug mode change events from settings dialog (disabled)
  useEffect(() => {
    const handler = (_ev: any) => {
      try {
        // Debug mode toggle removed
      } catch {
        // ignore
      }
    };
    document.addEventListener("debugModeChange", handler as EventListener);
    return () =>
      document.removeEventListener("debugModeChange", handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = (ev: any) => {
      try {
        const newValue = Boolean(ev?.detail?.value);
        setShowCompilationOutput(newValue);
        // Persist to localStorage
        try {
          window.localStorage.setItem(
            "unoShowCompileOutput",
            newValue ? "1" : "0",
          );
        } catch {
          // localStorage may be unavailable (private browsing, etc.)
        }
      } catch {
        // ignore
      }
    };
    document.addEventListener(
      "showCompileOutputChange",
      handler as EventListener,
    );
    return () =>
      document.removeEventListener(
        "showCompileOutputChange",
        handler as EventListener,
      );
  }, []);

  // Persist showCompilationOutput state to localStorage whenever it changes
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "unoShowCompileOutput",
        showCompilationOutput ? "1" : "0",
      );
    } catch {
      // localStorage may be unavailable (private browsing, etc.)
    }
  }, [showCompilationOutput]);

  // Helper to download all tabs (used by File -> Download All Files)
  const downloadAllFiles = async () => {
    try {
      tabs.forEach((tab, index) => {
        setTimeout(() => {
          const element = document.createElement("a");
          element.setAttribute(
            "href",
            "data:text/plain;charset=utf-8," + encodeURIComponent(tab.content),
          );
          element.setAttribute("download", tab.name);
          element.style.display = "none";
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
        }, index * 200);
      });

      setTimeout(
        () => {
          toast({
            title: "Download started",
            description: `${tabs.length} file(s) will be downloaded`,
          });
        },
        tabs.length * 200 + 100,
      );
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  // Handler for hidden file input change
  const handleHiddenFileInput = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fl = e.target.files;
    if (!fl || fl.length === 0) return;
    const files: Array<{ name: string; content: string }> = [];
    for (const f of Array.from(fl)) {
      if (!f.name.endsWith(".ino") && !f.name.endsWith(".h")) continue;
      try {
        const txt = await f.text();
        files.push({ name: f.name, content: txt });
      } catch {}
    }
    if (files.length > 0) handleFilesLoaded(files, false);
    e.target.value = "";
  };

  // Helper to request the global Settings dialog to open (App listens for this event)
  const openSettings = () => {
    try {
      window.dispatchEvent(new CustomEvent("open-settings"));
    } catch {}
  };

  const handleSerialInputSend = () => {
    if (!serialInputValue.trim()) return;
    handleSerialSend(serialInputValue);
    setSerialInputValue("");
  };

  const handleSerialInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSerialInputSend();
  };

  // RX/TX LED activity counters (increment on activity for change detection)
  const [txActivity, setTxActivity] = useState(0);
  const [rxActivity, setRxActivity] = useState(0);
  // Track wall-clock time when last serial_event was received
  const lastSerialEventAtRef = useRef<number>(0);
  // Queue for incoming serial_events - use ref to avoid React batching issues
  const serialEventQueueRef = useRef<
    Array<{ payload: any; receivedAt: number }>
  >([]);
  // Trigger state to force processing
  const [serialQueueTrigger, setSerialQueueTrigger] = useState(0);

  // Mobile UI: detect small screens and provide a floating tab full-screen view
  const isClient = typeof window !== "undefined";
  const mqQuery = "(max-width: 768px)";
  const initialIsMobile = isClient ? window.matchMedia(mqQuery).matches : false;
  const [isMobile, setIsMobile] = useState<boolean>(initialIsMobile);
  // Initialize mobilePanel immediately on mount when on mobile to avoid flicker/delay
  const [mobilePanel, setMobilePanel] = useState<
    "code" | "compile" | "serial" | "board" | null
  >(initialIsMobile ? "code" : null);

  useEffect(() => {
    if (!isClient) return;
    const mq = window.matchMedia(mqQuery);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const matches = "matches" in e ? e.matches : mq.matches;
      setIsMobile(matches);
      // If switching into mobile mode, open code panel immediately
      if (matches && !mobilePanel) setMobilePanel("code");
      // If switching out of mobile, close any mobile panel
      if (!matches) setMobilePanel(null);
    };
    // Modern browsers: addEventListener; fallback to addListener
    if (typeof mq.addEventListener === "function")
      mq.addEventListener("change", onChange as any);
    else mq.addListener(onChange as any);
    return () => {
      if (typeof mq.removeEventListener === "function")
        mq.removeEventListener("change", onChange as any);
      else mq.removeListener(onChange as any);
    };
  }, [isClient, mobilePanel]);

  // Prevent body scroll when mobile panel is open
  useEffect(() => {
    if (!isClient) return;
    const prev = document.body.style.overflow;
    if (mobilePanel) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = prev || "";
    }
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [mobilePanel, isClient]);

  // Compute header height so mobile overlay can sit below it (preserve normal header)
  const [headerHeight, setHeaderHeight] = useState<number>(40);
  const [overlayZ, setOverlayZ] = useState<number>(30);
  useEffect(() => {
    if (!isClient) return;
    const measure = () => {
      // First try to find our mobile header by data attribute
      let hdr: Element | null = document.querySelector("[data-mobile-header]");
      // Fallback to <header> tag
      if (!hdr) hdr = document.querySelector("header");
      if (!hdr) {
        const all = Array.from(
          document.body.querySelectorAll("*"),
        ) as HTMLElement[];
        hdr =
          all.find((el) => {
            if (!el) return false;
            // ignore html/body
            if (el === document.body || el === document.documentElement)
              return false;
            const style = getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity) === 0
            )
              return false;
            const r = el.getBoundingClientRect();
            // must be near the top and reasonably small (not full-page)
            if (r.top < -5 || r.top > 48) return false;
            if (r.height < 24 || r.height > window.innerHeight / 2)
              return false;
            return true;
          }) || null;
      }

      if (hdr === document.body || hdr === document.documentElement) hdr = null;

      let h = 40;
      if (hdr) {
        const rect = (hdr as HTMLElement).getBoundingClientRect();
        if (rect.height > 0 && rect.height < window.innerHeight / 2)
          h = Math.ceil(rect.height);
      }
      setHeaderHeight(h);

      let z = 0;
      if (hdr) {
        const zStr = getComputedStyle(hdr as HTMLElement).zIndex;
        const zNum = parseInt(zStr || "", 10);
        z = Number.isFinite(zNum) ? zNum : 0;
      }
      const chosenZ = z > 0 ? Math.max(z - 1, 5) : 30;
      setOverlayZ(chosenZ);
      logger.debug(
        `[mobile overlay] header detect: ${hdr} headerHeight=${h} overlayZ=${chosenZ}`,
      );
    };

    measure();
    window.addEventListener("resize", measure);
    const hdr = document.querySelector("header");
    if (hdr) {
      const obs = new MutationObserver(measure);
      obs.observe(hdr, { attributes: true, childList: true, subtree: true });
      return () => {
        window.removeEventListener("resize", measure);
        obs.disconnect();
      };
    }
  }, [isClient]);

  // Update compilation panel size based on error content and parser messages
  useEffect(() => {
    // Reset parserPanelDismissed when new errors occur (auto-reopen logic)
    if (hasCompilationErrors && cliOutput.trim().length > 0) {
      setParserPanelDismissed(false);
      setShowCompilationOutput(true);

      // Auto-show and size panel for compiler errors
      const lines = cliOutput.split("\n").length;
      const totalChars = cliOutput.length;
      const HEADER_HEIGHT = 50;
      const PER_LINE = 20;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;

      const lineBasedPx =
        HEADER_HEIGHT +
        PADDING +
        Math.max(lines, Math.ceil(totalChars / 80)) * PER_LINE;
      const newSize = Math.min(
        75,
        Math.max(25, Math.ceil((lineBasedPx / AVAILABLE_HEIGHT) * 100)),
      );

      setCompilationPanelSize(newSize);
    } else if (parserMessages.length > 0 && !hasCompilationErrors) {
      // Reset dismissal flag and show panel for new parser messages (auto-reopen)
      setParserPanelDismissed(false);
      setShowCompilationOutput(true);
      setActiveOutputTab("messages");

      // Auto-show and size panel for parser messages (spec 3.2)
      const messageCount = parserMessages.length;
      const totalMessageLength = parserMessages.reduce(
        (sum, msg) => sum + (msg.message?.length || 0),
        0,
      );
      const HEADER_HEIGHT = 50;
      const PER_MESSAGE_BASE = 55;
      const PADDING = 60;
      const AVAILABLE_HEIGHT = 800;

      // SSOT formula (based on count + text length)
      const estimatedPx =
        HEADER_HEIGHT +
        PADDING +
        messageCount * PER_MESSAGE_BASE +
        Math.ceil(totalMessageLength / 100) * 15;
      const estimatedPercent = Math.min(
        75,
        Math.max(25, Math.ceil((estimatedPx / AVAILABLE_HEIGHT) * 100)),
      );

      // Measure rendered message container to ensure all containers stay visible
      const headerEl = outputTabsHeaderRef.current;
      const headerHeightPx = headerEl
        ? Math.ceil(headerEl.getBoundingClientRect().height || HEADER_HEIGHT)
        : HEADER_HEIGHT;
      let measuredPercent = estimatedPercent;

      try {
        const panelNode = headerEl?.closest("[data-panel]") as
          | HTMLElement
          | null;
        const groupNode = panelNode?.parentElement as HTMLElement | null;
        const groupHeightPx = Math.ceil(
          groupNode?.getBoundingClientRect().height || 0,
        );
        const messagesHeightPx = parserMessagesContainerRef.current
          ? Math.ceil(parserMessagesContainerRef.current.scrollHeight)
          : 0;

        if (groupHeightPx > 0) {
          const measuredPx = headerHeightPx + messagesHeightPx;
          measuredPercent = Math.min(
            75,
            Math.max(25, Math.ceil((measuredPx / groupHeightPx) * 100)),
          );
        }
      } catch {
        // Fallback to estimatedPercent
      }

      const newSize = Math.min(75, Math.max(25, Math.max(estimatedPercent, measuredPercent)));
      setCompilationPanelSize(newSize);
    } else if (
      lastCompilationResult === "success" &&
      !hasCompilationErrors &&
      parserMessages.length === 0
    ) {
      // Minimize panel when no errors and no messages (keep visible at 3%)
      setCompilationPanelSize(3);
    }
  }, [
    cliOutput,
    hasCompilationErrors,
    lastCompilationResult,
    parserMessages.length,
  ]);

  // Apply panel size imperatively to ResizablePanel using absolute pixel floor
  const enforceOutputPanelFloor = useCallback(
    (forceResize: boolean = false) => {
      if (!showCompilationOutput) return;
      const headerEl = outputTabsHeaderRef.current;
      const panelHandle = outputPanelRef.current;
      if (!headerEl || !panelHandle) return;

      const panelNode = headerEl.closest("[data-panel]") as HTMLElement | null;
      const groupNode = panelNode?.parentElement as HTMLElement | null;
      if (!panelNode || !groupNode) return;

      const headerRect = headerEl.getBoundingClientRect();
      const headerHeight = Math.ceil(headerRect.height);
      const groupHeight = Math.ceil(groupNode.getBoundingClientRect().height);
      if (!groupHeight || headerHeight <= 0) return;

      // Enforce absolute minimum height (px) equal to the header height (plus 0 gap target).
      // The panel is the bottom panel; keeping it at header height keeps the header near the bottom edge.
      const absoluteMinPx = headerHeight;
      const currentMinPx = parseInt(panelNode.style.minHeight || "0", 10);
      if (Number.isNaN(currentMinPx) || currentMinPx !== absoluteMinPx) {
        panelNode.style.minHeight = `${absoluteMinPx}px`;
      }

      // Convert absolute floor to percentage only for library API calls
      const minPercent = Math.max((absoluteMinPx / groupHeight) * 100, 3);
      const targetMinPercent = Math.min(75, minPercent);

      setOutputPanelMinPercent((prev) =>
        Math.abs(prev - targetMinPercent) > 0.01 ? targetMinPercent : prev,
      );

      if (
        typeof panelHandle.getSize === "function" &&
        typeof panelHandle.resize === "function"
      ) {
        const currentSize = panelHandle.getSize();
        if (typeof currentSize === "number") {
          const target = forceResize
            ? targetMinPercent // when forced (e.g., example load), snap to computed floor
            : Math.max(currentSize, targetMinPercent);
          if (Math.abs(currentSize - target) > 0.01) {
            panelHandle.resize(target);
          }
        }
      }
    },
    [showCompilationOutput],
  );

  useEffect(() => {
    if (
      outputPanelRef.current &&
      typeof outputPanelRef.current.resize === "function"
    ) {
      outputPanelRef.current.resize(compilationPanelSize);
    }
    // No floor enforcement here - allow automatic compilation/parser-driven sizing
  }, [compilationPanelSize]);

  useEffect(() => {
    const handleResize = () =>
      requestAnimationFrame(() => enforceOutputPanelFloor(true));
    const handleUiScale: EventListener = () => {
      // Double rAF to ensure CSS has fully applied and DOM has re-rendered
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          enforceOutputPanelFloor(true); // Force resize on scale change
          // Additional delayed enforcement for complex layout changes
          setTimeout(() => enforceOutputPanelFloor(true), 50);
        });
      });
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("uiFontScaleChange", handleUiScale);
    document.addEventListener("uiFontScaleChange", handleUiScale);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("uiFontScaleChange", handleUiScale);
      document.removeEventListener("uiFontScaleChange", handleUiScale);
    };
  }, [enforceOutputPanelFloor]);

  // ResizeObserver to continuously enforce floor when panel group size changes (e.g., when dragging divider)
  useEffect(() => {
    if (!showCompilationOutput) return;

    const headerEl = outputTabsHeaderRef.current;
    const panelNode = headerEl?.closest("[data-panel]") as HTMLElement | null;
    const groupNode = panelNode?.parentElement as HTMLElement | null;

    if (!groupNode) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => enforceOutputPanelFloor(true));
    });

    observer.observe(groupNode);
    return () => observer.disconnect();
  }, [showCompilationOutput, enforceOutputPanelFloor]);

  // Initial floor enforcement on first layout
  useEffect(() => {
    // Run after first paint to ensure DOM sizes are available
    requestAnimationFrame(() => enforceOutputPanelFloor(true));
  }, [enforceOutputPanelFloor]);

  // Re-enforce output panel floor when code changes (e.g., loading new example)
  // Use iterative correction loop until gap reaches 0, same approach as ResizeObserver
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const correctUntilFlush = () => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts++;

      const headerEl = outputTabsHeaderRef.current;
      if (!headerEl) return;

      const panelNode = headerEl.closest("[data-panel]") as HTMLElement | null;
      const groupNode = panelNode?.parentElement as HTMLElement | null;
      if (!panelNode || !groupNode) return;

      const headerRect = headerEl.getBoundingClientRect();
      const groupRect = groupNode.getBoundingClientRect();
      const gap = Math.round(groupRect.bottom - headerRect.bottom);

      enforceOutputPanelFloor(true);

      // If gap still exists, schedule another correction
      if (gap > 1) {
        requestAnimationFrame(correctUntilFlush);
      }
    };

    // Start after a brief delay to let DOM settle
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(correctUntilFlush);
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [code, enforceOutputPanelFloor]);

  // Auto-switch output tab based on errors and messages
  useEffect(() => {
    if (hasCompilationErrors) {
      setActiveOutputTab("compiler");
    } else if (parserMessages.length > 0 && !parserPanelDismissed) {
      setActiveOutputTab("messages");
    }
  }, [hasCompilationErrors, parserMessages.length, parserPanelDismissed]);

  // Backend availability tracking
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendPingError, setBackendPingError] = useState<string | null>(null);

  // Ref to track if backend was ever unreachable (for recovery toast)
  const wasBackendUnreachableRef = useRef(false);

  // Ref to track previous backend reachable state for detecting transitions
  const prevBackendReachableRef = useRef(true);

  const { toast } = useToast();
  // transient screen glitch on compile error
  const [showErrorGlitch, setShowErrorGlitch] = useState(false);
  const triggerErrorGlitch = (duration = 600) => {
    try {
      setShowErrorGlitch(true);
      window.setTimeout(() => setShowErrorGlitch(false), duration);
    } catch {}
  };
  const queryClient = useQueryClient();
  const {
    isConnected,
    connectionError,
    hasEverConnected,
    lastMessage,
    messageQueue,
    consumeMessages,
    sendMessage,
  } = useWebSocket();
  // Mark some hook values as intentionally read to avoid TS unused-local errors
  void isConnected;
  void lastMessage;

  // Backend / websocket reachability notifications
  useEffect(() => {
    if (connectionError) {
      toast({
        title: "Backend unreachable",
        description: connectionError,
        variant: "destructive",
      });
    } else if (!isConnected && hasEverConnected) {
      toast({
        title: "Connection lost",
        description: "Trying to re-establish backend connection...",
        variant: "destructive",
      });
    }
  }, [connectionError, isConnected, hasEverConnected, toast]);

  // Lightweight backend ping every second
  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      try {
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) {
          setBackendReachable(true);
          setBackendPingError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setBackendReachable(false);
          setBackendPingError((err as Error)?.message || "Health check failed");
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const interval = setInterval(ping, 1000);
    ping();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Show toast when HTTP backend becomes unreachable or recovers
  useEffect(() => {
    if (!backendReachable) {
      wasBackendUnreachableRef.current = true;
      toast({
        title: "Backend unreachable",
        description: backendPingError || "Could not reach API server.",
        variant: "destructive",
      });
    } else if (backendReachable && wasBackendUnreachableRef.current) {
      // Backend recovered after being unreachable
      wasBackendUnreachableRef.current = false;
      toast({
        title: "Backend reachable again",
        description: "Connection restored.",
      });
    }
  }, [backendReachable, backendPingError, toast]);

  const ensureBackendConnected = (actionLabel: string) => {
    if (!backendReachable || !isConnected) {
      toast({
        title: "Backend unreachable",
        description:
          backendPingError ||
          connectionError ||
          `${actionLabel} failed because the backend is not reachable. Please check the server or retry in a moment.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const isBackendUnreachableError = (error: unknown) => {
    const message = (error as Error | undefined)?.message || "";
    return (
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("ERR_CONNECTION") ||
      message.includes("Network request failed")
    );
  };

  // Fetch default sketch
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ["/api/sketches"],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: backendReachable, // Only query if backend is reachable
  });

  // Refetch sketches when backend becomes reachable again (false -> true transition)
  useEffect(() => {
    const wasUnreachable = !prevBackendReachableRef.current;
    const isNowReachable = backendReachable;

    // Update the ref for next check
    prevBackendReachableRef.current = backendReachable;

    if (wasUnreachable && isNowReachable) {
      // Backend just transitioned from unreachable to reachable
      logger.info("[Backend] Recovered, refetching queries...");
      queryClient.refetchQueries({ queryKey: ["/api/sketches"] });
    }
  }, [backendReachable, queryClient]);

  // Upload mutation (used by Compile → Upload)
  const uploadMutation = useMutation({
    mutationFn: async (payload: {
      code: string;
      headers?: Array<{ name: string; content: string }>;
    }) => {
      // Attempt to call a backend upload endpoint; backend can implement this to actually flash hardware
      const response = await apiRequest("POST", "/api/upload", payload);
      // Be tolerant: some backends may return plain text (204 or HTML). Try to parse JSON, otherwise return text.
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return await response.json();
        } catch (err) {
          // Malformed JSON — return raw text instead
          const txt = await response.text();
          return { success: response.ok, raw: txt } as any;
        }
      }
      const txt = await response.text();
      return { success: response.ok, raw: txt } as any;
    },
    onSuccess: (data) => {
      // data may be an object with shape { success, ... } or { raw: text }
      if (data && (data as any).success) {
        toast({
          title: "Upload started",
          description: "Upload initiated to connected device.",
        });
      } else if (data && typeof (data as any).raw === "string") {
        const txt = String((data as any).raw || "").trim();
        if (txt.length === 0) {
          // Some backends return 204 No Content or an empty response — treat as success
          toast({
            title: "Upload started",
            description: "Upload initiated to connected device.",
          });
        } else {
          toast({ title: "Upload response", description: txt.slice(0, 200) });
        }
      } else {
        toast({
          title: "Upload failed",
          description:
            data && (data as any).error
              ? (data as any).error
              : "Upload did not succeed.",
          variant: "destructive",
        });
      }
    },

    onError: (err) => {
      const backendDown = isBackendUnreachableError(err);
      toast({
        title: backendDown ? "Backend unreachable" : "Upload failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : (err as Error)?.message || "Upload failed",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Clear the flag after any attempt
      try {
        doUploadOnCompileSuccessRef.current = false;
        lastCompilePayloadRef.current = null;
      } catch {}
    },
  });

  // Ref to request upload after successful compile and to store last compile payload
  const doUploadOnCompileSuccessRef = useRef(false);
  const lastCompilePayloadRef = useRef<{
    code: string;
    headers?: Array<{ name: string; content: string }>;
  } | null>(null);
  // Ref to skip stopping simulation when a suggestion is inserted
  const skipSimStopRef = useRef(false);

  // Compilation mutation
  const compileMutation = useMutation({
    mutationFn: async (payload: {
      code: string;
      headers?: Array<{ name: string; content: string }>;
    }) => {
      setArduinoCliStatus("compiling");
      setLastCompilationResult(null);
      const response = await apiRequest("POST", "/api/compile", payload);
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return await response.json();
        } catch (err) {
          const txt = await response.text();
          return { success: false, errors: txt, raw: txt } as any;
        }
      }
      const txt = await response.text();
      return { success: false, errors: txt, raw: txt } as any;
    },
    onSuccess: (data) => {
      if (data.success) {
        setArduinoCliStatus("success");
        setHasCompilationErrors(false);
        setLastCompilationResult("success");
        // REPLACE output, don't append
        setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
      } else {
        setArduinoCliStatus("error");
        setHasCompilationErrors(true);
        setLastCompilationResult("error");
        // trigger global red glitch to indicate compile error
        triggerErrorGlitch();
        // REPLACE output, don't append
        setCliOutput(data.errors || "✗ Arduino-CLI Compilation failed.");
      }

      // Update parser messages from compile response
      if (data.parserMessages && Array.isArray(data.parserMessages)) {
        setParserMessages(data.parserMessages);
        // Auto-show parser panel if there are new messages (reset dismissed state)
        if (data.parserMessages.length > 0) {
          setParserPanelDismissed(false);
        }
      }

      toast({
        title: data.success
          ? "Arduino-CLI Compilation succeeded"
          : "Arduino-CLI Compilation failed",
        description: data.success
          ? "Your sketch has been compiled successfully"
          : "There were errors in your sketch",
        variant: data.success ? undefined : "destructive",
      });

      // If the user requested a compile → upload, perform upload after successful compilation
      try {
        if (doUploadOnCompileSuccessRef.current) {
          doUploadOnCompileSuccessRef.current = false;
          if (data.success) {
            const payload = lastCompilePayloadRef.current;
            if (payload) {
              logger.info(
                `[CLIENT] Uploading compiled artifact... ${JSON.stringify(payload)}`,
              );
              uploadMutation.mutate(payload);
            } else {
              toast({
                title: "Upload failed",
                description: "No compiled artifact available to upload.",
                variant: "destructive",
              });
            }
          } else {
            toast({
              title: "Upload canceled",
              description: "Compilation failed — upload canceled.",
              variant: "destructive",
            });
          }
        }
      } catch (err) {
        console.error("Error handling post-compile upload", err);
      }
    },
    onError: (error) => {
      setArduinoCliStatus("error");
      // network/backend or unexpected compile error — show glitch as well
      triggerErrorGlitch();
      const backendDown = isBackendUnreachableError(error);
      toast({
        title: backendDown
          ? "Backend unreachable"
          : "Compilation with Arduino-CLI Failed",
        description: backendDown
          ? "API server unreachable. Please check the backend or reload."
          : "There were errors in your sketch",
        variant: "destructive",
      });
    },
  });

  // Stop simulation mutation
  const stopMutation = useMutation({
    mutationFn: async () => {
      sendMessage({ type: "stop_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("stopped");
      // Clear serial event queue to prevent buffered characters from appearing after stop
      serialEventQueueRef.current = [];
      // Reset UI pin state on stop but preserve detected pinMode declarations
      resetPinUI({ keepDetected: true });
    },
  });

  // Pause simulation mutation
  const pauseMutation = useMutation({
    mutationFn: async () => {
      sendMessage({ type: "pause_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("paused");
    },
    onError: () => {
      toast({
        title: "Pause failed",
        description: "Could not pause simulation",
        variant: "destructive",
      });
    },
  });

  // Resume simulation mutation
  const resumeMutation = useMutation({
    mutationFn: async () => {
      sendMessage({ type: "resume_simulation" });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
    },
    onError: () => {
      toast({
        title: "Resume failed",
        description: "Could not resume simulation",
        variant: "destructive",
      });
    },
  });

  // Start simulation mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      // Reset UI before starting a fresh simulation but preserve detected pinMode info
      resetPinUI({ keepDetected: true });
      sendMessage({ type: "start_simulation", timeout: simulationTimeout });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus("running");
      toast({
        title: "Simulation Started",
        description: "Arduino simulation is now running",
      });
      // If there are any pending pin conflicts detected during parsing,
      // append a warning to the compilation output so the user sees it in
      // the Compiler panel after starting the simulation.
      try {
        if (pendingPinConflicts && pendingPinConflicts.length > 0) {
          const names = pendingPinConflicts
            .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
            .join(", ");
          setCliOutput(
            (prev) =>
              (prev ? prev + "\n\n" : "") +
              `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`,
          );
          // Clear pending after showing once
          setPendingPinConflicts([]);
        }
      } catch {}
    },
    onError: (error: any) => {
      toast({
        title: "Start Failed",
        description: error.message || "Could not start simulation",
        variant: "destructive",
      });
      if (isModified && hasCompiledOnce) {
        toast({
          title: "Code Modified",
          description: "Compile to apply your latest changes",
        });
      }
    },
  });

  useEffect(() => {
    // Reset status when code actually changes
    // Reset both labels to idle when code changes
    if (arduinoCliStatus !== "idle") setArduinoCliStatus("idle");
    if (gccStatus !== "idle") setGccStatus("idle");
    if (compilationStatus !== "ready") setCompilationStatus("ready");

    // Note: Simulation stopping on code change is now handled in handleCodeChange
  }, [code]);

  useEffect(() => {
    if (serialOutput.length === 0) {
      // Serial output is empty
    }
  }, [serialOutput]);

  // Load default sketch on mount
  useEffect(() => {
    if (sketches && sketches.length > 0 && !currentSketch) {
      const defaultSketch = sketches[0];
      setCurrentSketch(defaultSketch);
      setCode(defaultSketch.content);

      // Initialize tabs with the default sketch
      const defaultTabId = "default-sketch";
      setTabs([
        {
          id: defaultTabId,
          name: "sketch.ino",
          content: defaultSketch.content,
        },
      ]);
      setActiveTabId(defaultTabId);
    }
  }, [sketches]);

  // Persist code changes to the active tab
  useEffect(() => {
    if (activeTabId && tabs.length > 0) {
      setTabs((prevTabs) =>
        prevTabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content: code } : tab,
        ),
      );
    }
  }, [code, activeTabId]);

  // NEW: Keyboard shortcuts (only for non-editor actions)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events originating from input-like elements
      const tgt = e.target as HTMLElement | null;
      const ignoreTarget =
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable);
      if (ignoreTarget) return;

      // F5: Compile only (Verify)
      if (e.key === "F5") {
        e.preventDefault();
        if (!compileMutation.isPending) {
          handleCompile();
        }
      }

      // Escape: Stop simulation
      if (e.key === "Escape" && simulationStatus === "running") {
        e.preventDefault();
        handleStop();
      }

      // Meta/Ctrl + U: Compile & Start (same as Start Simulation)
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        if (!compileMutation.isPending && !startMutation.isPending) {
          handleCompileAndStart();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    compileMutation.isPending,
    startMutation.isPending,
    simulationStatus,
    isMac,
  ]);

  // NEW: Auto format function
  const formatCode = () => {
    let formatted = code;

    // Basic C++ formatting rules
    // 1. Normalize line endings
    formatted = formatted.replace(/\r\n/g, "\n");

    // 2. Add newlines after opening braces
    formatted = formatted.replace(/\{\s*/g, "{\n");

    // 3. Add newlines before closing braces
    formatted = formatted.replace(/\s*\}/g, "\n}");

    // 4. Indent blocks (simple 2-space indentation)
    const lines = formatted.split("\n");
    let indentLevel = 0;
    const indentedLines = lines.map((line) => {
      const trimmed = line.trim();

      // Decrease indent for closing braces
      if (trimmed.startsWith("}")) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const indented = "  ".repeat(indentLevel) + trimmed;

      // Increase indent after opening braces
      if (trimmed.endsWith("{")) {
        indentLevel++;
      }

      return indented;
    });

    formatted = indentedLines.join("\n");

    // 5. Remove multiple consecutive blank lines
    formatted = formatted.replace(/\n{3,}/g, "\n\n");

    // 6. Ensure newline at end of file
    if (!formatted.endsWith("\n")) {
      formatted += "\n";
    }

    setCode(formatted);

    toast({
      title: "Code Formatted",
      description: "Code has been automatically formatted",
    });
  };

  // Editor commands helper
  const runEditorCommand = (cmd: "undo" | "redo" | "find" | "selectAll") => {
    const ed = editorRef.current as any;
    if (!ed) {
      toast({
        title: "No active editor",
        description: "Open the main editor to run this command.",
      });
      return;
    }
    if (typeof ed[cmd] === "function") {
      try {
        ed[cmd]();
      } catch (err) {
        console.error("Editor command failed", err);
      }
    } else {
      toast({
        title: "Command not available",
        description: `Editor does not support ${cmd}.`,
      });
    }
  };

  // Copy handler: copies selected text to clipboard
  const handleCopy = () => {
    const ed = editorRef.current as any;
    if (!ed || typeof ed.copy !== "function") {
      toast({
        title: "Command not available",
        description: "Copy is not supported by the current editor.",
      });
      return;
    }
    try {
      ed.copy();
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  // Cut handler: copies selected text to clipboard and deletes selection
  const handleCut = () => {
    const ed = editorRef.current as any;
    if (!ed || typeof ed.cut !== "function") {
      toast({
        title: "Command not available",
        description: "Cut is not supported by the current editor.",
      });
      return;
    }
    try {
      ed.cut();
    } catch (err) {
      console.error("Cut failed", err);
    }
  };

  // Paste handler: read from clipboard and insert at cursor/replace selection
  const handlePaste = () => {
    const ed = editorRef.current as any;
    if (!ed || typeof ed.paste !== "function") {
      toast({
        title: "Command not available",
        description: "Paste is not supported by the current editor.",
      });
      return;
    }
    try {
      ed.paste();
    } catch (err) {
      console.error("Paste failed", err);
    }
  };

  // Go to Line: prompt user for a line number and move cursor there
  const handleGoToLine = () => {
    const ed = editorRef.current as any;
    if (!ed || typeof ed.goToLine !== "function") {
      toast({
        title: "Command not available",
        description: "Go to Line is not supported by the current editor.",
      });
      return;
    }
    const input = prompt("Go to line number:");
    if (!input) return;
    const num = Number(input);
    if (!Number.isFinite(num) || num <= 0) {
      toast({
        title: "Invalid line number",
        description: "Please enter a positive number.",
      });
      return;
    }
    try {
      ed.goToLine(num);
    } catch (err) {
      console.error("Go to line failed", err);
    }
  };

  // Handle WebSocket messages - process ALL messages in the queue
  useEffect(() => {
    if (messageQueue.length === 0) return;

    // Consume all messages from the queue
    const messages = consumeMessages();

    for (const message of messages) {
      switch (message.type) {
        case "serial_output": {
          // NEW: Handle isComplete flag for Serial.print() vs Serial.println()
          let text = (message.data ?? "").toString();
          const isComplete = message.isComplete ?? true; // Default to true for backwards compatibility

          // Trigger RX LED blink when client receives data
          setRxActivity((prev) => prev + 1);

          // System messages (stop/timeout/etc.) must always be shown, even if serial_event traffic was recent
          const trimmedForSystemCheck = text.trimStart();
          const isSystemSerialMessage =
            trimmedForSystemCheck.startsWith("---") ||
            trimmedForSystemCheck.startsWith("Simulation ");

          // If we recently received structured `serial_event` messages, ignore legacy `serial_output` to avoid duplicates
          const now = Date.now();
          if (
            lastSerialEventAtRef.current &&
            now - lastSerialEventAtRef.current < 1000 &&
            !isSystemSerialMessage
          ) {
            // Short-circuit: drop this legacy serial_output
            // eslint-disable-next-line no-console
            logger.debug(
              `Dropping legacy serial_output because recent serial_event exists ${JSON.stringify({ text, ageMs: now - lastSerialEventAtRef.current })}`,
            );
            break;
          }

          // Remove trailing newlines from text (they are represented by isComplete flag)
          const isNewlineOnly = text === "\n" || text === "\r\n";
          if (isNewlineOnly) {
            text = ""; // Don't add the newline character to the text
          }

          setSerialOutput((prev) => {
            const newLines = [...prev];

            if (isComplete) {
              // Check if last line is incomplete - if so, complete it
              if (
                newLines.length > 0 &&
                !newLines[newLines.length - 1].complete
              ) {
                // Complete the existing incomplete line (add text only if non-empty)
                newLines[newLines.length - 1] = {
                  text: newLines[newLines.length - 1].text + text,
                  complete: true,
                };
              } else {
                // Complete line without pending incomplete - add as new line only if text is non-empty
                if (text.length > 0) {
                  newLines.push({ text, complete: true });
                }
              }
            } else {
              // Incomplete line (from Serial.print) - append to last line or create new
              if (
                newLines.length === 0 ||
                newLines[newLines.length - 1].complete
              ) {
                // Last line is complete or no lines exist - start new incomplete line
                newLines.push({ text, complete: false });
              } else {
                // Last line is incomplete - append to it WITHOUT changing complete status
                newLines[newLines.length - 1] = {
                  text: newLines[newLines.length - 1].text + text,
                  complete: false, // Keep it incomplete
                };
              }
            }

            return newLines;
          });
          break;
        }
        case "serial_event": {
          // Only queue serial events if simulation is running
          if (simulationStatus === "running") {
            const payload = (message as any).payload || {};
            // Record arrival time so we can suppress duplicate legacy serial_output messages
            const receivedAt = Date.now();
            // Trigger RX LED blink when client receives structured data
            setRxActivity((prev) => prev + 1);
            lastSerialEventAtRef.current = receivedAt;

            // Use push() to avoid race conditions when multiple events arrive simultaneously
            // This mutates the array directly instead of creating a new one
            serialEventQueueRef.current.push({ payload, receivedAt });
            // Trigger processing
            setSerialQueueTrigger((t) => t + 1);
          }
          break;
        }
        case "compilation_status":
          if (message.arduinoCliStatus !== undefined) {
            setArduinoCliStatus(message.arduinoCliStatus);
          }
          if (message.gccStatus !== undefined) {
            setGccStatus(message.gccStatus);
            // Reset GCC status to idle after a short delay (like CLI)
            if (
              message.gccStatus === "success" ||
              message.gccStatus === "error"
            ) {
              setTimeout(() => {
                setGccStatus("idle");
              }, 2000);
            }
          }
          if (message.message) {
            setCliOutput(message.message);
          }
          break;
        case "compilation_error":
          // For GCC errors: REPLACE previous output, do not append
          // Arduino-CLI reported success, but GCC failed
          logger.info(
            `[WS] GCC Compilation Error detected: ${JSON.stringify(message.data)}`,
          );
          setCliOutput("❌ GCC Compilation Error:\n\n" + message.data);
          setGccStatus("error");
          setCompilationStatus("error");
          setSimulationStatus("stopped");
          // Reset GCC status to idle after a short delay
          setTimeout(() => {
            setGccStatus("idle");
          }, 2000);
          break;
        case "simulation_status":
          setSimulationStatus(message.status);
          // Reset pin states and compilation status when simulation stops
          if (message.status === "stopped") {
            // Clear any pending serial-event tracking so system messages aren't dropped after stop
            lastSerialEventAtRef.current = 0;
            serialEventQueueRef.current = [];
            // Preserve detected pinMode declarations when simulation stops
            resetPinUI({ keepDetected: true });
            setCompilationStatus("ready");
          }
          break;
        case "pin_state": {
          // Update pin state for Arduino board visualization
          const { pin, stateType, value } = message;
          setPinStates((prev) => {
            const newStates = [...prev];
            const existingIndex = newStates.findIndex((p) => p.pin === pin);

            if (existingIndex >= 0) {
              // Update existing pin state
              if (stateType === "mode") {
                const modeMap: {
                  [key: number]: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
                } = {
                  0: "INPUT",
                  1: "OUTPUT",
                  2: "INPUT_PULLUP",
                };
                // If a mode update comes from the runtime (pinMode call), consider this an explicit
                // digital usage — convert an auto-detected 'analog' type to 'digital' so the UI
                // shows a solid frame instead of dashed.
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  mode: modeMap[value] || "INPUT",
                  type:
                    newStates[existingIndex].type === "analog"
                      ? "digital"
                      : newStates[existingIndex].type,
                };
              } else if (stateType === "value") {
                // Update value only. Do NOT change the pin `type` based on incoming
                // value updates — `pinMode` (runtime or parsed) controls whether a
                // pin is considered digital. For analog pins that were never
                // explicitly `pinMode`-ed, new entries (below) will be created
                // with type 'analog'. Here we preserve existing.type.
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  value,
                };
              } else if (stateType === "pwm") {
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  value,
                  type: "pwm",
                };
              }
            } else {
              // Add new pin state
              const modeMap: {
                [key: number]: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
              } = {
                0: "INPUT",
                1: "OUTPUT",
                2: "INPUT_PULLUP",
              };
              newStates.push({
                pin,
                mode:
                  stateType === "mode" ? modeMap[value] || "INPUT" : "OUTPUT",
                value: stateType === "value" || stateType === "pwm" ? value : 0,
                // New pins on 14..19 are analog by default when a value arrives
                // and we haven't seen an explicit pinMode yet.
                type:
                  stateType === "pwm"
                    ? "pwm"
                    : pin >= 14 && pin <= 19
                      ? "analog"
                      : "digital",
              });
            }

            return newStates;
          });
          break;
        }
        case "io_registry": {
          // Update I/O Registry from runtime execution
          const { registry } = message;
          setIoRegistry(registry);

          // Analyze registry for pinMode inconsistencies and add to parser messages
          const ioMessages = analyzeIORegistry(registry);
          if (ioMessages.length > 0) {
            let hasNewMessages = false;
            setParserMessages((prev) => {
              // Remove older pinMode-duplicate messages for the same pin so we only show one entry per pin
              const cleanedPrev = prev.filter((existing) => {
                if (existing.category !== "pins") return true;
                const pinMatch = existing.message.match(
                  /Pin\s+(\S+)\s+has\s+pinMode/,
                );
                if (!pinMatch) return true;
                const pinKey = pinMatch[1];
                const isReplaced = ioMessages.some((m) => {
                  if (m.category !== "pins") return false;
                  const newMatch = m.message.match(
                    /Pin\s+(\S+)\s+has\s+pinMode/,
                  );
                  return newMatch && newMatch[1] === pinKey;
                });
                return !isReplaced;
              });

              // Merge new IO messages with existing messages, avoiding duplicates by message content
              const existingMessages = new Set(
                cleanedPrev.map((m) => `${m.category}:${m.message}`),
              );
              const newMessages = ioMessages.filter(
                (m) => !existingMessages.has(`${m.category}:${m.message}`),
              );
              if (newMessages.length > 0) {
                hasNewMessages = true;
              }
              return [...cleanedPrev, ...newMessages];
            });
            // Reset dismissed state to show the panel with new messages
            if (hasNewMessages) {
              setParserPanelDismissed(false);
            }
          }
          break;
        }
      }
    }
  }, [messageQueue, consumeMessages]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsModified(true);

    // Stop simulation when user edits the code (unless inserting a suggestion)
    sendMessage({ type: "code_changed" });
    if (simulationStatus === "running" && !skipSimStopRef.current) {
      setSimulationStatus("stopped");
      // Reset all UI pin state when code changes while running
      resetPinUI();
    }
    skipSimStopRef.current = false;
    // Detected pin modes and pending conflicts are cleared as part of resetPinUI

    // Update the active tab content
    if (activeTabId) {
      setTabs(
        tabs.map((tab) =>
          tab.id === activeTabId ? { ...tab, content: newCode } : tab,
        ),
      );
    }
  };

  // Parse the current code to detect which analog pins are used by name or channel
  useEffect(() => {
    let mainCode = code;
    if (!mainCode && tabs.length > 0) mainCode = tabs[0].content || "";

    const pins = new Set<number>();
    const varMap = new Map<string, number>();

    // Detect #define VAR A0 or #define VAR 0
    const defineRe = /#define\s+(\w+)\s+(A\d|\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = defineRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // Detect simple variable assignments like: int sensorPin = A0; or const int s = 0;
    const assignRe =
      /(?:int|const\s+int|uint8_t|byte)\s+(\w+)\s*=\s*(A\d|\d+)\s*;/g;
    while ((m = assignRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // Find all analogRead(...) occurrences
    const areadRe = /analogRead\s*\(\s*([^\)]+)\s*\)/g;
    while ((m = areadRe.exec(mainCode))) {
      const token = m[1].trim();
      // strip possible casts or expressions (very simple handling)
      const simple = token.match(/^(A\d+|\d+|\w+)$/i);
      if (!simple) continue;
      const tok = simple[1];
      // If token is A<n>
      const aMatch = tok.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        continue;
      }
      // If numeric literal
      if (/^\d+$/.test(tok)) {
        const idx = Number(tok);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        else if (idx >= 14 && idx <= 19) pins.add(idx);
        continue;
      }
      // Otherwise assume variable name - resolve from varMap
      if (varMap.has(tok)) {
        pins.add(varMap.get(tok)!);
      }
    }

    // Detect for-loops like: for (byte i=16; i<20; i++) { ... analogRead(i) ... }
    const forLoopRe =
      /for\s*\(\s*(?:byte|int|unsigned|uint8_t)?\s*(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;[^\)]*\)\s*\{([\s\S]*?)\}/g;
    let fm: RegExpExecArray | null;
    while ((fm = forLoopRe.exec(mainCode))) {
      const varName = fm[1];
      const start = Number(fm[2]);
      const cmp = fm[3];
      const end = Number(fm[4]);
      const body = fm[5];
      const useRe = new RegExp(
        "analogRead\\s*\\(\\s*" + varName + "\\s*\\)",
        "g",
      );
      if (useRe.test(body)) {
        const inclusive = cmp === "<=";
        const last = inclusive ? end : end - 1;
        for (let pin = start; pin <= last; pin++) {
          // If the loop iterates over analog channel numbers (0..5) or internal pins (14..19 or 16..19), handle mapping
          if (pin >= 0 && pin <= 5) pins.add(14 + pin);
          else if (pin >= 14 && pin <= 19) pins.add(pin);
          else if (pin >= 16 && pin <= 19) pins.add(pin);
        }
      }
    }

    const arr = Array.from(pins).sort((a, b) => a - b);
    setAnalogPinsUsed(arr);

    // Do NOT prepopulate `pinStates` for detected analog pins here —
    // showing analog-only frames should only happen when the simulation
    // is actually running. Populate `pinStates` for analog pins when
    // `simulationStatus` becomes 'running' (see separate effect below).

    // Detect explicit pinMode calls in code so pins become clickable even before runtime updates
    // Examples: pinMode(A0, INPUT); pinMode(14, INPUT_PULLUP);
    const pinModeRe =
      /pinMode\s*\(\s*(A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;
    const digitalPinsFromPinMode = new Set<number>();
    while ((m = pinModeRe.exec(mainCode))) {
      const token = m[1];
      const modeToken = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        // Treat numeric literals in pinMode(...) as literal Arduino pin numbers.
        const idx = Number(token);
        if (idx >= 0 && idx <= 255) p = idx;
      }
      if (p !== undefined) {
        digitalPinsFromPinMode.add(p);
        const mode =
          modeToken === "INPUT_PULLUP"
            ? "INPUT_PULLUP"
            : modeToken === "OUTPUT"
              ? "OUTPUT"
              : "INPUT";

        // For analog-numbered pins (14..19), do NOT immediately insert into
        // `pinStates`. We want analog pins (even when used via pinMode(Ax,...))
        // to become visible only when the simulation starts. Record the detected
        // mode in `detectedPinModes` so it can be applied on simulation start.
        if (p >= 14 && p <= 19) {
          setDetectedPinModes((prev) => ({ ...prev, [p]: mode }));
        } else {
          // Non-analog pins: make them clickable immediately
          setPinStates((prev) => {
            const newStates = [...prev];
            const exists = newStates.find((x) => x.pin === p);
            if (!exists) {
              newStates.push({
                pin: p,
                mode: mode as any,
                value: 0,
                type: "digital",
              });
            } else {
              exists.mode = mode as any;
              exists.type = "digital";
            }
            return newStates;
          });
        }
      }
    }

    // If any pin is both declared via pinMode(...) and used with analogRead(...), warn the user
    try {
      const overlap = Array.from(pins).filter((p) =>
        digitalPinsFromPinMode.has(p),
      );
      if (overlap.length > 0) {
        // Store conflicts and show them when simulation starts
        setPendingPinConflicts(overlap);
        console.warn(
          "[arduino-simulator] Pin usage conflict for pins:",
          overlap
            .map((p) => (p >= 14 && p <= 19 ? `A${p - 14}` : `${p}`))
            .join(", "),
        );
      } else {
        setPendingPinConflicts([]);
      }
    } catch {}
  }, [code, tabs, activeTabId]);

  // When the simulation starts, apply recorded pinMode declarations and
  // populate any detected analog pins so they become clickable and show
  // their frames only while the simulation is running.
  useEffect(() => {
    if (simulationStatus !== "running") return;

    setPinStates((prev) => {
      const newStates = [...prev];

      // Apply recorded pinMode(...) declarations (including analog-numbered pins)
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({
            pin,
            mode: mode as any,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        } else {
          exists.mode = mode as any;
          if (pin >= 14 && pin <= 19) exists.type = "digital";
        }
      }

      // Ensure detected analog pins are present (as analog) if not already
      for (const pin of analogPinsUsed) {
        if (pin < 14 || pin > 19) continue;
        const exists = newStates.find((p) => p.pin === pin);
        if (!exists) {
          newStates.push({ pin, mode: "INPUT", value: 0, type: "analog" });
        }
      }

      return newStates;
    });
  }, [simulationStatus, analogPinsUsed, detectedPinModes]);

  // Helper to process serial event data and update lines
  const processSerialEvents = (
    events: Array<{ payload: any; receivedAt: number }>,
    currentLines: OutputLine[],
  ): OutputLine[] => {
    if (events.length === 0) return currentLines;

    // Sort events by original write timestamp when available (fallback to receivedAt)
    const sortedEvents = [...events].sort((a, b) => {
      const ta =
        a.payload && typeof a.payload.ts_write === "number"
          ? a.payload.ts_write
          : a.receivedAt;
      const tb =
        b.payload && typeof b.payload.ts_write === "number"
          ? b.payload.ts_write
          : b.receivedAt;
      return ta - tb;
    });

    let newLines: OutputLine[] = [...currentLines];

    for (const { payload } of sortedEvents) {
      // Normalize data: ensure string but PRESERVE control chars for Serial Monitor
      const piece: string = (payload.data || "").toString();

      // Handle backspace at the start of this piece - apply to previous line
      let text = piece;
      if (text.includes("\b")) {
        let backspaceCount = 0;
        let idx = 0;
        while (idx < text.length && text[idx] === "\b") {
          backspaceCount++;
          idx++;
        }

        if (
          backspaceCount > 0 &&
          newLines.length > 0 &&
          !newLines[newLines.length - 1].complete
        ) {
          // Remove characters from the last incomplete line
          const lastLine = newLines[newLines.length - 1];
          lastLine.text = lastLine.text.slice(
            0,
            Math.max(0, lastLine.text.length - backspaceCount),
          );
          text = text.slice(backspaceCount);
        }
      }

      // Process remaining text
      if (!text) continue;

      // Check for newlines
      if (text.includes("\n")) {
        const pos = text.indexOf("\n");
        const beforeNewline = text.substring(0, pos);
        const afterNewline = text.substring(pos + 1);

        // Append text before newline to current line and mark complete
        if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
          newLines.push({ text: beforeNewline, complete: true });
        } else {
          newLines[newLines.length - 1].text += beforeNewline;
          newLines[newLines.length - 1].complete = true;
        }

        // Handle text after newline
        if (afterNewline) {
          newLines.push({ text: afterNewline, complete: false });
        }
      } else {
        // No newline - append to last incomplete line or create new
        if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
          newLines.push({ text: text, complete: false });
        } else {
          newLines[newLines.length - 1].text += text;
        }
      }
    }

    return newLines;
  };

  // Process queued serial events in order - process immediately without debounce
  // Each event is processed as it arrives to ensure proper backspace handling
  useEffect(() => {
    const queue = serialEventQueueRef.current;
    if (queue.length === 0) return;

    // Take all events from the ref queue
    const eventsToProcess = [...queue];
    serialEventQueueRef.current = [];

    // Use functional update to avoid stale closure issues with serialOutput
    setSerialOutput((prevOutput) => {
      return processSerialEvents(eventsToProcess, prevOutput);
    });
  }, [serialQueueTrigger]);

  // When simulation stops, flush any pending incomplete lines to make them visible
  useEffect(() => {
    if (simulationStatus === "stopped" && serialOutput.length > 0) {
      const lastLine = serialOutput[serialOutput.length - 1];
      if (lastLine && !lastLine.complete) {
        // Mark last incomplete line as complete so it displays
        setSerialOutput((prev) => {
          if (prev.length === 0) return prev;
          return [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1], complete: true },
          ];
        });
      }
    }
  }, [simulationStatus]);

  // Tab management handlers
  const handleTabClick = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      setActiveTabId(tabId);
      setCode(tab.content);
      setIsModified(false);

      // Note: Simulation continues running when switching tabs
      // Clear previous outputs only if needed, but keep simulation running
    }
  };

  const handleTabAdd = () => {
    const newTabId = Math.random().toString(36).substr(2, 9);
    const newTab = {
      id: newTabId,
      name: `header_${tabs.length}.h`,
      content: "",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
    setCode("");
    setIsModified(false);
  };

  const handleFilesLoaded = (
    files: Array<{ name: string; content: string }>,
    replaceAll: boolean,
  ) => {
    if (replaceAll) {
      // Stop simulation if running
      if (simulationStatus === "running") {
        sendMessage({ type: "stop_simulation" });
      }

      // Replace all tabs with new files
      const inoFiles = files.filter((f) => f.name.endsWith(".ino"));
      const hFiles = files.filter((f) => f.name.endsWith(".h"));

      // Put .ino file first, then all .h files
      const orderedFiles = [...inoFiles, ...hFiles];

      const newTabs = orderedFiles.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));

      setTabs(newTabs);

      // Set the main .ino file as active
      const inoTab = newTabs[0]; // Should be at index 0 now
      if (inoTab) {
        setActiveTabId(inoTab.id);
        setCode(inoTab.content);
        setIsModified(false);
      }

      // Clear previous outputs and stop simulation
      setCliOutput("");
      setSerialOutput([]);
      // Reset UI pin state and detected pin-mode info
      resetPinUI();
      setCompilationStatus("ready");
      setArduinoCliStatus("idle");
      setGccStatus("idle");
      setLastCompilationResult(null);
      setSimulationStatus("stopped");
      setHasCompiledOnce(false);
    } else {
      // Add only .h files to existing tabs
      const newHeaderFiles = files.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));

      setTabs([...tabs, ...newHeaderFiles]);
    }
  };

  const handleLoadExample = (filename: string, content: string) => {
    // Stop simulation if running
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
    }

    // Create a new sketch from the example, using the filename as the tab name
    const newTab = {
      id: Math.random().toString(36).substr(2, 9),
      name: filename,
      content: content,
    };

    setTabs([newTab]);
    setActiveTabId(newTab.id);
    setCode(content);
    setIsModified(false);
    // Reset output panel sizing and tabs when loading a fresh example
    setCompilationPanelSize(3);
    setActiveOutputTab("compiler");

    // Clear previous outputs and messages
    setCliOutput("");
    setSerialOutput([]);
    setParserMessages([]); // Clear parser messages
    setIoRegistry(() => {
      const pins: IOPinRecord[] = [];
      for (let i = 0; i <= 13; i++) pins.push({ pin: String(i), defined: false, usedAt: [] });
      for (let i = 0; i <= 5; i++) pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
      return pins;
    });
    setCompilationStatus("ready");
    setArduinoCliStatus("idle");
    setGccStatus("idle");
    setLastCompilationResult(null);
    setSimulationStatus("stopped");
    setHasCompiledOnce(false);
    setActiveOutputTab("compiler"); // Always reset to compiler tab
    setOutputPanelMinPercent(5); // Minimize output panel
    setCompilationPanelSize(5); // Minimize output panel size
    setParserPanelDismissed(false); // Ensure panel is not dismissed
  };

  /**
   * Analyze IO Registry for pinMode inconsistencies and generate parser messages
   */
  const analyzeIORegistry = (registry: IOPinRecord[]): ParserMessage[] => {
    const messages: ParserMessage[] = [];

    for (const record of registry) {
      const ops = record.usedAt || [];
      const pinModeOps = ops.filter((u) => u.operation.includes("pinMode"));

      if (pinModeOps.length === 0) continue;

      // Extract pinMode modes
      const pinModes = pinModeOps.map((u) => {
        const match = u.operation.match(/pinMode:(\d+)/);
        const mode = match ? parseInt(match[1]) : -1;
        return mode === 0
          ? "INPUT"
          : mode === 1
            ? "OUTPUT"
            : mode === 2
              ? "INPUT_PULLUP"
              : "UNKNOWN";
      });

      const uniqueModes = [...new Set(pinModes)];
      const hasMultipleModes = uniqueModes.length > 1;

      if (hasMultipleModes) {
        // Get first line where pinMode was called for this pin
        const firstPinModeOp = pinModeOps[0];
        const line = firstPinModeOp.line || undefined;

        messages.push({
          id: crypto.randomUUID(),
          type: "warning",
          category: "pins",
          severity: 2,
          message: `Pin ${record.pin} has inconsistent pinMode() configurations: ${uniqueModes.join(", ")}. This may cause unexpected behavior.`,
          suggestion: `// Use consistent pinMode for pin ${record.pin}`,
          line,
        });
      } else if (pinModeOps.length > 1) {
        // Multiple calls with same mode - info message
        const mode = uniqueModes[0];
        const firstPinModeOp = pinModeOps[0];
        const line = firstPinModeOp.line || undefined;

        messages.push({
          id: crypto.randomUUID(),
          type: "info",
          category: "pins",
          severity: 1,
          message: `Pin ${record.pin} has pinMode(${record.pin}, ${mode}) called ${pinModeOps.length} times. Consider calling it only once in setup().`,
          line,
        });
      }
    }

    return messages;
  };

  const handleTabClose = (tabId: string) => {
    // Prevent closing the first tab (the .ino file)
    if (tabId === tabs[0]?.id) {
      toast({
        title: "Cannot Delete",
        description: "The main sketch file cannot be deleted",
        variant: "destructive",
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      // Switch to the previous or next tab
      if (newTabs.length > 0) {
        const newActiveTab = newTabs[newTabs.length - 1];
        setActiveTabId(newActiveTab.id);
        setCode(newActiveTab.content);
      } else {
        setActiveTabId(null);
        setCode("");
      }
    }
  };

  const handleTabRename = (tabId: string, newName: string) => {
    setTabs(
      tabs.map((tab) => (tab.id === tabId ? { ...tab, name: newName } : tab)),
    );
  };

  const handleCompile = () => {
    setCliOutput("");
    setSerialOutput([]);
    setParserMessages([]);
    // Reset all pin-related UI state (including detectedPinModes)
    resetPinUI();
    // Reset IO-Registry to initial state with all pins
    const pins: IOPinRecord[] = [];
    for (let i = 0; i <= 13; i++) {
      pins.push({ pin: String(i), defined: false, usedAt: [] });
    }
    for (let i = 0; i <= 5; i++) {
      pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
    }
    setIoRegistry(pins);

    // Get the actual main sketch code - use editor ref if available,
    // otherwise use state
    let mainSketchCode: string;
    if (activeTabId === tabs[0]?.id && editorRef.current) {
      // If the main tab is active, get the latest code from the editor
      mainSketchCode = editorRef.current.getValue();
    } else {
      // Otherwise use the stored content
      mainSketchCode = tabs[0]?.content || code;
    }

    // Prepare header files (all tabs except the first)
    const headers = tabs.slice(1).map((tab) => ({
      name: tab.name,
      content: tab.content,
    }));
    logger.info(`[CLIENT] Compiling with ${headers.length} headers`);
    // Store payload so we can upload it after compile if requested
    lastCompilePayloadRef.current = { code: mainSketchCode, headers };
    compileMutation.mutate({ code: mainSketchCode, headers });
  };

  const handleStop = () => {
    if (!ensureBackendConnected("Simulation stoppen")) return;
    stopMutation.mutate();
  };

  const handleStart = () => {
    if (!ensureBackendConnected("Simulation starten")) return;
    startMutation.mutate();
  };

  const handlePause = () => {
    if (!ensureBackendConnected("Simulation pausieren")) return;
    pauseMutation.mutate();
  };

  const handleResume = () => {
    if (!ensureBackendConnected("Simulation fortsetzen")) return;
    resumeMutation.mutate();
  };
  // mark as intentionally present
  void handleStart;

  // Reset simulation (stop, recompile, and restart - like pressing the physical reset button)
  const handleReset = () => {
    if (!ensureBackendConnected("Reset simulation")) return;
    // Stop if running
    if (simulationStatus === "running") {
      sendMessage({ type: "stop_simulation" });
      setSimulationStatus("stopped");
    }
    // Clear serial output on reset
    setSerialOutput([]);
    // Reset pin states (preserve detected pinMode info)
    resetPinUI({ keepDetected: true });

    toast({
      title: "Resetting...",
      description: "Recompiling and restarting simulation",
    });

    // Small delay then recompile and start
    setTimeout(() => {
      handleCompileAndStart();
    }, 100);
  };

  // Toggle INPUT pin value (called when user clicks on an INPUT pin square)
  const handlePinToggle = (pin: number, newValue: number) => {
    if (simulationStatus === "stopped") {
      toast({
        title: "Simulation not active",
        description: "Start the simulation to change pin values.",
        variant: "destructive",
      });
      return;
    }

    if (simulationStatus === "paused") {
      // Pin changes are allowed during pause - send and update
    }

    // Send the new pin value to the server
    sendMessage({ type: "set_pin_value", pin, value: newValue });

    // Update local pin state immediately for responsive UI
    setPinStates((prev) => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex((p) => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
        };
      }
      return newStates;
    });
  };

  // Handle analog slider changes (0..1023)
  const handleAnalogChange = (pin: number, newValue: number) => {
    if (simulationStatus === "stopped") {
      toast({
        title: "Simulation not active",
        description: "Start the simulation to change pin values.",
        variant: "destructive",
      });
      return;
    }

    if (simulationStatus === "paused") {
      // Pin changes are allowed during pause - send and update
    }

    sendMessage({ type: "set_pin_value", pin, value: newValue });

    // Update local pin state immediately for responsive UI
    setPinStates((prev) => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex((p) => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
          type: "analog",
        };
      } else {
        newStates.push({ pin, mode: "INPUT", value: newValue, type: "analog" });
      }
      return newStates;
    });
  };

  const handleCompileAndStart = () => {
    if (!ensureBackendConnected("Simulation starten")) return;
    // Get the actual main sketch code - prioritize editor, then tabs, then state
    let mainSketchCode: string = "";

    // Try editor first (most up-to-date)
    if (editorRef.current) {
      try {
        mainSketchCode = editorRef.current.getValue();
      } catch (error) {
        console.error("[CLIENT] Error getting code from editor:", error);
        // Fall through to fallbacks
      }
    }

    // Fallback to tabs (for header scenario)
    if (!mainSketchCode && tabs.length > 0 && tabs[0]?.content) {
      mainSketchCode = tabs[0].content;
    }

    // Last fallback to state
    if (!mainSketchCode && code) {
      mainSketchCode = code;
    }

    // Validate we have code
    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      toast({
        title: "No Code",
        description: "Please write some code before compiling",
        variant: "destructive",
      });
      return;
    }

    // Prepare header files (all tabs except the first)
    const headers = tabs.slice(1).map((tab) => ({
      name: tab.name,
      content: tab.content,
    }));
    logger.info(`[CLIENT] Compile & Start with ${headers.length} headers`);
    logger.info(`[CLIENT] Code length: ${mainSketchCode.length} bytes`);
    logger.info(
      `[CLIENT] Main code from: ${editorRef.current ? "editor" : tabs[0]?.content ? "tabs" : "state"}`,
    );
    logger.info(
      `[CLIENT] Tabs: ${tabs.map((t) => `${t.name}(${t.content.length}b)`).join(", ")}`,
    );

    setCliOutput("");
    setSerialOutput([]);
    setParserMessages([]);
    // Reset all pin-related UI state (including detectedPinModes)
    resetPinUI();
    setCompilationStatus("compiling");
    setArduinoCliStatus("compiling"); // Track HTTP compile request

    compileMutation.mutate(
      { code: mainSketchCode, headers },
      {
        onSuccess: (data) => {
          logger.info(
            `[CLIENT] Compile response: ${JSON.stringify(data, null, 2)}`,
          );

          // Update arduinoCliStatus based on compile result
          setArduinoCliStatus(data.success ? "success" : "error");
          // Don't set gccStatus here - it will be set by WebSocket when g++ runs

          // Display compilation output or errors (REPLACE, don't append)
          if (data.success) {
            logger.info(`[CLIENT] Compile SUCCESS, output: ${data.output}`);
            setCliOutput(data.output || "✓ Arduino-CLI Compilation succeeded.");
          } else {
            logger.info(`[CLIENT] Compile FAILED, errors: ${data.errors}`);
            setCliOutput(data.errors || "✗ Arduino-CLI Compilation failed.");
          }

          // Only start simulation when compilation succeeded
          if (data?.success) {
            startMutation.mutate();
            setCompilationStatus("success");
            setHasCompiledOnce(true);
            setIsModified(false);

            // Reset CLI status to idle after a short delay
            setTimeout(() => {
              setArduinoCliStatus("idle");
            }, 2000);
          } else {
            // Optional error handling if API response is unclear
            setCompilationStatus("error");
            toast({
              title: "Compilation Completed with Errors",
              description:
                "Simulation will not start due to compilation errors.",
              variant: "destructive",
            });

            // Reset CLI status to idle after a short delay
            setTimeout(() => {
              setArduinoCliStatus("idle");
            }, 2000);
          }
        },
        onError: () => {
          setCompilationStatus("error");
          setArduinoCliStatus("error");
          toast({
            title: "Compilation Failed",
            description: "Simulation will not start due to compilation errors.",
            variant: "destructive",
          });

          // Reset CLI status to idle after a short delay
          setTimeout(() => {
            setArduinoCliStatus("idle");
          }, 2000);
        },
      },
    );
  };

  const handleSerialSend = (message: string) => {
    if (!ensureBackendConnected("Serial senden")) return;

    if (simulationStatus !== "running") {
      toast({
        title:
          simulationStatus === "paused"
            ? "Simulation paused"
            : "Simulation not running",
        description:
          simulationStatus === "paused"
            ? "Resume the simulation to send serial input."
            : "Start the simulation to send serial input.",
        variant: "destructive",
      });
      return;
    }

    // Trigger TX LED blink when client sends data
    setTxActivity((prev) => prev + 1);

    sendMessage({
      type: "serial_input",
      data: message,
    });
  };

  const handleClearCompilationOutput = () => {
    setCliOutput("");
    setLastCompilationResult(null);
    setParserMessages([]);
  };

  const handleClearSerialOutput = () => {
    setSerialOutput([]);
  };

  const getStatusInfo = () => {
    switch (compilationStatus) {
      case "compiling":
        return { text: "Compiling...", className: "status-compiling" };
      case "success":
        return {
          text: isModified
            ? "Code Changed"
            : "Compilation with Arduino-CLI complete",
          className: isModified ? "status-modified" : "status-success",
        };
      case "error":
        return { text: "Compilation Error", className: "status-error" };
      default:
        return { text: "Ready", className: "status-ready" };
    }
  };

  function getStatusClass(
    status:
      | "idle"
      | "compiling"
      | "success"
      | "error"
      | "ready"
      | "running"
      | "stopped",
  ): string {
    switch (status) {
      case "compiling":
        return "text-yellow-500";
      case "success":
        return "text-green-500";
      case "error":
        return "text-red-500";
      case "idle":
        return "text-gray-500 italic";
      case "ready":
        return "text-gray-700";
      case "running":
        return "text-green-600";
      case "stopped":
        return "text-gray-600";
      default:
        return "";
    }
  }

  // Replace 'Compilation Successful' with 'Successful' in status label
  const statusInfo = getStatusInfo();
  void getStatusClass;
  void statusInfo;
  const simControlBusy =
    compileMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending;

  const simulateDisabled =
    ((simulationStatus === "stopped" || simulationStatus === "paused") &&
      (!backendReachable || !isConnected)) ||
    simControlBusy;

  const stopDisabled =
    (simulationStatus !== "running" && simulationStatus !== "paused") ||
    stopMutation.isPending;

  const buttonsClassName =
    "hover:bg-green-600 hover:text-white transition-colors";
  void stopDisabled;
  void buttonsClassName;

  return (
    <div
      className={`h-screen flex flex-col bg-background text-foreground relative ${showErrorGlitch ? "overflow-hidden" : ""}`}
    >
      {/* Glitch overlay when compilation fails */}
      {showErrorGlitch && (
        <div className="pointer-events-none absolute inset-0 z-50">
          {/* Single red border flash */}
          <div className="absolute inset-0 flex items-stretch justify-stretch">
            <div className="absolute inset-0">
              <div className="absolute inset-0 border-0 pointer-events-none">
                <div className="absolute inset-0 rounded-none border-4 border-red-500 opacity-0 animate-border-flash" />
              </div>
            </div>
          </div>
          <style>{`
            @keyframes border-flash {
              0% { opacity: 0; transform: scale(1); }
              10% { opacity: 1; }
              60% { opacity: 0.7; }
              100% { opacity: 0; }
            }
            .animate-border-flash { animation: border-flash 0.6s ease-out both; }
          `}</style>
        </div>
      )}
      {/* Blue breathing border when backend is unreachable */}
      {!backendReachable && (
        <div className="pointer-events-none absolute inset-0 z-40">
          <div className="absolute inset-0">
            <div className="absolute inset-0 border-0 pointer-events-none">
              <div className="absolute inset-0 rounded-none border-2 border-blue-400 opacity-80 animate-breathe-blue" />
            </div>
          </div>
          <style>{`
            @keyframes breathe-blue {
              0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
              25% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              50% { box-shadow: 0 0 36px 12px rgba(37,99,235,0.16); opacity: 1; }
              75% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
            }
            .animate-breathe-blue { animation: breathe-blue 6s ease-in-out infinite; }
          `}</style>
        </div>
      )}
      {/* Header/Toolbar */}
      <AppHeader
        isMobile={isMobile}
        simulationStatus={simulationStatus}
        simulateDisabled={simulateDisabled}
        isCompiling={compileMutation.isPending}
        isStarting={startMutation.isPending}
        isStopping={stopMutation.isPending}
        isPausing={pauseMutation.isPending}
        isResuming={resumeMutation.isPending}
        onSimulate={handleCompileAndStart}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        board={board}
        baudRate={baudRate}
        simulationTimeout={simulationTimeout}
        onTimeoutChange={setSimulationTimeout}
        isMac={isMac}
        onFileAdd={handleTabAdd}
        onFileRename={() => {
          if (!activeTabId) {
            toast({
              title: "No file selected",
              description: "Open a file/tab first to rename.",
            });
            return;
          }
          const current = tabs.find((t) => t.id === activeTabId);
          const newName = window.prompt(
            "Rename file",
            current?.name || "untitled.ino",
          );
          if (newName && newName.trim()) {
            handleTabRename(activeTabId, newName.trim());
          }
        }}
        onFormatCode={formatCode}
        onLoadFiles={() => fileInputRef.current?.click()}
        onDownloadAllFiles={downloadAllFiles}
        onSettings={openSettings}
        onUndo={() => runEditorCommand("undo")}
        onRedo={() => runEditorCommand("redo")}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onSelectAll={() => runEditorCommand("selectAll")}
        onGoToLine={handleGoToLine}
        onFind={() => runEditorCommand("find")}
        onCompile={() => { if (!compileMutation.isPending) handleCompile(); }}
        onCompileAndStart={handleCompileAndStart}
        onOutputPanelToggle={() => { setShowCompilationOutput(!showCompilationOutput); setParserPanelDismissed(false); }}
        showCompilationOutput={showCompilationOutput}
      />
      {/* Hidden file input used by File → Load Files */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ino,.h"
        multiple
        onChange={handleHiddenFileInput}
        className="hidden"
      />
      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative z-0">
        {!isMobile ? (
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
            id="main-layout"
          >
            {/* Code Editor Panel */}
            <ResizablePanel defaultSize={50} minSize={20} id="code-panel">
              <ResizablePanelGroup
                direction="vertical"
                className="h-full"
                id="code-layout"
              >
                <ResizablePanel defaultSize={97} minSize={30} id="editor-panel">
                  <div className="h-full flex flex-col">
                    {/* Sketch Tabs */}
                    <SketchTabs
                      tabs={tabs}
                      activeTabId={activeTabId}
                      modifiedTabId={null}
                      onTabClick={handleTabClick}
                      onTabClose={handleTabClose}
                      onTabRename={handleTabRename}
                      onTabAdd={handleTabAdd}
                      onFilesLoaded={handleFilesLoaded}
                      onFormatCode={formatCode}
                      examplesMenu={
                        <ExamplesMenu
                          onLoadExample={handleLoadExample}
                          backendReachable={backendReachable}
                        />
                      }
                    />

                    <div className="flex-1 min-h-0">
                      <CodeEditor
                        value={code}
                        onChange={handleCodeChange}
                        onCompileAndRun={handleCompileAndStart}
                        onFormat={formatCode}
                        editorRef={editorRef}
                      />
                    </div>
                  </div>
                </ResizablePanel>

                {/* Combined Output Panel with Tabs: Compiler / Messages / IO-Registry */}
                {(() => {
                  const isSuccessState =
                    lastCompilationResult === "success" &&
                    !hasCompilationErrors;
                  const hasIOProblems = ioRegistry.some((record) => {
                    const ops = record.usedAt || [];
                    const digitalReads = ops.filter((u) =>
                      u.operation.includes("digitalRead"),
                    );
                    const digitalWrites = ops.filter((u) =>
                      u.operation.includes("digitalWrite"),
                    );
                    const pinModes = ops
                      .filter((u) => u.operation.includes("pinMode"))
                      .map((u) => {
                        const match = u.operation.match(/pinMode:(\d+)/);
                        const mode = match ? parseInt(match[1]) : -1;
                        return mode === 0
                          ? "INPUT"
                          : mode === 1
                            ? "OUTPUT"
                            : mode === 2
                              ? "INPUT_PULLUP"
                              : "UNKNOWN";
                      });
                    const uniqueModes = [...new Set(pinModes)];
                    const hasMultipleModes = uniqueModes.length > 1;
                    const hasIOWithoutMode =
                      (digitalReads.length > 0 || digitalWrites.length > 0) &&
                      pinModes.length === 0;
                    return hasIOWithoutMode || hasMultipleModes;
                  });

                  // Show output panel if:
                  // - User has NOT explicitly closed it (showCompilationOutput)
                  // User intent is PRIMARY - user can always close even with errors/messages
                  // Auto-reopen happens via setShowCompilationOutput(true) in useEffect
                  const shouldShowOutput = showCompilationOutput;

                  return (
                    <>
                      {shouldShowOutput && (
                        <ResizableHandle
                          withHandle
                          data-testid="vertical-resizer-output"
                        />
                      )}

                      <ResizablePanel
                        ref={outputPanelRef}
                        defaultSize={Math.max(
                          compilationPanelSize,
                          outputPanelMinPercent,
                        )}
                        minSize={outputPanelMinPercent}
                        id="output-under-editor"
                        className={shouldShowOutput ? "" : "hidden"}
                      >
                        <Tabs
                          value={activeOutputTab}
                          onValueChange={(v) =>
                            setActiveOutputTab(
                              v as "compiler" | "messages" | "registry",
                            )
                          }
                          className="h-full flex flex-col"
                        >
                          <div
                            ref={outputTabsHeaderRef}
                            data-testid="output-tabs-header"
                            className="flex items-center justify-start px-2 h-[var(--ui-header-height)] bg-muted border-b"
                          >
                            <TabsList className="h-auto flex gap-1 bg-transparent items-center">
                              <TabsTrigger
                                value="compiler"
                                className={clsx(
                                  "h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center",
                                  {
                                    "text-gray-400":
                                      lastCompilationResult === null,
                                    "text-green-400":
                                      isSuccessState &&
                                      lastCompilationResult !== null,
                                    "text-red-400": hasCompilationErrors,
                                  },
                                )}
                              >
                                <span
                                  className={clsx({
                                    "text-gray-400":
                                      lastCompilationResult === null,
                                    "text-green-400":
                                      isSuccessState &&
                                      lastCompilationResult !== null,
                                    "text-red-400": hasCompilationErrors,
                                  })}
                                >
                                  Compiler
                                </span>
                              </TabsTrigger>
                              <TabsTrigger
                                value="messages"
                                className={clsx(
                                  "h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center",
                                  {
                                    "text-orange-400":
                                      parserMessages.length > 0,
                                    "text-gray-400":
                                      parserMessages.length === 0,
                                  },
                                )}
                              >
                                <span
                                  className={clsx({
                                    "text-orange-400":
                                      parserMessages.length > 0,
                                    "text-gray-400":
                                      parserMessages.length === 0,
                                  })}
                                >
                                  Messages
                                </span>
                              </TabsTrigger>
                              <TabsTrigger
                                value="registry"
                                className={clsx(
                                  "h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center",
                                  {
                                    "text-orange-400": hasIOProblems,
                                    "text-gray-400": !hasIOProblems,
                                  },
                                )}
                              >
                                <span
                                  className={clsx({
                                    "text-orange-400": hasIOProblems,
                                    "text-gray-400": !hasIOProblems,
                                  })}
                                >
                                  I/O Registry
                                </span>
                              </TabsTrigger>
                            </TabsList>
                            <div className="flex-1" />
                            <div className="flex items-center px-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setShowCompilationOutput(false);
                                  setParserPanelDismissed(true);
                                }}
                                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                                title="Close"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <TabsContent
                            value="compiler"
                            className="flex-1 overflow-hidden m-0"
                          >
                            <CompilationOutput
                              output={cliOutput}
                              onClear={handleClearCompilationOutput}
                              isSuccess={isSuccessState}
                              showSuccessMessage={isSuccessState && !isModified}
                              hideHeader={true}
                            />
                          </TabsContent>

                          <TabsContent
                            value="messages"
                            className="flex-1 overflow-hidden m-0"
                          >
                            <ParserOutput
                              messages={parserMessages}
                              ioRegistry={ioRegistry}
                              messagesContainerRef={parserMessagesContainerRef}
                              onClear={() => setParserPanelDismissed(true)}
                              onGoToLine={(line) => {
                                logger.debug(`Go to line: ${line}`);
                              }}
                              onInsertSuggestion={(suggestion, line) => {
                                if (
                                  editorRef.current &&
                                  typeof (editorRef.current as any)
                                    .insertSuggestionSmartly === "function"
                                ) {
                                  skipSimStopRef.current = true;
                                  (
                                    editorRef.current as any
                                  ).insertSuggestionSmartly(suggestion, line);
                                  toast({
                                    title: "Suggestion inserted",
                                    description:
                                      "Code added to the appropriate location",
                                  });
                                } else {
                                  console.error(
                                    "insertSuggestionSmartly method not available on editor",
                                  );
                                }
                              }}
                              hideHeader={true}
                            />
                          </TabsContent>

                          <TabsContent
                            value="registry"
                            className="flex-1 overflow-hidden m-0"
                          >
                            <ParserOutput
                              messages={[]}
                              ioRegistry={ioRegistry}
                              onClear={() => {}}
                              onGoToLine={(line) => {
                                logger.debug(`Go to line: ${line}`);
                              }}
                              hideHeader={true}
                              defaultTab="registry"
                            />
                          </TabsContent>
                        </Tabs>
                      </ResizablePanel>
                    </>
                  );
                })()}
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle withHandle data-testid="horizontal-resizer" />

            {/* Right Panel - Output & Serial Monitor */}
            <ResizablePanel defaultSize={50} minSize={20} id="output-panel">
              <ResizablePanelGroup direction="vertical" id="output-layout">
                <ResizablePanel defaultSize={50} minSize={20} id="serial-panel">
                  <div className="h-full flex flex-col">
                    {/* Static Serial Header (always full width) */}
                    <div className="bg-muted px-4 border-b border-border flex items-center h-[var(--ui-header-height)]">
                      <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
                        <div className="flex items-center space-x-2 flex-shrink-0">
                          <Monitor
                            className="text-white opacity-95 h-5 w-5"
                            strokeWidth={1.67}
                            aria-hidden
                          />
                          <span className="sr-only">Serial Output</span>
                        </div>
                        <div className="flex items-center gap-4 ml-auto">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                            onClick={cycleSerialViewMode}
                            data-testid="button-serial-view-toggle"
                            aria-label={
                              serialViewMode === "monitor"
                                ? "Monitor only"
                                : serialViewMode === "plotter"
                                  ? "Plotter only"
                                  : "Split view"
                            }
                            title={
                              serialViewMode === "monitor"
                                ? "Monitor only"
                                : serialViewMode === "plotter"
                                  ? "Plotter only"
                                  : "Split view"
                            }
                          >
                            {serialViewMode === "monitor" ? (
                              <Terminal className="h-4 w-4" />
                            ) : serialViewMode === "plotter" ? (
                              <BarChart className="h-4 w-4" />
                            ) : (
                              <Columns className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className={clsx(
                              "h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center",
                              autoScrollEnabled
                                ? "bg-background text-white hover:bg-green-600 hover:text-white"
                                : "",
                            )}
                            onClick={() =>
                              setAutoScrollEnabled(!autoScrollEnabled)
                            }
                            disabled={serialViewMode === "plotter"}
                            title={
                              autoScrollEnabled
                                ? "Autoscroll on"
                                : "Autoscroll off"
                            }
                            aria-label={
                              autoScrollEnabled
                                ? "Autoscroll on"
                                : "Autoscroll off"
                            }
                            aria-pressed={autoScrollEnabled}
                            data-testid="button-autoscroll"
                          >
                            <ChevronsDown
                              className={clsx(
                                "h-4 w-4",
                                autoScrollEnabled
                                  ? "text-white"
                                  : "text-gray-400",
                              )}
                            />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                            onClick={handleClearSerialOutput}
                            aria-label="Clear serial output"
                            title="Clear serial output"
                            data-testid="button-clear-serial"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0">
                      {/* Serial area: SerialMonitor renders output area and parent renders static header above */}
                      {showSerialMonitor && showSerialPlotter ? (
                        <ResizablePanelGroup
                          direction="horizontal"
                          className="h-full"
                          id="serial-split"
                        >
                          <ResizablePanel
                            defaultSize={50}
                            minSize={20}
                            id="serial-monitor-panel"
                          >
                            <div className="h-full">
                              <SerialMonitor
                                output={serialOutput}
                                isConnected={isConnected}
                                isSimulationRunning={
                                  simulationStatus === "running"
                                }
                                onSendMessage={handleSerialSend}
                                onClear={handleClearSerialOutput}
                                showMonitor={showSerialMonitor}
                                autoScrollEnabled={autoScrollEnabled}
                              />
                            </div>
                          </ResizablePanel>

                          <ResizableHandle
                            withHandle
                            data-testid="horizontal-resizer-serial"
                          />

                          <ResizablePanel
                            defaultSize={50}
                            minSize={20}
                            id="serial-plot-panel"
                          >
                            <div className="h-full">
                              <Suspense fallback={<LoadingPlaceholder />}>
                                <SerialPlotter output={serialOutput} />
                              </Suspense>
                            </div>
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      ) : showSerialMonitor ? (
                        <SerialMonitor
                          output={serialOutput}
                          isConnected={isConnected}
                          isSimulationRunning={simulationStatus === "running"}
                          onSendMessage={handleSerialSend}
                          onClear={handleClearSerialOutput}
                          showMonitor={showSerialMonitor}
                          autoScrollEnabled={autoScrollEnabled}
                        />
                      ) : (
                        <div className="h-full">
                          <Suspense fallback={<LoadingPlaceholder />}>
                            <SerialPlotter output={serialOutput} />
                          </Suspense>
                        </div>
                      )}
                    </div>

                    {/* Input area is rendered in the parent so it spans the whole serial frame */}
                    <div className="p-3 flex-shrink-0">
                      <div className="w-full">
                        <InputGroup
                          type="text"
                          placeholder="Send to Arduino..."
                          value={serialInputValue}
                          onChange={(e) => setSerialInputValue(e.target.value)}
                          onKeyDown={handleSerialInputKeyDown}
                          onSubmit={handleSerialInputSend}
                          disabled={
                            !serialInputValue.trim() ||
                            simulationStatus !== "running"
                          }
                          inputTestId="input-serial"
                          buttonTestId="button-send-serial"
                        />
                      </div>
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  data-testid="vertical-resizer-board"
                />

                <ResizablePanel defaultSize={50} minSize={20} id="board-panel">
                  <ArduinoBoard
                    pinStates={pinStates}
                    isSimulationRunning={simulationStatus === "running"}
                    txActive={txActivity}
                    rxActive={rxActivity}
                    onReset={handleReset}
                    onPinToggle={handlePinToggle}
                    analogPins={analogPinsUsed}
                    onAnalogChange={handleAnalogChange}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full relative">
            {/* Render tab bar in a portal so it's fixed to the viewport regardless of ancestor transforms */}
            {isClient &&
              createPortal(
                <div
                  className="fixed inset-0 pointer-events-none"
                  style={{ zIndex: overlayZ }}
                >
                  <div
                    className="absolute inset-0 flex items-end justify-end p-8"
                    style={{
                      paddingBottom: "env(safe-area-inset-bottom, 32px)",
                      paddingRight: "env(safe-area-inset-right, 32px)",
                    }}
                  >
                    <div
                      className="pointer-events-auto sticky mr-4 mb-4"
                      style={{ alignSelf: "flex-end" }}
                    >
                      <div className="bg-black/95 rounded-full shadow-lg p-1 flex flex-col items-center space-y-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Code Editor"
                          onClick={() =>
                            setMobilePanel(
                              mobilePanel === "code" ? null : "code",
                            )
                          }
                          className={clsx(
                            "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                            mobilePanel === "code"
                              ? "bg-blue-600 text-white hover:bg-blue-700"
                              : "bg-transparent text-muted-foreground",
                          )}
                        >
                          <Cpu className="w-5 h-5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Compilation Output"
                          onClick={() =>
                            setMobilePanel(
                              mobilePanel === "compile" ? null : "compile",
                            )
                          }
                          className={clsx(
                            "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                            mobilePanel === "compile"
                              ? "bg-green-600 text-white hover:bg-green-700"
                              : "bg-transparent text-muted-foreground",
                          )}
                        >
                          <Wrench className="w-5 h-5 opacity-80" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Serial Output"
                          onClick={() =>
                            setMobilePanel(
                              mobilePanel === "serial" ? null : "serial",
                            )
                          }
                          className={clsx(
                            "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                            mobilePanel === "serial"
                              ? "bg-amber-600 text-white hover:bg-amber-700"
                              : "bg-transparent text-muted-foreground",
                          )}
                        >
                          <Terminal className="w-5 h-5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Arduino Board"
                          onClick={() =>
                            setMobilePanel(
                              mobilePanel === "board" ? null : "board",
                            )
                          }
                          className={clsx(
                            "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
                            mobilePanel === "board"
                              ? "bg-sky-600 text-white hover:bg-sky-700"
                              : "bg-transparent text-muted-foreground",
                          )}
                        >
                          <Monitor className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body,
              )}

            {mobilePanel && (
              <div
                className="fixed left-0 right-0 bottom-0 bg-card p-0 flex flex-col w-screen"
                style={{
                  top: `${headerHeight}px`,
                  height: `calc(100vh - ${headerHeight}px)`,
                  zIndex: overlayZ,
                }}
              >
                <div className="flex-1 overflow-auto w-screen h-full">
                  {mobilePanel === "code" && (
                    <div className="h-full flex flex-col w-full">
                      <SketchTabs
                        tabs={tabs}
                        activeTabId={activeTabId}
                        modifiedTabId={null}
                        onTabClick={handleTabClick}
                        onTabClose={handleTabClose}
                        onTabRename={handleTabRename}
                        onTabAdd={handleTabAdd}
                        onFilesLoaded={handleFilesLoaded}
                        onFormatCode={formatCode}
                        examplesMenu={
                          <ExamplesMenu
                            onLoadExample={handleLoadExample}
                            backendReachable={backendReachable}
                          />
                        }
                      />
                      <div className="flex-1 min-h-0 w-full">
                        <CodeEditor
                          value={code}
                          onChange={handleCodeChange}
                          onCompileAndRun={handleCompileAndStart}
                          onFormat={formatCode}
                          editorRef={editorRef}
                        />
                      </div>
                    </div>
                  )}
                  {mobilePanel === "compile" && (
                    <div className="h-full w-full flex flex-col">
                      {!parserPanelDismissed && parserMessages.length > 0 && (
                        <div className="flex-1 min-h-0 border-b border-gray-200">
                          <ParserOutput
                            messages={parserMessages}
                            ioRegistry={ioRegistry}
                            onClear={() => setParserPanelDismissed(true)}
                            onGoToLine={(line) => {
                              logger.debug(`Go to line: ${line}`);
                            }}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-h-0 w-full">
                        <CompilationOutput
                          output={cliOutput}
                          onClear={handleClearCompilationOutput}
                        />
                      </div>
                    </div>
                  )}
                  {mobilePanel === "serial" && (
                    <div className="h-full w-full">
                      <SerialMonitor
                        output={serialOutput}
                        isConnected={isConnected}
                        isSimulationRunning={simulationStatus === "running"}
                        onSendMessage={handleSerialSend}
                        onClear={handleClearSerialOutput}
                        showMonitor={showSerialMonitor}
                        autoScrollEnabled={autoScrollEnabled}
                      />
                    </div>
                  )}
                  {mobilePanel === "board" && (
                    <div className="h-full w-full">
                      <ArduinoBoard
                        pinStates={pinStates}
                        isSimulationRunning={simulationStatus === "running"}
                        txActive={txActivity}
                        rxActive={rxActivity}
                        onReset={handleReset}
                        onPinToggle={handlePinToggle}
                        analogPins={analogPinsUsed}
                        onAnalogChange={handleAnalogChange}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
