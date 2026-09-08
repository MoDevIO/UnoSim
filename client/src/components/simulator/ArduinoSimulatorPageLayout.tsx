import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { SimulationControls } from "@/components/simulator/SimulationControls";
import { PinMonitorView } from "@/components/simulator/PinMonitorView";
import { SimCockpit } from "@/components/features/sim-cockpit";
import SimulatorOutputContainer from "@/components/simulator/sub-components/SimulatorOutputContainer";
import { MobileLayout, type MobilePanel } from "@/components/features/mobile-layout";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  ANIMATION_KEYFRAMES,
  CSS_CLASSES,
} from "@/components/simulator/ArduinoSimulatorPage.styles";
import type { ArduinoSimulatorPageState } from "@/hooks/useArduinoSimulatorPage";

function getMobilePanelState(isMobile: boolean, mobilePanel: MobilePanel) {
  return {
    mobileCompileActive: isMobile && mobilePanel === "compile",
    mobileSerialActive: isMobile && mobilePanel === "serial",
    mobileBoardActive: isMobile && mobilePanel === "board",
  };
}

export function ArduinoSimulatorPageLayout(
  props: Readonly<ArduinoSimulatorPageState>,
) {
  const { compile, simulation, pins, files, connection, layout } = props;
  const {
    compilationStatus,
    dockerGccPhase,
    simulateDisabled,
    compileMutation,
    handleCompile,
    handleCompileAndStart,
    showCompilationOutput,
    setShowCompilationOutput,
    setParserPanelDismissed,
    hasFirstOutput,
  } = compile;
  const { baudRate, txActivity, rxActivity } = props.serial;
  const {
    simulationStatus,
    startMutation,
    stopMutation,
    pauseMutation,
    resumeMutation,
    compileAndStartAction,
    handleStop,
    handlePause,
    handleResume,
    handleReset,
    simulationTimeout,
    setSimulationTimeout,
    pendingExternalStart,
  } = simulation;
  const {
    batchStats,
    handlePinToggle,
    analogPinsUsed,
    handleAnalogChange,
    pinMonitorVisible,
    pinStates,
  } = pins;
  const {
    handleTabAdd,
    activeTabId,
    tabs,
    handleTabRename,
    formatCode,
    onLoadFiles,
    downloadAllFiles,
    undo,
    redo,
    cut,
    copy,
    paste,
    selectAll,
    goToLine,
    find,
    fileInputRef,
    handleHiddenFileInput,
  } = files;
  const {
    backendReachable,
    isConnected,
    wsConnectionState,
    wsHasEverConnected,
    sandboxMode,
    workerIndex,
    workerTotal,
  } = connection;
  const {
    showErrorGlitch,
    isMobile,
    layoutMode,
    board,
    isMac,
    toast,
    openSettings,
    debugMode,
    mobilePanel,
    setMobilePanel,
    headerHeight,
    overlayZ,
    codeSlot,
    compileSlot,
    serialSlot,
    outputPanelRef,
    compilationPanelSize,
    outputPanelMinPercent,
    outputPanelManuallyResizedRef,
  } = layout;

  const { mobileCompileActive, mobileSerialActive, mobileBoardActive } = getMobilePanelState(
    isMobile,
    mobilePanel,
  );
  const isTablet = layoutMode === "tablet";
  const mainOutputPanelRef = useRef<ImperativePanelHandle | null>(null);
  const previousLayoutModeRef = useRef(layoutMode);

  useEffect(() => {
    if (layoutMode === "tablet" && previousLayoutModeRef.current !== "tablet") {
      mainOutputPanelRef.current?.resize?.(35);
    }
    previousLayoutModeRef.current = layoutMode;
  }, [layoutMode]);
  const mobileSecondaryStyle = isMobile
    ? {
        top: `${headerHeight}px`,
        height: `calc(100vh - ${headerHeight}px)`,
        zIndex: Math.max(overlayZ - 1, 1),
      }
    : undefined;
  const boardSlot = (
    <PinMonitorView
      pinMonitorVisible={pinMonitorVisible}
      pinStates={pinStates}
      simulationStatus={simulationStatus}
      txActivity={txActivity}
      rxActivity={rxActivity}
      onReset={handleReset}
      onPinToggle={handlePinToggle}
      analogPins={analogPinsUsed}
      onAnalogChange={handleAnalogChange}
      isMobile={isMobile}
    />
  );
  return (
    <div
      className={`${CSS_CLASSES.MAIN_CONTAINER} ${showErrorGlitch ? "overflow-hidden" : ""}`}
    >
      {/* Global Styles for Animations */}
      <style>{ANIMATION_KEYFRAMES}</style>

      {/* Glitch overlay when compilation fails */}
      {showErrorGlitch && (
        <div className={`${CSS_CLASSES.OVERLAY_ROOT} ${CSS_CLASSES.OVERLAY_Z_HIGH}`}>
          {/* Single red border flash */}
          <div className={CSS_CLASSES.INNER_FLEX}>
            <div className={CSS_CLASSES.INNER_ABS}>
              <div className={CSS_CLASSES.BORDER_CONTAINER}>
                <div className={CSS_CLASSES.GLITCH_BORDER} />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Blue breathing border when backend is unreachable */}
      {!backendReachable && (
        <div className={`${CSS_CLASSES.OVERLAY_ROOT} ${CSS_CLASSES.OVERLAY_Z_MEDIUM}`}>
          <div className={CSS_CLASSES.INNER_ABS}>
            <div className={CSS_CLASSES.BORDER_CONTAINER}>
              <div className={CSS_CLASSES.UNREACHABLE_BORDER} />
            </div>
          </div>
        </div>
      )}
      {/* Header/Toolbar */}
      <SimulationControls
        isMobile={isMobile}
        simulationStatus={simulationStatus}
        compilationStatus={compilationStatus}
        dockerGccPhase={dockerGccPhase}
        hasFirstOutput={hasFirstOutput}
        pendingExternalStart={pendingExternalStart}
        simulateDisabled={simulateDisabled}
        isCompiling={compileMutation.isPending}
        isStarting={startMutation.isPending}
        isStopping={stopMutation.isPending}
        isPausing={pauseMutation.isPending}
        isResuming={resumeMutation.isPending}
        onSimulate={compileAndStartAction}
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
          const newName = globalThis.prompt(
            "Rename file",
            current?.name || "untitled.ino",
          );
          if (newName?.trim()) {
            handleTabRename(activeTabId, newName.trim());
          }
        }}
        onFormatCode={formatCode}
        onLoadFiles={onLoadFiles}
        onDownloadAllFiles={downloadAllFiles}
        onSettings={openSettings}
        onUndo={undo}
        onRedo={redo}
        onCut={cut}
        onCopy={copy}
        onPaste={paste}
        onSelectAll={selectAll}
        onGoToLine={goToLine}
        onFind={find}
        onCompile={() => {
          if (!compileMutation.isPending) handleCompile();
        }}
        onCompileAndStart={handleCompileAndStart}
        onOutputPanelToggle={() => {
          setShowCompilationOutput(!showCompilationOutput);
          setParserPanelDismissed(false);
          outputPanelManuallyResizedRef.current = false;
        }}
        showCompilationOutput={showCompilationOutput}
        rightSlot={
          <SimCockpit
            sandboxMode={sandboxMode}
            workerIndex={workerIndex}
            workerTotal={workerTotal}
            batchStats={batchStats}
            simulationStatus={simulationStatus}
            compilationStatus={compilationStatus}
            backendReachable={backendReachable}
            isConnected={isConnected}
            wsConnectionState={wsConnectionState}
            wsHasEverConnected={wsHasEverConnected}
            baudRate={baudRate}
            debugMode={debugMode}
            pendingExternalStart={pendingExternalStart}
          />
        }
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
      <div className="flex-1 overflow-hidden relative z-0 workspace-layout" data-layout-mode={layoutMode}>
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full workspace-main-layout"
          id="main-layout"
        >
            {/* Code Editor Panel */}
            <ResizablePanel
              defaultSize={isTablet ? 65 : 50}
              minSize={isTablet ? 40 : 20}
              id="code-panel"
              className="workspace-code-panel"
            >
              <ResizablePanelGroup
                direction="vertical"
                className="h-full workspace-code-layout"
                id="code-layout"
              >
                <ResizablePanel defaultSize={97} minSize={30} id="editor-panel" className="workspace-editor-panel">
                  <div className="h-full flex flex-col">
                    {codeSlot}
                  </div>
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  data-testid="vertical-resizer-output"
                  className="workspace-editor-output-handle"
                  onDragging={(isDragging) => {
                    if (isDragging) {
                      outputPanelManuallyResizedRef.current = true;
                    }
                  }}
                />

                <ResizablePanel
                  ref={outputPanelRef}
                  defaultSize={Math.max(compilationPanelSize, outputPanelMinPercent)}
                  minSize={outputPanelMinPercent}
                  id="output-under-editor"
                  className={clsx("workspace-compile-panel", {
                    hidden: !showCompilationOutput && !isMobile,
                    "workspace-mobile-overlay-panel": mobileCompileActive,
                    "workspace-mobile-hidden-panel": isMobile && !mobileCompileActive,
                  })}
                  style={mobileCompileActive ? mobileSecondaryStyle : undefined}
                >
                  {compileSlot}
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle withHandle data-testid="horizontal-resizer" className="workspace-main-horizontal-handle" />

            <SimulatorOutputContainer
              serialSlot={serialSlot}
              boardSlot={boardSlot}
              defaultSize={isTablet ? 35 : 50}
              minSize={isTablet ? 32 : 20}
              panelRef={mainOutputPanelRef}
              className={clsx("workspace-output-panel", {
                "workspace-mobile-overlay-panel": mobileSerialActive || mobileBoardActive,
                "workspace-mobile-hidden-panel": isMobile && !mobileSerialActive && !mobileBoardActive,
              })}
              style={mobileSerialActive || mobileBoardActive ? mobileSecondaryStyle : undefined}
              serialPanelClassName={clsx("workspace-serial-panel", {
                "workspace-mobile-full-panel": mobileSerialActive,
                "workspace-mobile-hidden-panel": isMobile && !mobileSerialActive,
              })}
              boardPanelClassName={clsx("workspace-board-panel", {
                "workspace-mobile-full-panel": mobileBoardActive,
                "workspace-mobile-hidden-panel": isMobile && !mobileBoardActive,
              })}
            />
        </ResizablePanelGroup>
        <MobileLayout
          isMobile={isMobile}
          mobilePanel={mobilePanel}
          setMobilePanel={setMobilePanel}
          overlayZ={overlayZ}
        />
      </div>
    </div>
  );
}
