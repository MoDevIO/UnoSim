import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { X, LayoutGrid, Table, Copy, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import { pinModeToString } from "@shared/utils/arduino-utils";
import type { DebugMessage } from "@/hooks/use-debug-console";
import type { OutputTab } from "@/types/compilation.types";
import type { SourceNavigationTarget } from "@/types/source-navigation";
import { TabBar } from "@/components/ui/tab-bar";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
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

interface OutputPanelProps {
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
  readonly onCopyDebugMessages: () => void;
  readonly onClearDebugMessages: () => void;
}

export const OutputPanel = React.memo(function OutputPanel(props: OutputPanelProps) {
  const {
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
            <TabsTrigger value="debug" onDoubleClick={() => openOutputPanel("debug")} className="uppercase tracking-wide text-cyan-400">
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
        <ParserOutput
          messages={parserMessages}
          ioRegistry={ioRegistry}
          messagesContainerRef={parserMessagesContainerRef}
          onClear={onParserMessagesClear}
          onGoToLine={onParserGoToLine}
          onInsertSuggestion={onInsertSuggestion}
          hideHeader={true}
        />
      </TabsContent>

      <TabsContent value="registry" className="flex-1 overflow-hidden m-0">
        <ParserOutput messages={[]} ioRegistry={ioRegistry} onClear={onRegistryClear} onGoToLine={onParserGoToLine} hideHeader={true} defaultTab="registry" />
      </TabsContent>

      <TabsContent value="debug" className="flex-1 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden">
        {activeOutputTab === "debug" && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="panel-content-header bg-muted/50 border-b border-muted-foreground/30 px-3 justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-ui-xs text-muted-foreground whitespace-nowrap">Filter:</span>
                <select value={debugMessageFilter} onChange={(e) => setDebugMessageFilter(e.target.value.toLowerCase())} className="flex-1 px-2 py-1 text-ui-xs bg-background border border-muted-foreground/20 rounded text-foreground min-w-0 max-w-xs">
                  <option value="">All Types</option>
                  {Array.from(new Set(debugMessages.map((m) => m.type))).sort((a, b) => a.localeCompare(b)).map((type) => (
                    <option key={type} value={type.toLowerCase()}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <ToolbarIconButton
                  icon={debugViewMode === "table" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Table className="h-3.5 w-3.5" />}
                  label={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"}
                  onClick={() => setDebugViewMode(debugViewMode === "table" ? "tiles" : "table")}
                />
                <ToolbarIconButton
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label="Copy debug messages"
                  onClick={onCopyDebugMessages}
                />
                <ToolbarIconButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Clear debug messages"
                  destructive
                  onClick={onClearDebugMessages}
                />
              </div>
            </div>

            {debugViewMode === "table" && (
              <UnifiedScrollArea className="flex-1" orientation="vertical" viewportRef={debugMessagesContainerRef}>
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
                    {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).slice(-100).map((msg, idx) => (
                      <tr key={msg.id} className={`border-b border-muted-foreground/10 ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-muted/40 transition-colors`}>
                        <td className="px-2 py-1 text-cyan-400 border-r border-muted-foreground/10 font-mono whitespace-nowrap">{msg.timestamp.toLocaleTimeString()}</td>
                        <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap"><span className={msg.sender === "server" ? "text-blue-400" : "text-green-400"}>{msg.sender.toUpperCase()}</span></td>
                        <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap"><span className={msg.protocol === "http" ? "text-orange-400" : "text-purple-400"}>{msg.protocol?.toUpperCase() || "?"}</span></td>
                        <td className="px-2 py-1 border-r border-muted-foreground/10 whitespace-nowrap"><span className="text-yellow-400 font-mono">{msg.type}</span></td>
                        <td className="px-2 py-1 text-gray-300 font-mono max-w-md truncate" title={msg.content}>{msg.content}</td>
                      </tr>
                    ))}
                    {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground text-ui-xs">{debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </UnifiedScrollArea>
            )}

            {debugViewMode === "tiles" && (
              <UnifiedScrollArea className="flex-1" orientation="vertical" viewportRef={debugMessagesContainerRef}>
                <div className="p-3">
                  <div className="space-y-3">
                    {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).slice(-50).map((msg) => (
                      <div key={msg.id} className="bg-muted/20 border border-muted-foreground/20 rounded p-3 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-muted-foreground/20">
                          <div className="flex items-center gap-3">
                            <span className={`text-ui-xs font-semibold px-2 py-0.5 rounded ${msg.sender === "server" ? "bg-blue-600/20 text-blue-400" : "bg-green-600/20 text-green-400"}`}>{msg.sender.toUpperCase()}</span>
                            <span className="text-ui-xs text-yellow-400 font-mono bg-yellow-600/10 px-2 py-0.5 rounded">{msg.type}</span>
                          </div>
                          <span className="text-ui-xs text-cyan-400 font-mono whitespace-nowrap">{msg.timestamp.toLocaleTimeString()}</span>
                        </div>
                        <pre className="text-ui-xs text-gray-300 font-mono overflow-x-auto bg-black/20 p-2 rounded border border-muted-foreground/10"><code>{(() => { try { const parsed = JSON.parse(msg.content); return JSON.stringify(parsed, null, 2); } catch { return msg.content; } })()}</code></pre>
                      </div>
                    ))}
                    {debugMessages.filter((m) => !debugMessageFilter || m.type.toLowerCase() === debugMessageFilter).length === 0 && (
                      <div className="text-center text-muted-foreground text-ui-xs py-8">{debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}</div>
                    )}
                  </div>
                </div>
              </UnifiedScrollArea>
            )}

          </div>
        )}
      </TabsContent>
    </Tabs>
  );
});
