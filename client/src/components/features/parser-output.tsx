import {
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import { clsx } from "clsx";
import { useState } from "react";
import * as React from "react";

interface ParserOutputProps {
  messages: ParserMessage[];
  ioRegistry?: IOPinRecord[];
  onClear: () => void;
  onGoToLine?: (line: number) => void;
  onInsertSuggestion?: (suggestion: string, line?: number) => void;
  hideHeader?: boolean;
  defaultTab?: "messages" | "registry";
}

export function ParserOutput({
  messages,
  ioRegistry = [],
  onClear,
  onGoToLine,
  onInsertSuggestion,
  hideHeader = false,
  defaultTab = "messages",
}: ParserOutputProps) {
  const [activeTab, setActiveTab] = useState<"messages" | "registry">(
    defaultTab,
  );
  const [showAllPins, setShowAllPins] = useState(false);
  // PWM-capable pins on Arduino UNO
  const PWM_PINS = [3, 5, 6, 9, 10, 11];

  // Check for I/O registry problems
  const hasIOProblems = React.useMemo(() => {
    return ioRegistry.some((record) => {
      const ops = record.usedAt || [];
      const digitalReads = ops.filter((u) =>
        u.operation.includes("digitalRead"),
      );
      const digitalWrites = ops.filter((u) =>
        u.operation.includes("digitalWrite"),
      );
      const pinModes = ops
        .filter((u) => u.operation.includes("pinMode"))
        .map((u) => {
          const match = u.operation.match(/pinMode:(\d+)/);
          const mode = match ? parseInt(match[1]) : -1;
          return mode === 0
            ? "INPUT"
            : mode === 1
              ? "OUTPUT"
              : mode === 2
                ? "INPUT_PULLUP"
                : "UNKNOWN";
        });
      const uniqueModes = [...new Set(pinModes)];
      const hasMultipleModes = uniqueModes.length > 1;

      // Problem: digitalWrite/digitalRead without pinMode
      const hasIOWithoutMode =
        (digitalReads.length > 0 || digitalWrites.length > 0) &&
        pinModes.length === 0;

      // Problem: Multiple different pinMode calls
      return hasIOWithoutMode || hasMultipleModes;
    });
  }, [ioRegistry]);

  // Auto-switch to registry tab if registry has problems and no messages
  // But only if defaultTab is 'messages' (to not interfere with explicit registry view)
  React.useEffect(() => {
    if (defaultTab === "messages") {
      if (hasIOProblems && messages.length === 0) {
        setActiveTab("registry");
      } else if (messages.length > 0) {
        setActiveTab("messages");
      }
    }
  }, [hasIOProblems, messages.length, defaultTab]);

  // Group messages by category for better organization
  const messagesByCategory = messages.reduce(
    (acc, msg) => {
      if (!acc[msg.category]) {
        acc[msg.category] = [];
      }
      acc[msg.category].push(msg);
      return acc;
    },
    {} as Record<string, ParserMessage[]>,
  );

  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      serial: "Serial Configuration",
      structure: "Code Structure",
      hardware: "Hardware Compatibility",
      pins: "Pin Conflicts",
      performance: "Performance Issues",
    };
    return labels[category] || category;
  };

  // Filter pins: show only programmed pins by default, all pins if showAllPins is true
  const filteredRegistry = React.useMemo(() => {
    if (showAllPins) {
      return ioRegistry;
    }
    // Only show pins that have operations or are defined
    return ioRegistry.filter((record) => {
      const hasOperations = record.usedAt && record.usedAt.length > 0;
      const hasPinMode =
        record.defined ||
        (record.usedAt?.some((u) => u.operation.includes("pinMode")) ?? false);
      return hasOperations || hasPinMode;
    });
  }, [ioRegistry, showAllPins]);

  // Count of programmed pins (pins with any operation)
  const totalProgrammedPins = React.useMemo(() => {
    return ioRegistry.filter((record) => {
      const hasOperations = record.usedAt && record.usedAt.length > 0;
      const hasPinMode =
        record.defined ||
        (record.usedAt?.some((u) => u.operation.includes("pinMode")) ?? false);
      return hasOperations || hasPinMode;
    }).length;
  }, [ioRegistry]);

  // Inline CSS to hide scrollbars while keeping scrolling functional
  const hideScrollbarStyle = `
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }
  `;

  const getSeverityIcon = (severity: 1 | 2 | 3) => {
    if (severity === 1) return <Info className="w-4 h-4 text-blue-400" />;
    if (severity === 2)
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    return <AlertCircle className="w-4 h-4 text-red-400" />;
  };

  const getSeverityLabel = (severity: 1 | 2 | 3): string => {
    if (severity === 1) return "Info";
    if (severity === 2) return "Warning";
    return "Error";
  };

  const totalErrors = messages.filter((m) => m.severity === 3).length;
  const totalWarnings = messages.filter((m) => m.severity === 2).length;
  const totalInfos = messages.filter((m) => m.severity === 1).length;

  return (
    <div className="h-full flex flex-col border-b border-border">
      {/* Tabs wrapper for entire component */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "messages" | "registry")}
        className="h-full flex flex-col"
      >
        {/* Header with integrated tabs */}
        {!hideHeader && (
          <div className="bg-muted px-4 border-b border-border flex items-center h-[var(--ui-button-height)] overflow-hidden">
            <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
              <div className="flex items-center space-x-2 flex-shrink-0">
                <AlertCircle
                  className="text-white opacity-95 h-5 w-5"
                  strokeWidth={1.67}
                />
                <span className="text-ui-sm font-medium text-white opacity-95">
                  Parser Analysis
                </span>
              </div>
              {/* Tabs integrated in header */}
              <TabsList className="bg-transparent h-auto ml-4 p-0 gap-1">
                <TabsTrigger
                  value="messages"
                  className="h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background/80 data-[state=inactive]:text-muted-foreground rounded"
                >
                  Messages {messages.length > 0 && `(${messages.length})`}
                </TabsTrigger>
                <TabsTrigger
                  value="registry"
                  className="h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background/80 data-[state=inactive]:text-muted-foreground rounded"
                >
                  I/O Registry{" "}
                  {(showAllPins ? ioRegistry.length : totalProgrammedPins) >
                    0 &&
                    `(${showAllPins ? ioRegistry.length : totalProgrammedPins})`}
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-3 ml-4 text-ui-sm">
                {totalErrors > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">{totalErrors}</span>
                  </span>
                )}
                {totalWarnings > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-yellow-400">{totalWarnings}</span>
                  </span>
                )}
                {totalInfos > 0 && (
                  <span className="flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-blue-400">{totalInfos}</span>
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0" />
              <Button
                variant="outline"
                size="sm"
                onClick={onClear}
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Messages Tab */}
        <TabsContent
          value="messages"
          className="flex-1 flex flex-col overflow-hidden m-0 data-[state=inactive]:hidden"
        >
          <style>{hideScrollbarStyle}</style>
          {messages.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-ui-xs">
              No parser messages
            </div>
          ) : (
            <div className="p-3 text-ui-xs space-y-2 overflow-auto no-scrollbar flex-1">
              {Object.entries(messagesByCategory).map(
                ([category, categoryMessages]) => (
                  <div key={category} className="space-y-1">
                    {/* Category Header */}
                    <div className="text-muted-foreground font-semibold uppercase tracking-wide text-ui-xs mb-1.5">
                      {getCategoryLabel(category)}
                    </div>

                    {/* Category Messages */}
                    {categoryMessages.map((message) => (
                      <div
                        key={message.id}
                        className="p-2 bg-muted/50 rounded border-l-2 cursor-pointer hover:bg-muted/70 transition-colors"
                        style={{
                          borderLeftColor:
                            message.severity === 1
                              ? "rgb(96 165 250)" // blue-400
                              : message.severity === 2
                                ? "rgb(250 204 21)" // yellow-400
                                : "rgb(248 113 113)", // red-400
                        }}
                        onClick={() =>
                          message.line !== undefined &&
                          onGoToLine?.(message.line)
                        }
                      >
                        <div className="flex items-start gap-2">
                          {getSeverityIcon(message.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground font-medium mb-1">
                              {message.message}
                            </div>
                            <div className="text-muted-foreground text-ui-xs space-x-2">
                              {message.line !== undefined && (
                                <span>Line {message.line}</span>
                              )}
                              {message.column !== undefined &&
                                message.column > 0 && (
                                  <span>• Col {message.column}</span>
                                )}
                              <span>
                                • {getSeverityLabel(message.severity)}
                              </span>
                            </div>
                            {message.suggestion && (
                              <div className="mt-1.5 p-2 border border-muted-foreground/30 rounded bg-muted/30 flex items-start gap-2">
                                <div className="flex-1 text-muted-foreground text-ui-xs">
                                  <span className="font-semibold">
                                    Suggestion:
                                  </span>{" "}
                                  {message.suggestion}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onInsertSuggestion?.(
                                      message.suggestion!,
                                      message.line,
                                    );
                                  }}
                                  className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center hover:bg-primary/20"
                                  title="Insert suggestion"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
          )}
        </TabsContent>

        {/* I/O Registry Tab */}
        <TabsContent
          value="registry"
          className="flex-1 overflow-auto custom-scrollbar m-0 flex flex-col data-[state=inactive]:hidden"
        >
          {/* Toggle Button for Pin Visibility */}
          <div className="sticky top-0 bg-muted/50 border-b border-muted-foreground/30 px-3 h-[var(--ui-button-height)] flex items-center justify-between z-10">
            <span className="text-ui-xs text-muted-foreground">
              {showAllPins
                ? `All pins (${ioRegistry.length})`
                : `Programmed pins (${totalProgrammedPins})`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllPins(!showAllPins)}
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
              title={showAllPins ? "Hide empty pins" : "Show all pins"}
            >
              {showAllPins ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <div className="flex-1 overflow-auto no-scrollbar">
            <style>{hideScrollbarStyle}</style>
            {filteredRegistry.length === 0 ? (
              <div className="text-muted-foreground p-4 text-center text-ui-xs">
                {showAllPins ? (
                  "No pins available"
                ) : (
                  <div className="space-y-2">
                    <p>No pins used in current sketch</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setShowAllPins(true)}
                      className="h-auto p-0 text-ui-xs text-blue-400"
                    >
                      Show all pins →
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full overflow-visible">
                <table className="w-full text-ui-xs border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-muted-foreground/30 bg-muted/50">
                      <th className="px-2 py-1 text-right font-semibold text-foreground">
                        Pin
                      </th>
                      <th className="px-2 py-1 text-center font-semibold text-foreground">
                        pinMode
                      </th>
                      <th className="px-2 py-1 text-center font-semibold text-foreground">
                        digitalRead
                      </th>
                      <th className="px-2 py-1 text-center font-semibold text-foreground">
                        digitalWrite
                      </th>
                      <th className="px-2 py-1 text-center font-semibold text-foreground">
                        analogRead
                      </th>
                      <th className="px-2 py-1 text-center font-semibold text-foreground">
                        analogWrite
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegistry.map((record, idx) => {
                      // Extract operations by type
                      const ops = record.usedAt || [];
                      const digitalReads = ops.filter((u) =>
                        u.operation.includes("digitalRead"),
                      );
                      const digitalWrites = ops.filter((u) =>
                        u.operation.includes("digitalWrite"),
                      );
                      const analogReads = ops.filter((u) =>
                        u.operation.includes("analogRead"),
                      );
                      const analogWrites = ops.filter((u) =>
                        u.operation.includes("analogWrite"),
                      );
                      const pinModes = ops
                        .filter((u) => u.operation.includes("pinMode"))
                        .map((u) => {
                          const match = u.operation.match(/pinMode:(\d+)/);
                          const mode = match ? parseInt(match[1]) : -1;
                          return mode === 0
                            ? "INPUT"
                            : mode === 1
                              ? "OUTPUT"
                              : mode === 2
                                ? "INPUT_PULLUP"
                                : "UNKNOWN";
                        });
                      const uniqueModes = [...new Set(pinModes)];
                      const hasMultipleModes = uniqueModes.length > 1;

                      return (
                        <tr
                          key={record.pin}
                          className={`border-b border-muted-foreground/10 h-7 ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                        >
                          {/* Pin Column */}
                          <td className="px-2 py-1 text-right font-mono font-semibold text-cyan-400">
                            <div className="flex items-center justify-end gap-2">
                              {/* RX/TX prefix for pin 0/1 */}
                              {(() => {
                                const pinStr = String(record.pin);
                                if (pinStr === "0")
                                  return (
                                    <span className="text-blue-400 text-ui-xs font-semibold">
                                      RX
                                    </span>
                                  );
                                if (pinStr === "1")
                                  return (
                                    <span className="text-red-400 text-ui-xs font-semibold">
                                      TX
                                    </span>
                                  );
                                return null;
                              })()}
                              {/* PWM tilde prefix if numeric pin and PWM-capable */}
                              {(() => {
                                const n = parseInt(String(record.pin), 10);
                                return !Number.isNaN(n) &&
                                  PWM_PINS.includes(n) ? (
                                  <span className="text-yellow-400">~</span>
                                ) : null;
                              })()}
                              <span>{record.pin}</span>
                            </div>
                          </td>

                          {/* pinMode Column */}
                          <td
                            className={clsx(
                              "px-2 py-1 text-center",
                              hasMultipleModes && "border-2 border-red-500",
                            )}
                          >
                            {pinModes.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {uniqueModes.map((mode, i) => {
                                  const count = pinModes.filter(
                                    (m) => m === mode,
                                  ).length;
                                  const modeColor =
                                    mode === "INPUT"
                                      ? "text-blue-400"
                                      : mode === "OUTPUT"
                                        ? "text-orange-400"
                                        : "text-green-400";
                                  return (
                                    <div
                                      key={i}
                                      className="flex items-center justify-center gap-1"
                                    >
                                      <span className={modeColor}>{mode}</span>
                                      {hasMultipleModes && (
                                        <span className="text-red-400">?</span>
                                      )}
                                      {count > 1 && (
                                        <span className="text-yellow-400 text-ui-xs">
                                          x{count}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : record.defined &&
                              record.pinMode !== undefined ? (
                              <div className="text-center">
                                <span
                                  className={
                                    record.pinMode === 0
                                      ? "text-blue-400"
                                      : record.pinMode === 1
                                        ? "text-orange-400"
                                        : "text-green-400"
                                  }
                                >
                                  {record.pinMode === 0
                                    ? "INPUT"
                                    : record.pinMode === 1
                                      ? "OUTPUT"
                                      : "INPUT_PULLUP"}
                                </span>
                              </div>
                            ) : digitalReads.length > 0 ||
                              digitalWrites.length > 0 ? (
                              <div
                                className="flex items-center justify-center"
                                title="pinMode() missing"
                              >
                                <X className="w-4 h-4 text-red-500" />
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>

                          {/* digitalRead Column */}
                          <td className="px-2 py-1 text-center">
                            {digitalReads.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {digitalReads.map((usage, i) => (
                                  <div key={i} className="text-ui-xs">
                                    {usage.line > 0 ? (
                                      <span className="text-blue-400">
                                        L{usage.line}
                                      </span>
                                    ) : (
                                      <span className="text-green-500 font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>

                          {/* digitalWrite Column */}
                          <td className="px-2 py-1 text-center">
                            {digitalWrites.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {digitalWrites.map((usage, i) => (
                                  <div key={i} className="text-ui-xs">
                                    {usage.line > 0 ? (
                                      <span className="text-blue-400">
                                        L{usage.line}
                                      </span>
                                    ) : (
                                      <span className="text-green-500 font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>

                          {/* analogRead Column */}
                          <td className="px-2 py-1 text-center">
                            {analogReads.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {analogReads.map((usage, i) => (
                                  <div key={i} className="text-ui-xs">
                                    {usage.line > 0 ? (
                                      <span className="text-blue-400">
                                        L{usage.line}
                                      </span>
                                    ) : (
                                      <span className="text-green-500 font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>

                          {/* analogWrite Column */}
                          <td className="px-2 py-1 text-center">
                            {analogWrites.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {analogWrites.map((usage, i) => (
                                  <div key={i} className="text-ui-xs">
                                    {usage.line > 0 ? (
                                      <span className="text-blue-400">
                                        L{usage.line}
                                      </span>
                                    ) : (
                                      <span className="text-green-500 font-bold">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
