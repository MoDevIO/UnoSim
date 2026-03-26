import React, { lazy, useMemo, Suspense, useCallback } from "react";

import { SerialMonitor } from "@/components/features/serial-monitor";
import { SketchTabs } from "@/components/features/sketch-tabs";
import { ExamplesMenu } from "@/components/features/examples-menu";
import { OutputPanel } from "@/components/features/output-panel";
import { useSimulatorOutputPanel } from "@/hooks/useSimulatorOutputPanel";
import type { ToastFn } from "@/hooks/use-toast";
import type { ParserMessage, IOPinRecord, OutputLine } from "@shared/schema";
const CodeEditor = lazy(() =>
  import("@/components/features/code-editor").then((m) => ({
    default: m.CodeEditor,
  })),
);

type OutputTab = "compiler" | "messages" | "registry" | "debug";

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
  handleLoadExample: (filename: string, content: string) => void;
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
  isModified: boolean;
  toast: ToastFn;

  renderedSerialOutput: OutputLine[];
  isConnected: boolean;
  simulationStatus: "running" | "stopped" | "paused";
  handleSerialSend: (message: string) => void;
  handleClearSerialOutput: () => void;
  showSerialMonitor: boolean;
  autoScrollEnabled: boolean;

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
  renderedSerialOutput,
  isModified,
  toast,
  isConnected,
  simulationStatus,
  handleSerialSend,
  handleClearSerialOutput,
  showSerialMonitor,
  autoScrollEnabled,
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
        onClose={handleOutputCloseOrMinimize}
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
      <div className="flex-1 min-h-0">
        <SerialMonitor
          output={renderedSerialOutput}
          isConnected={isConnected}
          isSimulationRunning={simulationStatus !== "stopped"}
          onSendMessage={handleSerialSend}
          onClear={handleClearSerialOutput}
          showMonitor={showSerialMonitor}
          autoScrollEnabled={autoScrollEnabled}
        />
      </div>
    ),
    [
      renderedSerialOutput,
      isConnected,
      simulationStatus,
      handleSerialSend,
      handleClearSerialOutput,
      showSerialMonitor,
      autoScrollEnabled,
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
