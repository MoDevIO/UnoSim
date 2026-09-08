import React, { lazy, useMemo, Suspense, useCallback } from "react";

import { SketchTabs } from "@/components/features/sketch-tabs";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { OutputPanel } from "@/components/features/output-panel";
import { useSimulatorOutputPanel } from "@/hooks/useSimulatorOutputPanel";
import { SerialMonitorView, type SerialViewMode } from "@/components/simulator/SerialMonitorView";
import type { TelemetryMetrics } from "@/hooks/use-telemetry-store";
import type { ToastFn } from "@/hooks/use-toast";
import type { ParserMessage, IOPinRecord, OutputLine } from "@shared/schema";
import type { OutputTab } from "@/types/compilation.types";
const CodeEditor = lazy(() =>
  import("@/components/features/code-editor").then((m) => ({
    default: m.CodeEditor,
  }))
);

interface UseSimulatorUIStateParams {
  code: string;
  setCode: (code: string) => void;
  tabs: Array<{ id: string; name: string; content: string }>;
  activeTabId: string | null;
  handleTabClick: (tabId: string) => void;
  handleTabAdd: () => void;
  handleTabClose: (tabId: string) => void;
  handleTabRename: (tabId: string, newName: string) => void;
  handleFilesLoaded: (files: Array<{ name: string; content: string }>, replaceAll: boolean) => void;
  handleLoadExample: (files: Array<{ name: string; content: string }>, title: string) => void;
  formatCode: () => void;
  handleCompileAndStart: () => void;
  editorRef: React.RefObject<{
    getValue: () => string;
    insertSuggestionSmartly?: (suggestion: string, line?: number) => void;
  }>;
  backendReachable: boolean;

  parserMessages: ParserMessage[];
  activeOutputTab: OutputTab;
  showCompilationOutput: boolean;
  parserPanelDismissed: boolean;
  setShowCompilationOutput: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveOutputTab: (tab: OutputTab) => void;
  setParserPanelDismissed: (value: boolean) => void;
  ioRegistry: IOPinRecord[];
  cliOutput: string;
  hasCompilationErrors: boolean;
  lastCompilationResult: string | null;
  handleClearCompilationOutput: () => void;
  handleInsertSuggestion: (suggestion: string, line?: number) => void;
  onPanelClose?: () => void;
  isModified: boolean;
  toast: ToastFn;

  renderedSerialOutput: OutputLine[];
  serialOutput: OutputLine[];
  isConnected: boolean;
  simulationStatus: "idle" | "running" | "compiling" | "queued" | "paused";
  handleSerialSend: (message: string) => void;
  handleClearSerialOutput: () => void;
  showSerialMonitor: boolean;
  showSerialPlotter: boolean;
  serialViewMode: SerialViewMode;
  cycleSerialViewMode: () => void;
  autoScrollEnabled: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;
  serialInputValue: string;
  setSerialInputValue: (value: string) => void;
  handleSerialInputKeyDown: (event: React.KeyboardEvent) => void;
  handleSerialInputSend: () => void;
  baudRate: number;
  telemetryData: { last: TelemetryMetrics | null } | null;

  // Debug Console state/controls
  debugMode: boolean;
  setDebugMode: (value: boolean) => void;
  debugMessages: Array<{
    id: string;
    timestamp: Date;
    sender: "server" | "frontend";
    type: string;
    content: string;
    protocol?: "websocket" | "http";
  }>;
  setDebugMessages: React.Dispatch<React.SetStateAction<Array<{
    id: string;
    timestamp: Date;
    sender: "server" | "frontend";
    type: string;
    content: string;
    protocol?: "websocket" | "http";
  }>>>;
  debugMessageFilter: string;
  setDebugMessageFilter: (value: string) => void;
  debugViewMode: "table" | "tiles";
  setDebugViewMode: (mode: "table" | "tiles") => void;
  debugMessagesContainerRef: React.RefObject<HTMLDivElement>;
  addDebugMessage: (
    sender: "server" | "frontend",
    type: string,
    content: string,
    protocol?: "websocket" | "http",
  ) => void;
}

const LoadingPlaceholder = () => (
  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
    <span className="text-ui-sm">Loading chart...</span>
  </div>
);

export function useSimulatorUIState({
  code,
  setCode,
  tabs,
  activeTabId,
  handleTabClick,
  handleTabAdd,
  handleTabClose,
  handleTabRename,
  handleFilesLoaded,
  handleLoadExample,
  formatCode,
  handleCompileAndStart,
  editorRef,
  backendReachable,
  activeOutputTab,
  showCompilationOutput,
  parserPanelDismissed,
  setShowCompilationOutput,
  setActiveOutputTab,
  setParserPanelDismissed,
  parserMessages,
  ioRegistry,
  cliOutput,
  hasCompilationErrors,
  lastCompilationResult,
  handleClearCompilationOutput,
  handleInsertSuggestion,
  onPanelClose,
  renderedSerialOutput,
  serialOutput,
  isModified,
  toast,
  isConnected,
  simulationStatus,
  handleSerialSend,
  handleClearSerialOutput,
  showSerialMonitor,
  showSerialPlotter,
  serialViewMode,
  cycleSerialViewMode,
  autoScrollEnabled,
  setAutoScrollEnabled,
  serialInputValue,
  setSerialInputValue,
  handleSerialInputKeyDown,
  handleSerialInputSend,
  baudRate,
  telemetryData,
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
}: UseSimulatorUIStateParams) {

  const {
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
    handleOutputTabChange,
    handleOutputCloseOrMinimize,
    handleParserMessagesClear,
    handleParserGoToLine,
    handleRegistryClear,
  } = useSimulatorOutputPanel({
    hasCompilationErrors,
    cliOutput,
    parserMessages,
    lastCompilationResult,
    parserMessagesContainerRef: debugMessagesContainerRef,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    setActiveOutputTab,
    code,
  });

  const codeSlot = useMemo(
    () => (
      <>
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
          <Suspense fallback={<LoadingPlaceholder />}>
            <CodeEditor
              value={code}
              onChange={setCode}
              onCompileAndRun={handleCompileAndStart}
              onFormat={formatCode}
              editorRef={editorRef}
            />
          </Suspense>
        </div>
      </>
    ),
    [
      tabs,
      activeTabId,
      handleTabClick,
      handleTabClose,
      handleTabRename,
      handleTabAdd,
      handleFilesLoaded,
      formatCode,
      handleLoadExample,
      backendReachable,
      code,
      setCode,
      handleCompileAndStart,
      editorRef,
    ],
  );

  const handleCopyDebugMessages = useCallback(() => {
    const filtered = debugMessages.filter(
      (m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter,
    );
    const text = filtered
      .map(
        (m) =>
          `[${m.timestamp.toLocaleTimeString()}] ${m.sender.toUpperCase()} (${m.type}): ${m.content}`,
      )
      .join("\n");
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
      toast({ title: "Copied to clipboard", description: `${filtered.length} messages` });
    }
  }, [debugMessages, debugMessageFilter, toast]);

  const handleClearDebugMessages = useCallback(
    () => setDebugMessages([]),
    [setDebugMessages],
  );

  const isSuccessState = lastCompilationResult === "success" && !hasCompilationErrors;

  const compileSlot = useMemo(
    () => (
      <OutputPanel
        activeOutputTab={activeOutputTab}
        isSuccessState={isSuccessState}
        isModified={isModified}
        debugMode={debugMode}
        debugViewMode={debugViewMode}
        debugMessageFilter={debugMessageFilter}
        cliOutput={cliOutput}
        parserMessages={parserMessages}
        ioRegistry={ioRegistry}
        debugMessages={debugMessages}
        lastCompilationResult={lastCompilationResult}
        hasCompilationErrors={hasCompilationErrors}
        outputTabsHeaderRef={outputTabsHeaderRef}
        parserMessagesContainerRef={debugMessagesContainerRef}
        debugMessagesContainerRef={debugMessagesContainerRef}
        onTabChange={handleOutputTabChange}
        openOutputPanel={openOutputPanel}
        onClose={() => {
          handleOutputCloseOrMinimize();
          onPanelClose?.();
        }}
        onClearCompilationOutput={handleClearCompilationOutput}
        onParserMessagesClear={handleParserMessagesClear}
        onParserGoToLine={handleParserGoToLine}
        onInsertSuggestion={handleInsertSuggestion}
        onRegistryClear={handleRegistryClear}
        setDebugMessageFilter={setDebugMessageFilter}
        setDebugViewMode={setDebugViewMode}
        onCopyDebugMessages={handleCopyDebugMessages}
        onClearDebugMessages={handleClearDebugMessages}
      />
    ),
    [
      activeOutputTab,
      isSuccessState,
      isModified,
      debugMode,
      debugViewMode,
      debugMessageFilter,
      cliOutput,
      parserMessages,
      ioRegistry,
      debugMessages,
      lastCompilationResult,
      hasCompilationErrors,
      outputTabsHeaderRef,
      debugMessagesContainerRef,
      handleOutputTabChange,
      openOutputPanel,
      handleOutputCloseOrMinimize,
      onPanelClose,
      handleClearCompilationOutput,
      handleParserMessagesClear,
      handleParserGoToLine,
      handleInsertSuggestion,
      handleRegistryClear,
      setDebugMessageFilter,
      setDebugViewMode,
      handleCopyDebugMessages,
      handleClearDebugMessages,
    ],
  );

  const serialSlot = useMemo(
    () => (
      <div className="h-full min-h-0">
        <SerialMonitorView
          renderedSerialOutput={renderedSerialOutput}
          serialOutput={serialOutput}
          isConnected={isConnected}
          simulationStatus={simulationStatus === "running" || simulationStatus === "paused" ? simulationStatus : "idle"}
          handleSerialSend={handleSerialSend}
          handleClearSerialOutput={handleClearSerialOutput}
          showSerialMonitor={showSerialMonitor}
          showSerialPlotter={showSerialPlotter}
          serialViewMode={serialViewMode}
          cycleSerialViewMode={cycleSerialViewMode}
          autoScrollEnabled={autoScrollEnabled}
          setAutoScrollEnabled={setAutoScrollEnabled}
          serialInputValue={serialInputValue}
          setSerialInputValue={setSerialInputValue}
          handleSerialInputKeyDown={handleSerialInputKeyDown}
          handleSerialInputSend={handleSerialInputSend}
          debugMode={debugMode}
          telemetryData={telemetryData}
          baudRate={baudRate}
        />
      </div>
    ),
    [
      renderedSerialOutput,
      serialOutput,
      isConnected,
      simulationStatus,
      handleSerialSend,
      handleClearSerialOutput,
      showSerialMonitor,
      showSerialPlotter,
      serialViewMode,
      cycleSerialViewMode,
      autoScrollEnabled,
      setAutoScrollEnabled,
      serialInputValue,
      setSerialInputValue,
      handleSerialInputKeyDown,
      handleSerialInputSend,
      debugMode,
      telemetryData,
      baudRate,
    ],
  );

  return {
    activeOutputTab,
    showCompilationOutput,
    parserPanelDismissed,
    setShowCompilationOutput,
    setActiveOutputTab,
    setParserPanelDismissed,
    outputPanelRef,
    outputTabsHeaderRef,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
    openOutputPanel,
    handleOutputTabChange,
    handleOutputCloseOrMinimize,
    handleParserMessagesClear,
    handleParserGoToLine,
    handleRegistryClear,
    codeSlot,
    compileSlot,
    serialSlot,
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
  };
}
