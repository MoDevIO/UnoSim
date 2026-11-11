import { BasicDebugOutput } from "./basic-debug-output";
const DebugOutput = lazy(() => import("./debug-output").then((module) => ({ default: module.DebugOutput })));
import React, { lazy, Suspense } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CompilationOutput } from "@/components/features/compilation-output";

// The messages and registry tables are not needed before the first compile: they load with their tab (initial bundle budget, plan P3.9).
const ParserOutput = lazy(() => import("@/components/features/parser-output").then((module) => ({ default: module.ParserOutput })));
import { X } from "lucide-react";
import clsx from "clsx";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import { pinModeToString } from "@shared/utils/arduino-utils";
import type { DebugMessage } from "@/hooks/use-debug-console";
import type { OutputTab } from "@/types/compilation.types";
import type { SourceNavigationTarget } from "@/types/source-navigation";
import { TabBar } from "@/components/ui/tab-bar";
import { getHighestSeverityStatus, getStatusTextClass } from "@/lib/status-semantics";
import type { ApplicationStatus } from "@/lib/status-semantics";

function hasRegistryConflict(record: IOPinRecord): boolean {
  const ops = record.usedAt || [];
  const digitalReads = ops.filter((u) => u.operation.includes("digitalRead"));
  const digitalWrites = ops.filter((u) => u.operation.includes("digitalWrite"));
  const pinModes = ops
    .filter((u) => u.operation.includes("pinMode"))
    .map((u) => {
      const match = /pinMode:(\d+)/.exec(u.operation);
      return pinModeToString(match ? Number.parseInt(match[1]) : -1);
    });
  const uniqueModes = [...new Set(pinModes)];
  return (
    ((digitalReads.length > 0 || digitalWrites.length > 0) && pinModes.length === 0) ||
    uniqueModes.length > 1
  );
}

import type { BoardId } from "@shared/boards";

interface OutputPanelProps {
  readonly boardId?: BoardId;
  /* State */
  readonly activeOutputTab: OutputTab;
  readonly isSuccessState: boolean;
  readonly isModified: boolean;
  readonly debugMode: boolean;
  readonly debugViewMode: "table" | "tiles";
  readonly debugMessageFilter: string;

  /* Data */
  readonly cliOutput: string;
  readonly parserMessages: ParserMessage[];
  readonly ioRegistry: IOPinRecord[];
  readonly debugMessages: DebugMessage[];
  readonly debugDroppedCount?: number;
  readonly lastCompilationResult: string | null;
  readonly hasCompilationErrors: boolean;

  /* Refs */
  readonly outputTabsHeaderRef: React.RefObject<HTMLDivElement>;
  readonly parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  readonly debugMessagesContainerRef: React.RefObject<HTMLDivElement>;

  /* Actions */
  readonly onTabChange: (tab: OutputTab) => void;
  readonly openOutputPanel: (tab: OutputTab) => void;
  readonly onClose: () => void;

  readonly onClearCompilationOutput: () => void;
  readonly onParserMessagesClear: () => void;
  readonly onParserGoToLine: (target: SourceNavigationTarget) => void;
  readonly onInsertSuggestion: (suggestion: string, line?: number) => void;
  readonly onRegistryClear?: () => void;

  readonly setDebugMessageFilter: (s: string) => void;
  readonly setDebugViewMode: (m: "table" | "tiles") => void;
  readonly onCopyDebugMessages: (text?: string, count?: number) => void;
  readonly onClearDebugMessages: () => void;
}



export const OutputPanel = React.memo(function OutputPanel(props: OutputPanelProps) {
  const {
    boardId,
    activeOutputTab,
    isSuccessState,
    isModified,
    cliOutput,
    parserMessages,
    ioRegistry,
    debugMode,
    debugViewMode,
    debugMessageFilter,
    debugMessages,
    lastCompilationResult,
    hasCompilationErrors,
    outputTabsHeaderRef,
    parserMessagesContainerRef,
    debugMessagesContainerRef,
    onTabChange,
    openOutputPanel,
    onClose,
    onClearCompilationOutput,
    onParserMessagesClear,
    onParserGoToLine,
    onInsertSuggestion,
    onRegistryClear = () => {},
    setDebugMessageFilter,
    setDebugViewMode,
    onCopyDebugMessages,
    onClearDebugMessages,
  } = props;
  const registryHasConflict = ioRegistry.some(hasRegistryConflict);
  const messageStatus = getHighestSeverityStatus(parserMessages.map((message) => message.severity));
  let compilationStatus: ApplicationStatus = "idle";
  if (hasCompilationErrors) {
    compilationStatus = "error";
  } else if (isSuccessState && lastCompilationResult !== null) {
    compilationStatus = "success";
  }
  const compilationStatusClass = getStatusTextClass(compilationStatus);
  const messageStatusClass = getStatusTextClass(messageStatus);

  const debugProps = { debugMessages, debugMessageFilter, setDebugMessageFilter, debugViewMode, setDebugViewMode, debugMessagesContainerRef, onCopyDebugMessages, onClearDebugMessages, debugDroppedCount: props.debugDroppedCount };
  return (
    <Tabs value={activeOutputTab} onValueChange={(v) => onTabChange(v as OutputTab)} className="h-full flex flex-col">
      <TabBar ref={outputTabsHeaderRef} data-testid="output-tabs-header" className="unified-tab-bar--panel justify-start h-[var(--ui-header-height)] border-b">
        <TabsList className="h-full flex gap-0 bg-transparent items-center">
          <TabsTrigger value="compiler" onDoubleClick={() => openOutputPanel("compiler")} className={clsx("uppercase tracking-wide", compilationStatusClass)}>
            <span className={compilationStatusClass}>
              Compiler
            </span>
          </TabsTrigger>

          <TabsTrigger value="messages" onDoubleClick={() => openOutputPanel("messages")} className={clsx("uppercase tracking-wide", messageStatusClass)}>
            <span className={messageStatusClass}>
              Messages
            </span>
          </TabsTrigger>

          <TabsTrigger value="registry" onDoubleClick={() => openOutputPanel("registry")} className={clsx("uppercase tracking-wide", getStatusTextClass(registryHasConflict ? "error" : "idle"))}>
            <span className={getStatusTextClass(registryHasConflict ? "error" : "idle")}>
              I/O Registry
            </span>
          </TabsTrigger>

          {debugMode && (
            <TabsTrigger value="debug" onDoubleClick={() => openOutputPanel("debug")} className={`uppercase tracking-wide ${getStatusTextClass("info")}`}>
              Debug
              {debugMessages.length > 0 && (
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cyan-600/30 text-cyan-300 text-[9px] font-mono leading-none overflow-hidden">
                  {debugMessages.length > 99 ? "99" : debugMessages.length}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <div className="flex-1" />
        <div className="flex items-center px-2">
          <Button variant="outline" size="icon" onClick={onClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </TabBar>

      <TabsContent value="compiler" className="flex-1 overflow-hidden m-0">
        <CompilationOutput output={cliOutput} onClear={onClearCompilationOutput} isSuccess={isSuccessState} hasCompilationErrors={hasCompilationErrors} showSuccessMessage={isSuccessState && !isModified} hideHeader={true} />
      </TabsContent>

      <TabsContent value="messages" className="flex-1 overflow-hidden m-0">
        <Suspense fallback={null}>
          <ParserOutput
            boardId={boardId}
            messages={parserMessages}
            ioRegistry={ioRegistry}
            messagesContainerRef={parserMessagesContainerRef}
            onClear={onParserMessagesClear}
            onGoToLine={onParserGoToLine}
            onInsertSuggestion={onInsertSuggestion}
            hideHeader={true}
          />
        </Suspense>
      </TabsContent>

      <TabsContent value="registry" className="flex-1 overflow-hidden m-0">
        <Suspense fallback={null}>
          <ParserOutput boardId={boardId} messages={[]} ioRegistry={ioRegistry} onClear={onRegistryClear} onGoToLine={onParserGoToLine} hideHeader={true} defaultTab="registry" />
        </Suspense>
      </TabsContent>

      <TabsContent value="debug" className="flex-1 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden">
        {activeOutputTab === "debug" && <Suspense fallback={<BasicDebugOutput {...debugProps} enhancementPending={debugMessages.some((message) => message.category === "tutor")} />}><DebugOutput {...debugProps} /></Suspense>}
      </TabsContent>
    </Tabs>
  );
});
