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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Table,
  LayoutGrid,
} from "lucide-react";
import { InputGroup } from "@/components/ui/input-group";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeEditor } from "@/components/features/code-editor";
import { SerialMonitor } from "@/components/features/serial-monitor";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { SketchTabs } from "@/components/features/sketch-tabs";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { ArduinoBoard } from "@/components/features/arduino-board";
import { PinMonitor } from "@/components/features/pin-monitor";
import { AppHeader } from "@/components/features/app-header";
import { SimCockpit } from "@/components/features/sim-cockpit";
import { useWebSocket } from "@/hooks/use-websocket";
import { useCompilation } from "@/hooks/use-compilation";
import { useSimulationControls } from "@/hooks/use-simulation-controls";
import { usePinState } from "@/hooks/use-pin-state";
import { useToast } from "@/hooks/use-toast";
import { useBackendHealth } from "@/hooks/use-backend-health";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useDebugConsole } from "@/hooks/use-debug-console";
import { useSketchTabs } from "@/hooks/use-sketch-tabs";
import { useSerialIO } from "@/hooks/use-serial-io";
import { useOutputPanel } from "@/hooks/use-output-panel";
import { useSimulationStore } from "@/hooks/use-simulation-store";
import { telemetryStore, useTelemetryStore } from "@/hooks/use-telemetry-store";
import { buildGccCompilationErrorState } from "@/lib/compilation-error-state";
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

export default function ArduinoSimulator() {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState("");
  const editorRef = useRef<{ getValue: () => string } | null>(null);

  // Sketch tabs management
  const { tabs, setTabs, activeTabId, setActiveTabId } = useSketchTabs();

  // CHANGED: Store OutputLine objects instead of plain strings
  const {
    serialOutput,
    setSerialOutput,
    serialViewMode,
    autoScrollEnabled,
    setAutoScrollEnabled,
    serialInputValue,
    setSerialInputValue,
    showSerialMonitor,
    showSerialPlotter,
    cycleSerialViewMode,
    clearSerialOutput,
  } = useSerialIO();
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

  const [activeOutputTab, setActiveOutputTab] = useState<
    "compiler" | "messages" | "registry" | "debug"
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
  const [isModified, setIsModified] = useState(false);

  const {
    pinStates,
    setPinStates,
    resetPinStates,
    enqueuePinEvent,
    batchStats,
  } = useSimulationStore();

  // Pin state management via hook
  const {
    analogPinsUsed,
    setAnalogPinsUsed,
    detectedPinModes,
    setDetectedPinModes,
    pendingPinConflicts,
    setPendingPinConflicts,
    pinMonitorVisible,
    resetPinUI,
    pinToNumber,
  } = usePinState({ resetPinStates });

  // Serial view mode state handled by useSerialIO

  // Selected board and baud rate (moved to Tools menu)
  const [board, _setBoard] = useState<string>("Arduino UNO");
  const [baudRate, setBaudRate] = useState<number>(115200);

  // Serial input box state handled by useSerialIO

  // Hidden file input for File → Load Files
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Debug console state and functions
  const {
    debugMode,
    setDebugMode: _setDebugMode,
    debugMessages,
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  } = useDebugConsole(activeOutputTab);
  void _setDebugMode; // Mark as intentionally unused (managed by hook)

  // Subscribe to telemetry updates (to re-render when metrics change)
  const telemetryData = useTelemetryStore();

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
  // Mobile layout (responsive design and panel management)
  const { isMobile, mobilePanel, setMobilePanel, headerHeight, overlayZ } = useMobileLayout();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    isConnected,
    lastMessage,
    messageQueue,
    consumeMessages,
    sendMessage: sendMessageRaw,
  } = useWebSocket();
  // Mark some hook values as intentionally read to avoid TS unused-local errors
  void lastMessage;

  // Wrapper for sendMessage that sends raw to backend
  const sendMessage = useCallback((message: any) => {
    sendMessageRaw(message);
  }, [sendMessageRaw]);

  // Backend health check and recovery
  const {
    backendReachable,
    showErrorGlitch,
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
  } = useBackendHealth(queryClient);

  const startSimulationRef = useRef<(() => void) | null>(null);
  const startSimulation = useCallback(() => {
    startSimulationRef.current?.();
  }, []);

  const setHasCompiledOnceRef = useRef<
    ((value: boolean | ((prev: boolean) => boolean)) => void) | null
  >(null);
  const setHasCompiledOnceProxy = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setHasCompiledOnceRef.current?.(value);
    },
    [],
  );

  const {
    compilationStatus,
    setCompilationStatus,
    arduinoCliStatus,
    setArduinoCliStatus,
    gccStatus,
    setGccStatus,
    hasCompilationErrors,
    setHasCompilationErrors,
    lastCompilationResult,
    setLastCompilationResult,
    cliOutput,
    setCliOutput,
    compileMutation,
    handleCompile,
    handleCompileAndStart,
    handleClearCompilationOutput,
    clearOutputs,
  } = useCompilation({
    editorRef,
    tabs,
    activeTabId,
    code,
    setSerialOutput,
    setParserMessages,
    setParserPanelDismissed,
    resetPinUI,
    setIoRegistry,
    setHasCompiledOnce: setHasCompiledOnceProxy,
    setIsModified,
    setDebugMessages,
    addDebugMessage: (params) =>
      addDebugMessage(
        params.source,
        params.type,
        params.data,
        params.protocol,
      ),
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
    toast,
    startSimulation,
  });

  const {
    simulationStatus,
    setSimulationStatus,
    setHasCompiledOnce,
    simulationTimeout,
    setSimulationTimeout,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    handleStop,
    handlePause,
    handleResume,
    handleReset,
  } = useSimulationControls({
    ensureBackendConnected,
    sendMessage,
    resetPinUI,
    clearOutputs,
    addDebugMessage: (params) =>
      addDebugMessage(
        params.source,
        params.type,
        params.data,
        params.protocol,
      ),
    serialEventQueueRef,
    toast,
    pendingPinConflicts,
    setPendingPinConflicts,
    setCliOutput,
    isModified,
    handleCompileAndStart,
    startSimulationRef,
  });

  setHasCompiledOnceRef.current = setHasCompiledOnce;

  // Output panel sizing and management
  const {
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
  } = useOutputPanel(
    hasCompilationErrors,
    cliOutput,
    parserMessages,
    lastCompilationResult,
    parserMessagesContainerRef,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    code,
  );

  // Auto-switch output tab based on errors and messages
  useEffect(() => {
    if (hasCompilationErrors) {
      setActiveOutputTab("compiler");
    } else if (parserMessages.length > 0 && !parserPanelDismissed) {
      setActiveOutputTab("messages");
    }
  }, [hasCompilationErrors, parserMessages.length, parserPanelDismissed]);

  // Auto-scroll debug console to latest message
  useEffect(() => {
    if (activeOutputTab === "debug" && debugMessagesContainerRef.current) {
      requestAnimationFrame(() => {
        debugMessagesContainerRef.current?.scrollTo(0, debugMessagesContainerRef.current.scrollHeight);
      });
    }
  }, [debugMessages, activeOutputTab]);

  // Fetch default sketch
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ["/api/sketches"],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: backendReachable, // Only query if backend is reachable
  });

  // Upload mutation (used by Compile → Upload)
  // Ref to skip stopping simulation when a suggestion is inserted
  const skipSimStopRef = useRef(false);

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

    // Log all messages to debug console BEFORE consuming them
    messageQueue.forEach((msg) => {
      // For serial_events, log a compact version to reduce noise
      if (msg.type === "serial_event") {
        const payload = (msg as any).payload || {};
        const compactMsg = {
          type: "serial_event",
          data: payload.data,
        };
        addDebugMessage(
          "server",
          msg.type,
          JSON.stringify(compactMsg, null, 2),
          "websocket",
        );
      } else {
        addDebugMessage(
          "server",
          msg.type || "unknown",
          JSON.stringify(msg, null, 2),
          "websocket",
        );
      }
    });

    // Consume all messages from the queue
    const messages = consumeMessages();

    for (const message of messages) {
      switch (message.type) {
        case "sim_telemetry": {
          if (simulationStatus === "running") {
            telemetryStore.pushTelemetry(message.metrics);
          }
          break;
        }
        case "serial_output": {
          // NEW: Handle isComplete flag for Serial.print() vs Serial.println()
          let text = (message.data ?? "").toString();
          const isComplete = message.isComplete ?? true; // Default to true for backwards compatibility

          // Filter out debug/pause-resume internal messages (but NOT user-facing errors like rate limit)
          if (
            text.includes("[[TIME_RESUMED:") ||
            text.includes("[[TIME_FROZEN:")
          ) {
            break; // Skip these internal debug messages
          }

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
          const gccErrorState = buildGccCompilationErrorState(message.data);
          setCliOutput(gccErrorState.cliOutput);
          setHasCompilationErrors(gccErrorState.hasCompilationErrors);
          setLastCompilationResult(gccErrorState.lastCompilationResult);
          setShowCompilationOutput(gccErrorState.showCompilationOutput);
          setParserPanelDismissed(gccErrorState.parserPanelDismissed);
          setActiveOutputTab(gccErrorState.activeOutputTab);
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
            // Clear pin states from previous simulation run
            setPinStates([]);
            // Clear analog pins used from previous simulation
            setAnalogPinsUsed([]);
            // Preserve detected pinMode declarations when simulation stops
            resetPinUI({ keepDetected: true });
            setCompilationStatus("ready");
          }
          break;
        case "pin_state": {
          // Update pin state for Arduino board visualization
          const { pin, stateType, value } = message;
          enqueuePinEvent(pin, stateType, value);
          break;
        }
        case "pin_state_batch": {
          // Handle batched pin state updates
          const { states } = message as { states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }> };
          for (const { pin, stateType, value } of states) {
            enqueuePinEvent(pin, stateType, value);
          }
          break;
        }
        case "io_registry": {
          // Update I/O Registry from runtime execution
          const { registry, baudrate } = message as any;
          console.log("[arduino-simulator] Received io_registry message with", registry?.length, "pins");
          setIoRegistry(registry);
          
          // Update baudrate from registry if provided
          if (typeof baudrate === "number" && baudrate > 0) {
            setBaudRate(baudrate);
          }

          // Update analogPinsUsed from registry - add pins that are used with analogRead/analogWrite
          const analogPinsFromRegistry = new Set<number>();
          for (const record of registry) {
            const usedOps = record.usedAt || [];
            const hasAnalogOp = usedOps.some(
              (u: { line: number; operation: string }) =>
                u.operation === "analogRead" ||
                u.operation === "analogWrite" ||
                u.operation.startsWith("analogWrite:")
            );
            if (hasAnalogOp) {
              const pinNum = pinToNumber(record.pin);
              console.log(`[arduino-simulator] Pin ${record.pin} has analog operation, pinNum=${pinNum}, usedOps=`, usedOps);
              if (pinNum !== null && pinNum >= 14 && pinNum <= 19) {
                analogPinsFromRegistry.add(pinNum);
              }
            }
          }

          // Merge or replace analog pins based on simulation state
          if (simulationStatus === "running") {
            // During simulation: merge server pins with client-detected pins
            setAnalogPinsUsed(prev => {
              const merged = new Set([...prev, ...Array.from(analogPinsFromRegistry)]);
              const arr = Array.from(merged).sort((a, b) => a - b);
              console.log(`[arduino-simulator] Merging analog pins (simulation running) - client:`, prev, `server:`, Array.from(analogPinsFromRegistry), `merged:`, arr);
              return arr;
            });
          } else if (analogPinsFromRegistry.size > 0) {
            // Not running but registry has analog pins: update (for initial compile detection)
            const arr = Array.from(analogPinsFromRegistry).sort((a, b) => a - b);
            console.log(`[arduino-simulator] Setting analog pins from registry (not running, registry not empty):`, arr);
            setAnalogPinsUsed(arr);
          }
          // If registry is empty and not running, don't overwrite client-detected pins

          // Update pinStates from registry data - add pins that have been defined
          // NOTE: Only create pin records, do NOT set modes from registry.
          // Modes are determined solely by detectedPinModes (client-parsed Arduino code).
          // This ensures a single source of truth: what the user wrote.
          setPinStates((prev) => {
            const newStates = [...prev];

            for (const record of registry) {
              if (!record.defined) continue; // Skip undefined pins

              const pinNum = pinToNumber(record.pin);
              if (pinNum === null) continue;

              const exists = newStates.find((p) => p.pin === pinNum);
              if (!exists) {
                // Create new pin with default INPUT mode (will be overridden by detectedPinModes)
                newStates.push({
                  pin: pinNum,
                  mode: "INPUT",
                  value: 0,
                  type: pinNum >= 14 && pinNum <= 19 ? "digital" : "digital",
                });
              }
              // If pin already exists, don't change anything - modes come from detectedPinModes
            }

            return newStates;
          });

          // Check for pins used without pinMode (digitalWrite, digitalRead on undefined pins)
          // NOTE: Duplicate warning suppression - the CodeParser.parseHardwareCompatibility()
          // already generates the "hardware" category warning for pins used with digitalRead/digitalWrite
          // without pinMode, so we don't need to generate another "pins" category warning here
          const usageWarnings: ParserMessage[] = [];
          // Disabled: This duplicates hardware compatibility warnings from the parser
          /* 
          for (const record of registry) {
            // Skip if pin was properly defined with pinMode
            if (record.defined) continue;

            const ops = record.usedAt || [];
            // Check if pin was used with digitalWrite or digitalRead without pinMode
            const usedOps = ops.filter(
              (u: { line: number; operation: string }) =>
                u.operation === "digitalWrite" ||
                u.operation === "digitalRead" ||
                u.operation.startsWith("digitalWrite:") ||
                u.operation.startsWith("digitalRead:"),
            );

            if (usedOps.length > 0) {
              const firstOp = usedOps[0];
              const line = firstOp.line || undefined;
              const opName = firstOp.operation.includes("Write")
                ? "digitalWrite"
                : "digitalRead";

              usageWarnings.push({
                id: crypto.randomUUID(),
                type: "warning",
                category: "pins",
                severity: 2,
                message: `Pin ${record.pin} is used with ${opName}() but pinMode() was never called. This may cause unexpected behavior.`,
                suggestion: `pinMode(${record.pin}, OUTPUT); // Add this in setup()`,
                line,
              });
            }
          }
          */

          // Add usage warnings to parser messages
          if (usageWarnings.length > 0) {
            setParserMessages((prev) => {
              // Remove older warnings for the same pin
              const cleanedPrev = prev.filter((existing) => {
                if (existing.category !== "pins") return true;
                if (!existing.message.includes("pinMode() was never called"))
                  return true;
                const pinMatch = existing.message.match(/Pin\s+(\S+)\s+is/);
                if (!pinMatch) return true;
                const pinKey = pinMatch[1];
                const isReplaced = usageWarnings.some((m) => {
                  const newMatch = m.message.match(/Pin\s+(\S+)\s+is/);
                  return newMatch && newMatch[1] === pinKey;
                });
                return !isReplaced;
              });

              // Merge new warnings, avoiding duplicates
              const existingMessages = new Set(
                cleanedPrev.map((m) => `${m.category}:${m.message}`),
              );
              const newMessages = usageWarnings.filter(
                (m) => !existingMessages.has(`${m.category}:${m.message}`),
              );
              if (newMessages.length > 0) {
                setParserPanelDismissed(false);
                return [...cleanedPrev, ...newMessages];
              }
              return cleanedPrev;
            });
          }
          break;
        }
      }
    }
  }, [messageQueue, consumeMessages, addDebugMessage]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsModified(true);

    // Stop simulation when user edits the code (unless inserting a suggestion)
    // Stop both running and paused simulations
    if ((simulationStatus === "running" || simulationStatus === "paused") && !skipSimStopRef.current) {
      sendMessage({ type: "stop_simulation" });
      setSimulationStatus("stopped");
      // Reset all UI pin state when code changes while running/paused, but preserve detected modes
      // so they can be re-applied when simulation restarts
      resetPinUI({ keepDetected: true });
    }
    skipSimStopRef.current = false;
    // Detected pin modes are preserved so they'll be applied at next simulation start

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
    let analogReadMatchCount = 0;
    while ((m = areadRe.exec(mainCode))) {
      analogReadMatchCount++;
      const token = m[1].trim();
      console.log(`[arduino-simulator] analogRead match #${analogReadMatchCount}: token="${token}"`);
      // strip possible casts or expressions (very simple handling)
      const simple = token.match(/^(A\d+|\d+|\w+)$/i);
      if (!simple) {
        console.log(`[arduino-simulator]   -> Token "${token}" does NOT match simple pattern, skipping`);
        continue;
      }
      const tok = simple[1];
      // If token is A<n>
      const aMatch = tok.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) {
          pins.add(14 + idx);
          console.log(`[arduino-simulator]   -> Added pin ${14 + idx} (A${idx})`);
        }
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
    console.log(`[arduino-simulator] Total analogRead matches: ${analogReadMatchCount}`);

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

    // Do NOT add pins to pinStates during code editing — pins should only appear
    // after upload/simulation starts (via io_registry message from the server).
    const pinModeRe =
      /pinMode\s*\(\s*(A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;
    const digitalPinsFromPinMode = new Set<number>();
    const detectedModes: Record<number, "INPUT" | "OUTPUT" | "INPUT_PULLUP"> = {};
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
        detectedModes[p] = mode;
      }
    }

    // Replace detectedPinModes completely (don't merge) to avoid old modes persisting
    setDetectedPinModes(detectedModes);

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

    // Update analogPinsUsed with client-detected pins
    const clientPins = Array.from(pins).sort((a, b) => a - b);
    console.log(`[arduino-simulator] Client-detected analog pins:`, clientPins);
    setAnalogPinsUsed(clientPins);
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

  // Apply detectedPinModes after io_registry has been processed.
  // This ensures that client-side parsed modes override server modes.
  useEffect(() => {
    if (Object.keys(detectedPinModes).length === 0) {
      return;
    }

    setPinStates((prev) => {
      const newStates = [...prev];
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const pinState = newStates.find((p) => p.pin === pin);
        if (pinState) {
          pinState.mode = mode as any;
        } else {
          // CREATE pin if it doesn't exist yet (io_registry might not have detected it)
          newStates.push({
            pin,
            mode: mode as any,
            value: 0,
            type: pin >= 14 && pin <= 19 ? "digital" : "digital",
          });
        }
      }
      return newStates;
    });
  }, [detectedPinModes, simulationStatus]);

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
      clearOutputs();
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
    clearOutputs();
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
    setCompilationPanelSize(5); // Minimize output panel size
    setParserPanelDismissed(false); // Ensure panel is not dismissed
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

  const handleClearSerialOutput = useCallback(() => {
    clearSerialOutput();
  }, [clearSerialOutput]);

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
        onOutputPanelToggle={() => { setShowCompilationOutput(!showCompilationOutput); setParserPanelDismissed(false); outputPanelManuallyResizedRef.current = false; }}
        showCompilationOutput={showCompilationOutput}
        rightSlot={debugMode ? <SimCockpit batchStats={batchStats} simulationStatus={simulationStatus} /> : undefined}
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
                          onDragging={(isDragging) => {
                            // Mark as manually resized as soon as user starts dragging
                            if (isDragging) {
                              outputPanelManuallyResizedRef.current = true;
                            }
                          }}
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
                              v as "compiler" | "messages" | "registry" | "debug",
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
                                onDoubleClick={() => openOutputPanel("compiler")}
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
                                onDoubleClick={() => openOutputPanel("messages")}
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
                                onDoubleClick={() => openOutputPanel("registry")}
                                className={clsx(
                                  "h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center",
                                  {
                                    "text-blue-400": hasIOProblems,
                                    "text-gray-400": !hasIOProblems,
                                  },
                                )}
                              >
                                <span
                                  className={clsx({
                                    "text-blue-400": hasIOProblems,
                                    "text-gray-400": !hasIOProblems,
                                  })}
                                >
                                  I/O Registry
                                </span>
                              </TabsTrigger>
                              {debugMode && (
                                <TabsTrigger
                                  value="debug"
                                  onDoubleClick={() => openOutputPanel("debug")}
                                  className="h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center text-purple-400 gap-1.5"
                                >
                                  Debug
                                  {debugMessages.length > 0 && (
                                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600/30 text-purple-300 text-[9px] font-mono leading-none overflow-hidden">
                                      {debugMessages.length > 99 ? "99" : debugMessages.length}
                                    </span>
                                  )}
                                </TabsTrigger>
                              )}
                            </TabsList>
                            <div className="flex-1" />
                            <div className="flex items-center px-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  // Check if panel is minimized (at ~3% or min size)
                                  const currentSize = outputPanelRef.current?.getSize?.() ?? 0;
                                  const isMinimized = currentSize <= outputPanelMinPercent + 1;
                                  
                                  if (isMinimized) {
                                    // If already minimized, close it completely
                                    setShowCompilationOutput(false);
                                    setParserPanelDismissed(true);
                                    outputPanelManuallyResizedRef.current = false;
                                  } else {
                                    // If not minimized, minimize it first and reset manual flag
                                    setCompilationPanelSize(3);
                                    outputPanelManuallyResizedRef.current = false;
                                    if (outputPanelRef.current?.resize) {
                                      outputPanelRef.current.resize(outputPanelMinPercent);
                                    }
                                  }
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

                          <TabsContent
                            value="debug"
                            className="flex-1 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden"
                          >
                            {/* Only render debug content when tab is active to avoid lag */}
                            {activeOutputTab === "debug" && (
                            <div className="flex-1 overflow-hidden flex flex-col">
                                {/* Debug Console Header */}
                                <div className="bg-muted/50 border-b border-muted-foreground/30 px-3 h-[var(--ui-button-height)] flex items-center justify-between gap-2 flex-shrink-0">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-ui-xs text-muted-foreground whitespace-nowrap">Filter:</span>
                                    <select
                                      value={debugMessageFilter}
                                      onChange={(e) => setDebugMessageFilter(e.target.value.toLowerCase())}
                                      className="flex-1 px-2 py-1 text-ui-xs bg-background border border-muted-foreground/20 rounded text-foreground min-w-0 max-w-xs"
                                    >
                                      <option value="">All Types</option>
                                      {Array.from(new Set(debugMessages.map((m) => m.type))).sort().map((type) => (
                                        <option key={type} value={type.toLowerCase()}>
                                          {type}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      onClick={() => setDebugViewMode(debugViewMode === "table" ? "tiles" : "table")}
                                      className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center text-ui-xs bg-purple-600/20 text-purple-400 border border-purple-600/40 rounded hover:bg-purple-600/30 transition-colors"
                                      title={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"}
                                    >
                                      {debugViewMode === "table" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Table className="h-3.5 w-3.5" />}
                                    </button>
                                    <button
                                      onClick={() => {
                                        const messages = debugMessages
                                          .filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter)
                                          .map((m) => `[${m.timestamp.toLocaleTimeString()}] ${m.sender.toUpperCase()} (${m.type}): ${m.content}`)
                                          .join('\n');
                                        if (messages) {
                                          navigator.clipboard.writeText(messages);
                                          toast({
                                            title: "Copied to clipboard",
                                            description: `${debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length} messages`,
                                          });
                                        }
                                      }}
                                      className="h-[var(--ui-button-height)] px-2 text-ui-xs bg-blue-600/20 text-blue-400 border border-blue-600/40 rounded hover:bg-blue-600/30 transition-colors"
                                    >
                                      Copy
                                    </button>
                                    <button
                                      onClick={() => setDebugMessages([])}
                                      className="h-[var(--ui-button-height)] px-2 text-ui-xs bg-red-600/20 text-red-400 border border-red-600/40 rounded hover:bg-red-600/30 transition-colors"
                                    >
                                      Clear
                                    </button>
                                  </div>
                                </div>

                                {/* Debug Messages Table View - limited to 100 visible entries */}
                                {debugViewMode === "table" && (
                                  <ScrollArea
                                    className="flex-1"
                                    viewportRef={debugMessagesContainerRef}
                                    thumbClassName="bg-[#22c55e]"
                                  >
                                    <table className="w-full text-ui-xs border-collapse">
                                      <thead>
                                        <tr className="sticky top-0 z-40 bg-muted border-b border-muted-foreground/20">
                                          <th className="px-2 py-1 text-left font-semibold text-muted-foreground border-r border-muted-foreground/10 w-24">Time</th>
                                          <th className="px-2 py-1 text-left font-semibold text-muted-foreground border-r border-muted-foreground/10 w-16">Sender</th>
                                          <th className="px-2 py-1 text-left font-semibold text-muted-foreground border-r border-muted-foreground/10 w-20">Protocol</th>
                                          <th className="px-2 py-1 text-left font-semibold text-muted-foreground border-r border-muted-foreground/10 w-32">Type</th>
                                          <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Content</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {debugMessages
                                          .filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter)
                                          .slice(-100)
                                          .map((msg, idx) => (
                                            <tr
                                              key={msg.id}
                                              className={`border-b border-muted-foreground/10 ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}
                                            >
                                              <td className="px-2 py-1 text-cyan-400 border-r border-muted-foreground/10 font-mono whitespace-nowrap">
                                                {msg.timestamp.toLocaleTimeString()}
                                              </td>
                                              <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap">
                                                <span className={msg.sender === "server" ? "text-blue-400" : "text-green-400"}>
                                                  {msg.sender.toUpperCase()}
                                                </span>
                                              </td>
                                              <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap">
                                                <span className={msg.protocol === "http" ? "text-orange-400" : "text-purple-400"}>
                                                  {msg.protocol?.toUpperCase() || "?"}
                                                </span>
                                              </td>
                                              <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap">
                                                <span className="text-yellow-400 font-mono">{msg.type}</span>
                                              </td>
                                              <td className="px-2 py-1 text-gray-300 font-mono max-w-md truncate" title={msg.content}>
                                                {msg.content}
                                              </td>
                                            </tr>
                                          ))}
                                        {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length === 0 && (
                                          <tr>
                                            <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground text-ui-xs">
                                              {debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </ScrollArea>
                                )}

                                {/* Debug Messages Tiles View - limited to 50 visible entries */}
                                {debugViewMode === "tiles" && (
                                  <ScrollArea
                                    className="flex-1"
                                    viewportRef={debugMessagesContainerRef}
                                    thumbClassName="bg-[#22c55e]"
                                  >
                                    <div className="p-3">
                                    <div className="space-y-3">
                                      {debugMessages
                                        .filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter)
                                        .slice(-50)
                                        .map((msg) => (
                                          <div
                                            key={msg.id}
                                            className="bg-muted/20 border border-muted-foreground/20 rounded p-3 hover:bg-muted/40 transition-colors"
                                          >
                                            {/* Header Row */}
                                            <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-muted-foreground/20">
                                              <div className="flex items-center gap-3">
                                                <span className={`text-ui-xs font-semibold px-2 py-0.5 rounded ${msg.sender === "server" ? "bg-blue-600/20 text-blue-400" : "bg-green-600/20 text-green-400"}`}>
                                                  {msg.sender.toUpperCase()}
                                                </span>
                                                <span className="text-ui-xs text-yellow-400 font-mono bg-yellow-600/10 px-2 py-0.5 rounded">
                                                  {msg.type}
                                                </span>
                                              </div>
                                              <span className="text-ui-xs text-cyan-400 font-mono whitespace-nowrap">
                                                {msg.timestamp.toLocaleTimeString()}
                                              </span>
                                            </div>
                                            {/* Content with JSON formatting */}
                                            <pre className="text-ui-xs text-gray-300 font-mono overflow-x-auto bg-black/20 p-2 rounded border border-muted-foreground/10">
                                              <code>{(() => {
                                                try {
                                                  const parsed = JSON.parse(msg.content);
                                                  return JSON.stringify(parsed, null, 2);
                                                } catch {
                                                  return msg.content;
                                                }
                                              })()}</code>
                                            </pre>
                                          </div>
                                        ))}
                                      {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length === 0 && (
                                        <div className="text-center text-muted-foreground text-ui-xs py-8">
                                          {debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}
                                        </div>
                                      )}
                                    </div>
                                    </div>
                                  </ScrollArea>
                                )}
                              </div>
                            )}
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
                          {debugMode && simulationStatus === "running" && telemetryData.last ? (
                            <div className="ml-4 flex items-center gap-4 text-xs text-muted-foreground border-l border-muted-foreground/30 pl-4">
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-wider text-white/50">Serial Events</span>
                                <span className="text-sm font-mono text-white/90">
                                  {(telemetryData.last.serialOutputPerSecond ?? 0).toFixed(1)} /s
                                </span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-wider text-white/50">Serial Bytes</span>
                                <span className="text-sm font-mono text-white/90">
                                  {(telemetryData.last.serialBytesPerSecond ?? 0).toFixed(1)} /s
                                </span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-wider text-white/50">Baudrate</span>
                                <span className="text-sm font-mono text-white/90">
                                  {baudRate}
                                </span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-wider text-white/50">Total Bytes</span>
                                <span className="text-sm font-mono text-white/90">
                                  {telemetryData.last.serialBytesTotal ?? 0}
                                </span>
                              </div>
                            </div>
                          ) : null}
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
                                  simulationStatus !== "stopped"
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
                          isSimulationRunning={simulationStatus !== "stopped"}
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
                  <div className="h-full w-full flex flex-col gap-3 p-2">
                    {pinMonitorVisible && (
                      <PinMonitor pinStates={pinStates} batchStats={batchStats} />
                    )}
                    <div className="flex-1 min-h-0">
                      <ArduinoBoard
                        pinStates={pinStates}
                        isSimulationRunning={simulationStatus !== "stopped"}
                        simulationStatus={simulationStatus}
                        txActive={txActivity}
                        rxActive={rxActivity}
                        onReset={handleReset}
                        onPinToggle={handlePinToggle}
                        analogPins={analogPinsUsed}
                        onAnalogChange={handleAnalogChange}
                      />
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full relative">
            {/* Render tab bar in a portal so it's fixed to the viewport regardless of ancestor transforms */}
            {typeof window !== "undefined" &&
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
                        isSimulationRunning={simulationStatus !== "stopped"}
                        onSendMessage={handleSerialSend}
                        onClear={handleClearSerialOutput}
                        showMonitor={showSerialMonitor}
                        autoScrollEnabled={autoScrollEnabled}
                      />
                    </div>
                  )}
                  {mobilePanel === "board" && (
                    <div className="h-full w-full">
                      <div className="h-full w-full flex flex-col gap-3 p-2">
                        {pinMonitorVisible && (
                          <PinMonitor pinStates={pinStates} batchStats={batchStats} />
                        )}
                        <div className="flex-1 min-h-0">
                          <ArduinoBoard
                            pinStates={pinStates}
                            isSimulationRunning={simulationStatus !== "stopped"}
                            simulationStatus={simulationStatus}
                            txActive={txActivity}
                            rxActive={rxActivity}
                            onReset={handleReset}
                            onPinToggle={handlePinToggle}
                            analogPins={analogPinsUsed}
                            onAnalogChange={handleAnalogChange}
                          />
                        </div>
                      </div>
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
