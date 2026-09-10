import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { SimulationControls } from "@/components/simulator/SimulationControls";
import { PinMonitorView } from "@/components/simulator/PinMonitorView";
import { SimCockpit } from "@/components/features/sim-cockpit";
import SimulatorOutputContainer from "@/components/simulator/sub-components/SimulatorOutputContainer";
import { MobileLayout, type MobilePanel } from "@/components/features/mobile-layout";
import {
  ExperimentalWorkspace,
  WorkspaceCodeColumn,
  WorkspaceVisibilityControls,
  TutorWorkspacePlaceholder,
} from "@/components/simulator/ExperimentalWorkspace";
import { useExperimentalWorkspaceLayout } from "@/hooks/use-experimental-workspace-layout";
import { useTutor } from "@/hooks/use-tutor";
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

function getMobilePanelState(
  isMobile: boolean,
  isTablet: boolean,
  mobilePanel: MobilePanel,
  showTutor: boolean,
) {
  return {
    mobileCompileActive: isMobile && mobilePanel === "compile",
    mobileSerialActive: isMobile && mobilePanel === "serial",
    mobileBoardActive: isMobile && mobilePanel === "board",
    mobileTutorActive: (isMobile || isTablet) && showTutor && mobilePanel === "tutor",
  };
}

interface LegacyWorkspaceLayoutProps {
  readonly isTablet: boolean;
  readonly isMobile: boolean;
  readonly mobileTutorActive: boolean;
  readonly mobileCompileActive: boolean;
  readonly mobileSerialActive: boolean;
  readonly mobileBoardActive: boolean;
  readonly mobileSecondaryStyle?: React.CSSProperties;
  readonly codeSlot: React.ReactNode;
  readonly compileSlot: React.ReactNode;
  readonly outputPanelRef: React.Ref<ImperativePanelHandle>;
  readonly compilationPanelSize: number;
  readonly outputPanelMinPercent: number;
  readonly outputPanelManuallyResizedRef: React.MutableRefObject<boolean>;
  readonly showCompilationOutput: boolean;
  readonly serialSlot: React.ReactNode;
  readonly boardSlot: React.ReactNode;
  readonly mainOutputPanelRef: React.Ref<ImperativePanelHandle>;
}

function LegacyWorkspaceLayout({
  isTablet,
  isMobile,
  mobileTutorActive,
  mobileCompileActive,
  mobileSerialActive,
  mobileBoardActive,
  mobileSecondaryStyle,
  codeSlot,
  compileSlot,
  outputPanelRef,
  compilationPanelSize,
  outputPanelMinPercent,
  outputPanelManuallyResizedRef,
  showCompilationOutput,
  serialSlot,
  boardSlot,
  mainOutputPanelRef,
}: LegacyWorkspaceLayoutProps) {
  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="h-full workspace-main-layout"
      id="main-layout"
    >
      <ResizablePanel
        defaultSize={isTablet ? 65 : 50}
        minSize={isTablet ? 40 : 20}
        id="code-panel"
        className={clsx("workspace-code-panel", {
          "workspace-mobile-hidden-panel": isMobile && mobileTutorActive,
        })}
      >
        <WorkspaceCodeColumn
          codeSlot={codeSlot}
          compileSlot={compileSlot}
          outputPanelRef={outputPanelRef}
          compilationPanelSize={compilationPanelSize}
          outputPanelMinPercent={outputPanelMinPercent}
          outputPanelManuallyResizedRef={outputPanelManuallyResizedRef}
          groupId="code-layout"
          editorPanelId="editor-panel"
          outputPanelId="output-under-editor"
          outputResizerTestId="vertical-resizer-output"
          compilePanelClassName={clsx("workspace-compile-panel", {
            hidden: !showCompilationOutput && !isMobile,
            "workspace-mobile-overlay-panel": mobileCompileActive,
            "workspace-mobile-hidden-panel": isMobile && !mobileCompileActive,
          })}
          compilePanelStyle={mobileCompileActive ? mobileSecondaryStyle : undefined}
        />
      </ResizablePanel>

      <ResizableHandle
        withHandle
        data-testid="horizontal-resizer"
        className="workspace-main-horizontal-handle"
      />

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
  );
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
    isTablet,
    isDesktop,
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

  const experimentalWorkspace = useExperimentalWorkspaceLayout();
  const tutorPanel = useTutor();
  const showExperimentalDesktopWorkspace = experimentalWorkspace.enabled && isDesktop;
  const { mobileCompileActive, mobileSerialActive, mobileBoardActive, mobileTutorActive } = getMobilePanelState(
    isMobile,
    isTablet,
    mobilePanel,
    experimentalWorkspace.enabled && !isDesktop,
  );
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
  const compactSecondaryStyle = isMobile || isTablet
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
  const experimentalCodeColumn = (
    <WorkspaceCodeColumn
      codeSlot={codeSlot}
      compileSlot={compileSlot}
      outputPanelRef={outputPanelRef}
      compilationPanelSize={compilationPanelSize}
      outputPanelMinPercent={outputPanelMinPercent}
      outputPanelManuallyResizedRef={outputPanelManuallyResizedRef}
      groupId="experimental-code-layout"
      editorPanelId="experimental-editor-panel"
      outputPanelId="experimental-output-under-editor"
      outputResizerTestId="experimental-vertical-resizer-output"
      compilePanelClassName={clsx("workspace-compile-panel", {
        hidden: !showCompilationOutput,
      })}
    />
  );
  const experimentalSimulationColumn = (
    <SimulatorOutputContainer
      serialSlot={serialSlot}
      boardSlot={boardSlot}
      defaultSize={100}
      minSize={20}
      serialPanelClassName="workspace-serial-panel"
      boardPanelClassName="workspace-board-panel"
      embedded
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
        workspaceControls={
          showExperimentalDesktopWorkspace ? (
            <WorkspaceVisibilityControls
              visibility={experimentalWorkspace.visibility}
              onColumnToggle={(column) =>
                experimentalWorkspace.setColumnVisible(
                  column,
                  !experimentalWorkspace.visibility[column],
                )
              }
            />
          ) : undefined
        }
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
        {showExperimentalDesktopWorkspace ? (
          <ExperimentalWorkspace
            visibleColumns={experimentalWorkspace.visibleColumns}
            sizes={experimentalWorkspace.sizes}
            setColumnVisible={experimentalWorkspace.setColumnVisible}
            restoreDefaultLayout={experimentalWorkspace.restoreDefaultLayout}
            setSizes={experimentalWorkspace.setSizes}
            codeColumn={experimentalCodeColumn}
            simulationColumn={experimentalSimulationColumn}
            tutorColumn={<TutorWorkspacePlaceholder code={props.tutor.code} tutor={tutorPanel} debugMode={debugMode} />}
          />
        ) : (
          <LegacyWorkspaceLayout
            isTablet={isTablet}
            isMobile={isMobile}
            mobileTutorActive={mobileTutorActive}
            mobileCompileActive={mobileCompileActive}
            mobileSerialActive={mobileSerialActive}
            mobileBoardActive={mobileBoardActive}
            mobileSecondaryStyle={mobileSecondaryStyle}
            codeSlot={codeSlot}
            compileSlot={compileSlot}
            outputPanelRef={outputPanelRef}
            compilationPanelSize={compilationPanelSize}
            outputPanelMinPercent={outputPanelMinPercent}
            outputPanelManuallyResizedRef={outputPanelManuallyResizedRef}
            showCompilationOutput={showCompilationOutput}
            serialSlot={serialSlot}
            boardSlot={boardSlot}
            mainOutputPanelRef={mainOutputPanelRef}
          />
        )}
        {mobileTutorActive && (
          <TutorWorkspacePlaceholder
            className="workspace-mobile-overlay-panel"
            style={compactSecondaryStyle}
            code={props.tutor.code}
            tutor={tutorPanel}
            debugMode={debugMode}
          />
        )}
        <MobileLayout
          isMobile={isMobile}
          isTablet={isTablet}
          showTutor={experimentalWorkspace.enabled && !isDesktop}
          mobilePanel={mobilePanel}
          setMobilePanel={setMobilePanel}
          overlayZ={overlayZ}
        />
      </div>
    </div>
  );
}
