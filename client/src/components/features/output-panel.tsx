import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { X, LayoutGrid, Table } from "lucide-react";
import clsx from "clsx";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import type { DebugMessage } from "@/hooks/use-debug-console";

export type OutputTab = "compiler" | "messages" | "registry" | "debug";

export interface OutputPanelProps {
  /* State */
  activeOutputTab: OutputTab;
  showCompilationOutput: boolean;
  isSuccessState: boolean;
  isModified: boolean;
  compilationPanelSize: number;
  outputPanelMinPercent: number;
  debugMode: boolean;
  debugViewMode: "table" | "tiles";
  debugMessageFilter: string;

  /* Data */
  cliOutput: string;
  parserMessages: ParserMessage[];
  ioRegistry: IOPinRecord[];
  debugMessages: DebugMessage[];
  lastCompilationResult: string | null;
  hasCompilationErrors: boolean;

  /* Refs */
  outputTabsHeaderRef: React.RefObject<HTMLDivElement>;
  parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  debugMessagesContainerRef: React.RefObject<HTMLDivElement>;

  /* Actions */
  onTabChange: (tab: OutputTab) => void;
  openOutputPanel: (tab: OutputTab) => void;
  onClose: () => void;
  getOutputPanelSize?: () => number;
  resizeOutputPanel?: (percent: number) => void;

  onClearCompilationOutput: () => void;
  onParserMessagesClear: () => void;
  onParserGoToLine: (line: number) => void;
  onInsertSuggestion: (suggestion: string, line?: number) => void;
  onRegistryClear?: () => void;

  setDebugMessageFilter: (s: string) => void;
  setDebugViewMode: (m: "table" | "tiles") => void;
  onCopyDebugMessages: () => void;
  onClearDebugMessages: () => void;
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

  return (
    <Tabs value={activeOutputTab} onValueChange={(v) => onTabChange(v as OutputTab)} className="h-full flex flex-col">
      <div ref={outputTabsHeaderRef} data-testid="output-tabs-header" className="flex items-center justify-start px-[var(--header-padding-x)] h-[var(--ui-header-height)] bg-muted border-b">
        <TabsList className="h-auto flex gap-1 bg-transparent items-center">
          <TabsTrigger value="compiler" onDoubleClick={() => openOutputPanel("compiler")} className={clsx("h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center", {
            "text-gray-400": lastCompilationResult === null,
            "text-green-400": isSuccessState && lastCompilationResult !== null,
            "text-red-400": hasCompilationErrors,
          })}>
            <span className={clsx({
              "text-gray-400": lastCompilationResult === null,
              "text-green-400": isSuccessState && lastCompilationResult !== null,
              "text-red-400": hasCompilationErrors,
            })}>
              Compiler
            </span>
          </TabsTrigger>

          <TabsTrigger value="messages" onDoubleClick={() => openOutputPanel("messages")} className={clsx("h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center", {
            "text-orange-400": parserMessages.length > 0,
            "text-gray-400": parserMessages.length === 0,
          })}>
            <span className={clsx({
              "text-orange-400": parserMessages.length > 0,
              "text-gray-400": parserMessages.length === 0,
            })}>
              Messages
            </span>
          </TabsTrigger>

          <TabsTrigger value="registry" onDoubleClick={() => openOutputPanel("registry")} className={clsx("h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center", {
            "text-blue-400": ioRegistry.some((r) => {
              const ops = r.usedAt || [];
              const digitalReads = ops.filter((u) => u.operation.includes("digitalRead"));
              const digitalWrites = ops.filter((u) => u.operation.includes("digitalWrite"));
              const pinModes = ops.filter((u) => u.operation.includes("pinMode")).map((u) => {
                const match = u.operation.match(/pinMode:(\d+)/);
                const mode = match ? parseInt(match[1]) : -1;
                return mode === 0 ? "INPUT" : mode === 1 ? "OUTPUT" : mode === 2 ? "INPUT_PULLUP" : "UNKNOWN";
              });
              const uniqueModes = [...new Set(pinModes)];
              const hasMultipleModes = uniqueModes.length > 1;
              const hasIOWithoutMode = (digitalReads.length > 0 || digitalWrites.length > 0) && pinModes.length === 0;
              return hasIOWithoutMode || hasMultipleModes;
            }),
            "text-gray-400": !ioRegistry.some(() => false),
          })}>
            <span className={clsx({
              "text-blue-400": ioRegistry.some((r) => {
                const ops = r.usedAt || [];
                const digitalReads = ops.filter((u) => u.operation.includes("digitalRead"));
                const digitalWrites = ops.filter((u) => u.operation.includes("digitalWrite"));
                const pinModes = ops.filter((u) => u.operation.includes("pinMode")).map((u) => {
                  const match = u.operation.match(/pinMode:(\d+)/);
                  const mode = match ? parseInt(match[1]) : -1;
                  return mode === 0 ? "INPUT" : mode === 1 ? "OUTPUT" : mode === 2 ? "INPUT_PULLUP" : "UNKNOWN";
                });
                const uniqueModes = [...new Set(pinModes)];
                const hasMultipleModes = uniqueModes.length > 1;
                const hasIOWithoutMode = (digitalReads.length > 0 || digitalWrites.length > 0) && pinModes.length === 0;
                return hasIOWithoutMode || hasMultipleModes;
              }),
              "text-gray-400": !ioRegistry.some(() => false),
            })}>
              I/O Registry
            </span>
          </TabsTrigger>

          {debugMode && (
            <TabsTrigger value="debug" onDoubleClick={() => openOutputPanel("debug")} className="h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center text-cyan-400 gap-1.5">
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
          <Button variant="outline" size="sm" onClick={onClose} className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <TabsContent value="compiler" className="flex-1 overflow-hidden m-0">
        <CompilationOutput output={cliOutput} onClear={onClearCompilationOutput} isSuccess={isSuccessState} showSuccessMessage={isSuccessState && !isModified} hideHeader={true} />
      </TabsContent>

      <TabsContent value="messages" className="flex-1 overflow-hidden m-0">
        <ParserOutput
          messages={parserMessages}
          ioRegistry={ioRegistry}
          messagesContainerRef={parserMessagesContainerRef as React.RefObject<HTMLDivElement>}
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
            <div className="bg-muted/50 border-b border-muted-foreground/30 px-3 h-[var(--ui-button-height)] flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-ui-xs text-muted-foreground whitespace-nowrap">Filter:</span>
                <select value={debugMessageFilter} onChange={(e) => setDebugMessageFilter(e.target.value.toLowerCase())} className="flex-1 px-2 py-1 text-ui-xs bg-background border border-muted-foreground/20 rounded text-foreground min-w-0 max-w-xs">
                  <option value="">All Types</option>
                  {Array.from(new Set(debugMessages.map((m) => m.type))).sort().map((type) => (
                    <option key={type} value={type.toLowerCase()}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setDebugViewMode(debugViewMode === "table" ? "tiles" : "table")} className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center text-ui-xs bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded hover:bg-cyan-600/30 transition-colors" title={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"}>
                  {debugViewMode === "table" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Table className="h-3.5 w-3.5" />}
                </button>
                <button onClick={onCopyDebugMessages} className="h-[var(--ui-button-height)] px-2 text-ui-xs bg-cyan-600/20 text-cyan-400 border border-cyan-600/40 rounded hover:bg-cyan-600/30 transition-colors">Copy</button>
                <button onClick={onClearDebugMessages} className="h-[var(--ui-button-height)] px-2 text-ui-xs bg-red-600/20 text-red-400 border border-red-600/40 rounded hover:bg-red-600/30 transition-colors">Clear</button>
              </div>
            </div>

            {debugViewMode === "table" && (
              <ScrollArea className="flex-1" viewportRef={debugMessagesContainerRef as React.Ref<HTMLDivElement>} thumbClassName="bg-status-success">
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
              </ScrollArea>
            )}

            {debugViewMode === "tiles" && (
              <ScrollArea className="flex-1" viewportRef={debugMessagesContainerRef as React.Ref<HTMLDivElement>} thumbClassName="bg-status-success">
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
              </ScrollArea>
            )}

          </div>
        )}
      </TabsContent>
    </Tabs>
  );
});
