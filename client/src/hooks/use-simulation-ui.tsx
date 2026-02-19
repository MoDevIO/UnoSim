import React, { createContext, useContext, useState, useRef } from "react";

import { useDebugConsole } from "@/hooks/use-debug-console";
import { useOutputPanel } from "@/hooks/use-output-panel";

type SimulationStatus = "running" | "paused" | "stopped";

type DebugMessage = {
  id: string;
  timestamp: Date;
  sender: "server" | "frontend";
  type: string;
  content: string;
  protocol?: "websocket" | "http";
};

type SimulationUiContextType = {
  simulationStatus: SimulationStatus;
  txActivity: number;
  rxActivity: number;
  setTxActivity?: React.Dispatch<React.SetStateAction<number>>;
  setRxActivity?: React.Dispatch<React.SetStateAction<number>>;

  // Serial I/O (optional — page provides)
  serialOutput?: any[];
  renderedSerialOutput?: any[];
  serialViewMode?: "monitor" | "plotter" | "both";
  autoScrollEnabled?: boolean;
  setAutoScrollEnabled?: (v: boolean) => void;
  serialInputValue?: string;
  setSerialInputValue?: (v: string) => void;
  showSerialMonitor?: boolean;
  showSerialPlotter?: boolean;
  cycleSerialViewMode?: () => void;
  clearSerialOutput?: () => void;

  // Output panel state (managed by provider)
  activeOutputTab?: "compiler" | "messages" | "registry" | "debug";
  setActiveOutputTab?: (v: any) => void;
  showCompilationOutput?: boolean;
  setShowCompilationOutput?: (v: boolean) => void;
  parserPanelDismissed?: boolean;
  setParserPanelDismissed?: (v: boolean) => void;
  parserMessagesContainerRef?: React.RefObject<HTMLDivElement>;
  outputPanelRef?: any;
  outputTabsHeaderRef?: React.RefObject<HTMLDivElement>;
  outputPanelMinPercent?: number;
  compilationPanelSize?: number;
  setCompilationPanelSize?: (n: number) => void;
  outputPanelManuallyResizedRef?: React.MutableRefObject<boolean>;
  openOutputPanel?: (tab: any) => void;

  // Debug console (provided by provider)
  debugMode?: boolean;
  setDebugMode?: (v: boolean) => void;
  debugMessages?: DebugMessage[];
  setDebugMessages?: (msgs: DebugMessage[]) => void;
  addDebugMessage?: (sender: "server" | "frontend", type: string, content: string, protocol?: "websocket" | "http") => void;
  debugMessageFilter?: string;
  setDebugMessageFilter?: (v: string) => void;
  debugViewMode?: "table" | "tiles";
  setDebugViewMode?: (v: "table" | "tiles") => void;
  debugMessagesContainerRef?: React.RefObject<HTMLDivElement>;
};

const SimulationUiContext = createContext<SimulationUiContextType | null>(null);

export const SimulationUiProvider = (props: React.PropsWithChildren<Partial<SimulationUiContextType> & {
  // data the provider needs from the page to drive output sizing
  cliOutput?: string;
  parserMessages?: any[];
  lastCompilationResult?: "success" | "error" | null;
  hasCompilationErrors?: boolean;
  code?: string;
}>) => {
  const { children, cliOutput = "", parserMessages = [], lastCompilationResult = null, hasCompilationErrors = false, code = "", ...rest } = props as any;

  // Output panel state managed by provider so multiple components can consume it
  const [activeOutputTab, setActiveOutputTab] = useState<"compiler" | "messages" | "registry" | "debug">("compiler");
  const [showCompilationOutput, setShowCompilationOutput] = useState<boolean>(() => {
    try {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem("unoShowCompileOutput") : null;
      return stored === null ? true : stored === "1";
    } catch {
      return true;
    }
  });
  const [parserPanelDismissed, setParserPanelDismissed] = useState<boolean>(false);
  const parserMessagesContainerRef = useRef<HTMLDivElement | null>(null);

  // Hook that manages the output panel sizing/behavior
  const outputPanel = useOutputPanel(
    Boolean(hasCompilationErrors),
    cliOutput,
    parserMessages,
    lastCompilationResult ?? null,
    parserMessagesContainerRef,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    code,
  );

  // Debug console is owned by the provider now so pages/components don't
  // need to instantiate or forward debug state. We pass the current
  // active output tab to the debug-hook so scroll/auto-open behavior
  // continues to work as before.
  const {
    debugMode,
    setDebugMode,
    debugMessages,
    setDebugMessages,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,
    addDebugMessage,
  } = useDebugConsole(activeOutputTab);


  const contextValue: SimulationUiContextType = {
    // Spread any serial/debug values passed in by the page (keeps backward compat)
    ...(rest as SimulationUiContextType),

    // Output panel
    activeOutputTab,
    setActiveOutputTab,
    showCompilationOutput,
    setShowCompilationOutput,
    parserPanelDismissed,
    setParserPanelDismissed,
    parserMessagesContainerRef,
    outputPanelRef: outputPanel.outputPanelRef,
    outputTabsHeaderRef: outputPanel.outputTabsHeaderRef,
    outputPanelMinPercent: outputPanel.outputPanelMinPercent,
    compilationPanelSize: outputPanel.compilationPanelSize,
    setCompilationPanelSize: outputPanel.setCompilationPanelSize,
    outputPanelManuallyResizedRef: outputPanel.outputPanelManuallyResizedRef,
    openOutputPanel: outputPanel.openOutputPanel,

    // debug console (managed by provider)
    debugMode,
    setDebugMode,
    debugMessages,
    setDebugMessages,
    addDebugMessage,
    debugMessageFilter,
    setDebugMessageFilter,
    debugViewMode,
    setDebugViewMode,
    debugMessagesContainerRef,

    // minimal tx/rx defaults (may be overridden by page props)
    txActivity: (rest as any)?.txActivity ?? 0,
    rxActivity: (rest as any)?.rxActivity ?? 0,
    setTxActivity: (rest as any)?.setTxActivity,
    setRxActivity: (rest as any)?.setRxActivity,

    // serial fields (if provided by page via props)
    serialOutput: (rest as any)?.serialOutput,
    renderedSerialOutput: (rest as any)?.renderedSerialOutput,
    serialViewMode: (rest as any)?.serialViewMode,
    autoScrollEnabled: (rest as any)?.autoScrollEnabled,
    setAutoScrollEnabled: (rest as any)?.setAutoScrollEnabled,
    serialInputValue: (rest as any)?.serialInputValue,
    setSerialInputValue: (rest as any)?.setSerialInputValue,
    showSerialMonitor: (rest as any)?.showSerialMonitor,
    showSerialPlotter: (rest as any)?.showSerialPlotter,
    cycleSerialViewMode: (rest as any)?.cycleSerialViewMode,
    clearSerialOutput: (rest as any)?.clearSerialOutput,
  } as SimulationUiContextType;

  return (
    <SimulationUiContext.Provider value={contextValue}>{children}</SimulationUiContext.Provider>
  );
};

export function useSimulationUi() {
  const ctx = useContext(SimulationUiContext);
  if (!ctx) {
    throw new Error("useSimulationUi must be used within a SimulationUiProvider");
  }
  return ctx;
}
