/**
 * SimulatorLayout.tsx
 *
 * Extracted layout skeleton for ArduinoSimulator
 * Handles the complex ResizablePanel structure (desktop & mobile layouts)
 * in a reusable, testable component.
 */

import React, { type ReactNode } from "react";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import type { DebugMessage } from "@/hooks/use-debug-console";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { MobileLayout } from "@/components/features/mobile-layout";
import { OutputPanel } from "@/components/features/output-panel";

// ─── Type Aliases (S4323/S6754 - avoid inline union types) ────────────────────
/** Output panel tab types */
type OutputTab = "compiler" | "messages" | "registry" | "debug";

/** Debug view mode types */
type DebugViewMode = "table" | "tiles";

/** Mobile panel types */
type MobilePanel = "code" | "compile" | "serial" | "board" | null;

/**
 * Layout props for desktop ResizablePanel configuration
 */
export interface DesktopLayoutProps {
  // Editor panel (code slot)
  readonly editorSlot: ReactNode;

  // Output panel (compilation, messages, registry, debug)
  readonly outputPanelRef: React.RefObject<ImperativePanelHandle>;
  readonly outputTabsHeaderRef: React.RefObject<HTMLDivElement>;
  readonly parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  readonly debugMessagesContainerRef: React.RefObject<HTMLDivElement>;
  
  readonly activeOutputTab: OutputTab;
  readonly showCompilationOutput: boolean;
  readonly isSuccessState: boolean;
  readonly isModified: boolean;
  readonly compilationPanelSize: number;
  readonly outputPanelMinPercent: number;
  readonly debugMode: boolean;
  readonly debugViewMode: DebugViewMode;
  readonly debugMessageFilter: string;
  
  readonly cliOutput: string;
  readonly parserMessages: ParserMessage[];
  readonly ioRegistry: IOPinRecord[];
  readonly debugMessages: DebugMessage[];
  readonly lastCompilationResult: string | null;
  readonly hasCompilationErrors: boolean;
  
  readonly onOutputTabChange: (tab: OutputTab) => void;
  readonly onOutputClose: () => void;
  readonly onClearCompilationOutput: () => void;
  readonly onParserMessagesClear: () => void;
  readonly onParserGoToLine: (line: number) => void;
  readonly onInsertSuggestion: (suggestion: string, line?: number) => void;
  readonly onRegistryClear: () => void;
  readonly setDebugMessageFilter: (filter: string) => void;
  readonly setDebugViewMode: (mode: DebugViewMode) => void;
  readonly onCopyDebugMessages: () => void;
  readonly onClearDebugMessages: () => void;
  readonly openOutputPanel: (tab: OutputTab) => void;
  readonly outputPanelManuallyResizedRef: React.MutableRefObject<boolean>;

  // Serial monitor & board panels
  readonly serialSlot: ReactNode;
  readonly boardSlot: ReactNode;
}

/**
 * Mobile layout props
 */
export interface MobileLayoutPropsT {
  readonly isMobile: boolean;
  readonly mobilePanel: "compile" | "serial" | "board";
  readonly setMobilePanel: (panel: "compile" | "serial" | "board") => void;
  readonly headerHeight: number;
  readonly overlayZ: number;
  readonly codeSlot: ReactNode;
  readonly compileSlot: ReactNode;
  readonly serialSlot: ReactNode;
  readonly boardSlot: ReactNode;
}

/**
 * Combined layout props (either desktop or mobile)
 */
export interface SimulatorLayoutProps extends DesktopLayoutProps {
  readonly isMobile: boolean;
  readonly mobilePanel: MobilePanel;
  readonly setMobilePanel: React.Dispatch<React.SetStateAction<MobilePanel>>;
  readonly headerHeight: number;
  readonly overlayZ: number;
  readonly codeSlot: ReactNode;
  readonly compileSlot: ReactNode;
  readonly editorSlot: ReactNode;
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
            // Ensure the output tabs are always mounted so tests can interact with them,
            // even if the output panel is currently collapsed.
            const defaultSize = showCompilationOutput
              ? Math.max(compilationPanelSize, outputPanelMinPercent)
              : outputPanelMinPercent;

            return (
              <>
                <ResizableHandle
                  withHandle
                  data-testid="vertical-resizer-output"
                  onDragging={(isDragging) => {
                    if (isDragging) {
                      outputPanelManuallyResizedRef.current = true;
                    }
                  }}
                />

                <ResizablePanel
                  ref={outputPanelRef}
                  defaultSize={defaultSize}
                  minSize={outputPanelMinPercent}
                  id="output-under-editor"
                >
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
