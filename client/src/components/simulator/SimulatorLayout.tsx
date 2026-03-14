/**
 * SimulatorLayout.tsx
 *
 * Extracted layout skeleton for ArduinoSimulator
 * Handles the complex ResizablePanel structure (desktop & mobile layouts)
 * in a reusable, testable component.
 */

import React, { ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { MobileLayout } from "@/components/features/mobile-layout";
import { OutputPanel } from "@/components/features/output-panel";

/**
 * Layout props for desktop ResizablePanel configuration
 */
export interface DesktopLayoutProps {
  // Editor panel (code slot)
  editorSlot: ReactNode;

  // Output panel (compilation, messages, registry, debug)
  outputPanelRef: React.RefObject<any>;
  outputTabsHeaderRef: React.RefObject<HTMLDivElement>;
  parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  debugMessagesContainerRef: React.RefObject<HTMLDivElement>;
  
  activeOutputTab: "compiler" | "messages" | "registry" | "debug";
  showCompilationOutput: boolean;
  isSuccessState: boolean;
  isModified: boolean;
  compilationPanelSize: number;
  outputPanelMinPercent: number;
  debugMode: boolean;
  debugViewMode: "table" | "tiles";
  debugMessageFilter: string;
  
  cliOutput: string;
  parserMessages: any[];
  ioRegistry: any[];
  debugMessages: any[];
  lastCompilationResult: string | null;
  hasCompilationErrors: boolean;
  
  onOutputTabChange: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  onOutputClose: () => void;
  onClearCompilationOutput: () => void;
  onParserMessagesClear: () => void;
  onParserGoToLine: (line: number) => void;
  onInsertSuggestion: (suggestion: string, line?: number) => void;
  onRegistryClear: () => void;
  setDebugMessageFilter: (filter: string) => void;
  setDebugViewMode: (mode: "table" | "tiles") => void;
  onCopyDebugMessages: () => void;
  onClearDebugMessages: () => void;
  openOutputPanel: (tab: "compiler" | "messages" | "registry" | "debug") => void;
  outputPanelManuallyResizedRef: React.MutableRefObject<boolean>;

  // Serial monitor & board panels
  serialSlot: ReactNode;
  boardSlot: ReactNode;
}

/**
 * Mobile layout props
 */
export interface MobileLayoutPropsT {
  isMobile: boolean;
  mobilePanel: "compile" | "serial" | "board";
  setMobilePanel: (panel: "compile" | "serial" | "board") => void;
  headerHeight: number;
  overlayZ: number;
  codeSlot: ReactNode;
  compileSlot: ReactNode;
  serialSlot: ReactNode;
  boardSlot: ReactNode;
}

/**
 * Combined layout props (either desktop or mobile)
 */
export interface SimulatorLayoutProps extends DesktopLayoutProps {
  isMobile: boolean;
  mobilePanel: "code" | "compile" | "serial" | "board" | null;
  setMobilePanel: React.Dispatch<React.SetStateAction<"code" | "compile" | "serial" | "board" | null>>;
  headerHeight: number;
  overlayZ: number;
  codeSlot: ReactNode;
  compileSlot: ReactNode;
  editorSlot: ReactNode;
}

/**
 * Desktop layout component (ResizablePanels)
 */
function DesktopSimulatorLayout({
  editorSlot,
  outputPanelRef,
  outputTabsHeaderRef,
  parserMessagesContainerRef,
  debugMessagesContainerRef,
  activeOutputTab,
  showCompilationOutput,
  isSuccessState,
  isModified,
  compilationPanelSize,
  outputPanelMinPercent,
  debugMode,
  debugViewMode,
  debugMessageFilter,
  cliOutput,
  parserMessages,
  ioRegistry,
  debugMessages,
  lastCompilationResult,
  hasCompilationErrors,
  onOutputTabChange,
  onOutputClose,
  onClearCompilationOutput,
  onParserMessagesClear,
  onParserGoToLine,
  onInsertSuggestion,
  onRegistryClear,
  setDebugMessageFilter,
  setDebugViewMode,
  onCopyDebugMessages,
  onClearDebugMessages,
  openOutputPanel,
  outputPanelManuallyResizedRef,
  serialSlot,
  boardSlot,
}: DesktopLayoutProps) {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full" id="main-layout">
      {/* Code Editor Panel */}
      <ResizablePanel defaultSize={50} minSize={20} id="code-panel">
        <ResizablePanelGroup direction="vertical" className="h-full" id="code-layout">
          <ResizablePanel defaultSize={97} minSize={30} id="editor-panel">
            {editorSlot}
          </ResizablePanel>

          {/* Combined Output Panel with Tabs: Compiler / Messages / IO-Registry / Debug */}
          {(() => {
            const shouldShowOutput = showCompilationOutput;

            return (
              <>
                {shouldShowOutput && (
                  <ResizableHandle
                    withHandle
                    data-testid="vertical-resizer-output"
                    onDragging={(isDragging) => {
                      if (isDragging) {
                        outputPanelManuallyResizedRef.current = true;
                      }
                    }}
                  />
                )}

                <ResizablePanel
                  ref={outputPanelRef}
                  defaultSize={Math.max(compilationPanelSize, outputPanelMinPercent)}
                  minSize={outputPanelMinPercent}
                  id="output-under-editor"
                  className={shouldShowOutput ? "" : "hidden"}
                >
                  <OutputPanel
                    activeOutputTab={activeOutputTab}
                    showCompilationOutput={showCompilationOutput}
                    isSuccessState={isSuccessState}
                    isModified={isModified}
                    compilationPanelSize={compilationPanelSize}
                    outputPanelMinPercent={outputPanelMinPercent}
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
                    parserMessagesContainerRef={parserMessagesContainerRef}
                    debugMessagesContainerRef={debugMessagesContainerRef}
                    onTabChange={onOutputTabChange}
                    openOutputPanel={openOutputPanel}
                    onClose={onOutputClose}
                    onClearCompilationOutput={onClearCompilationOutput}
                    onParserMessagesClear={onParserMessagesClear}
                    onParserGoToLine={onParserGoToLine}
                    onInsertSuggestion={onInsertSuggestion}
                    onRegistryClear={onRegistryClear}
                    setDebugMessageFilter={setDebugMessageFilter}
                    setDebugViewMode={setDebugViewMode}
                    onCopyDebugMessages={onCopyDebugMessages}
                    onClearDebugMessages={onClearDebugMessages}
                  />
                </ResizablePanel>
              </>
            );
          })()}
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle data-testid="horizontal-resizer" />

      {/* Right Panel - Serial Monitor & Board */}
      <ResizablePanel defaultSize={50} minSize={20} id="output-panel">
        <ResizablePanelGroup direction="vertical" id="output-layout">
          <ResizablePanel defaultSize={50} minSize={20} id="serial-panel">
            {serialSlot}
          </ResizablePanel>

          <ResizableHandle withHandle data-testid="vertical-resizer-board" />

          <ResizablePanel defaultSize={50} minSize={20} id="board-panel">
            {boardSlot}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * Main SimulatorLayout component — handles routing to desktop or mobile layout
 */
export function SimulatorLayout({
  isMobile,
  mobilePanel,
  setMobilePanel,
  headerHeight,
  overlayZ,
  editorSlot,
  codeSlot,
  compileSlot,
  serialSlot,
  boardSlot,
  outputPanelRef,
  outputTabsHeaderRef,
  parserMessagesContainerRef,
  debugMessagesContainerRef,
  activeOutputTab,
  showCompilationOutput,
  isSuccessState,
  isModified,
  compilationPanelSize,
  outputPanelMinPercent,
  debugMode,
  debugViewMode,
  debugMessageFilter,
  cliOutput,
  parserMessages,
  ioRegistry,
  debugMessages,
  lastCompilationResult,
  hasCompilationErrors,
  onOutputTabChange,
  onOutputClose,
  onClearCompilationOutput,
  onParserMessagesClear,
  onParserGoToLine,
  onInsertSuggestion,
  onRegistryClear,
  setDebugMessageFilter,
  setDebugViewMode,
  onCopyDebugMessages,
  onClearDebugMessages,
  openOutputPanel,
  outputPanelManuallyResizedRef,
}: SimulatorLayoutProps) {
  return (
    <div className="flex-1 overflow-hidden relative z-0">
      {!isMobile ? (
        <DesktopSimulatorLayout
          editorSlot={editorSlot}
          serialSlot={serialSlot}
          boardSlot={boardSlot}
          outputPanelRef={outputPanelRef}
          outputTabsHeaderRef={outputTabsHeaderRef}
          parserMessagesContainerRef={parserMessagesContainerRef}
          debugMessagesContainerRef={debugMessagesContainerRef}
          activeOutputTab={activeOutputTab}
          showCompilationOutput={showCompilationOutput}
          isSuccessState={isSuccessState}
          isModified={isModified}
          compilationPanelSize={compilationPanelSize}
          outputPanelMinPercent={outputPanelMinPercent}
          debugMode={debugMode}
          debugViewMode={debugViewMode}
          debugMessageFilter={debugMessageFilter}
          cliOutput={cliOutput}
          parserMessages={parserMessages}
          ioRegistry={ioRegistry}
          debugMessages={debugMessages}
          lastCompilationResult={lastCompilationResult}
          hasCompilationErrors={hasCompilationErrors}
          onOutputTabChange={onOutputTabChange}
          onOutputClose={onOutputClose}
          onClearCompilationOutput={onClearCompilationOutput}
          onParserMessagesClear={onParserMessagesClear}
          onParserGoToLine={onParserGoToLine}
          onInsertSuggestion={onInsertSuggestion}
          onRegistryClear={onRegistryClear}
          setDebugMessageFilter={setDebugMessageFilter}
          setDebugViewMode={setDebugViewMode}
          onCopyDebugMessages={onCopyDebugMessages}
          onClearDebugMessages={onClearDebugMessages}
          openOutputPanel={openOutputPanel}
          outputPanelManuallyResizedRef={outputPanelManuallyResizedRef}
        />
      ) : (
        <MobileLayout
          isMobile={isMobile}
          mobilePanel={mobilePanel}
          setMobilePanel={setMobilePanel}
          headerHeight={headerHeight}
          overlayZ={overlayZ}
          codeSlot={codeSlot}
          compileSlot={compileSlot}
          serialSlot={serialSlot}
          boardSlot={boardSlot}
        />
      )}
    </div>
  );
}
