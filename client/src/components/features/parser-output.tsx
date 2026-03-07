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
  messagesContainerRef?: React.RefObject<HTMLDivElement>;
}

export function ParserOutput({
  messages,
  ioRegistry = [],
  onClear,
  onGoToLine,
  onInsertSuggestion,
  hideHeader = false,
  defaultTab = "messages",
  messagesContainerRef,
}: ParserOutputProps) {
  const [activeTab, setActiveTab] = useState<"messages" | "registry">(
    defaultTab,
  );
  const [showAllPins, setShowAllPins] = useState(false);
  /** detailView: false = compact (✓/—), true = extended (line numbers). Eye-button toggle per SSOT. */
  const [detailView, setDetailView] = useState(false);
  // PWM-capable pins on Arduino UNO
  const PWM_PINS = [3, 5, 6, 9, 10, 11];

  // Check for I/O registry problems is handled by the I/O Registry tab display

  // Do NOT auto-switch tabs - let user control which tab they want to see
  // Previously this auto-switched to registry when no messages, but that was confusing

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

  // A pin is "programmed" if it appears in the static or runtime registry
  const isPinProgrammed = React.useCallback(
    (record: IOPinRecord): boolean =>
      record.defined ||
      (record.pinModeLines?.length ?? 0) > 0 ||
      (record.digitalReadLines?.length ?? 0) > 0 ||
      (record.digitalWriteLines?.length ?? 0) > 0 ||
      (record.analogReadLines?.length ?? 0) > 0 ||
      (record.analogWriteLines?.length ?? 0) > 0 ||
      (record.usedAt?.length ?? 0) > 0,
    [],
  );

  // Filter pins: show only programmed pins by default, all pins if showAllPins is true
  const filteredRegistry = React.useMemo(() => {
    if (showAllPins) return ioRegistry;
    return ioRegistry.filter(isPinProgrammed);
  }, [ioRegistry, showAllPins, isPinProgrammed]);

  // Count of programmed pins (pins with any operation)
  const totalProgrammedPins = React.useMemo(
    () => ioRegistry.filter(isPinProgrammed).length,
    [ioRegistry, isPinProgrammed],
  );

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
          <div className="bg-muted px-4 border-b border-border flex items-center h-[var(--ui-header-height)] overflow-hidden">
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
                className="h-[var(--ui-header-height)] px-2 text-ui-xs data-[state=active]:bg-background/80 data-[state=inactive]:text-muted-foreground rounded"
              >
                Messages {messages.length > 0 && `(${messages.length})`}
              </TabsTrigger>
              <TabsTrigger
                value="registry"
                className="h-[var(--ui-header-height)] px-2 text-ui-xs data-[state=active]:bg-background/80 data-[state=inactive]:text-muted-foreground rounded"
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
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center ml-2 border-2 border-red-500"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
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
            <div
              className="p-3 text-ui-xs space-y-2 overflow-auto no-scrollbar flex-1"
              ref={messagesContainerRef}
              data-testid="parser-messages-container"
            >
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
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onInsertSuggestion?.(
                                      message.suggestion!,
                                      message.line,
                                    );
                                  }}
                                  className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center ml-3"
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
            <div className="flex items-center gap-1">
              {/* Show-all toggle (text button) */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllPins(!showAllPins)}
                className="h-[var(--ui-button-height)] px-1.5 text-ui-xs text-muted-foreground hover:text-foreground"
                title={showAllPins ? "Hide empty pins" : "Show all pins"}
              >
                {showAllPins ? "Used" : "All"}
              </Button>
              {/* Eye button: compact (✓/—) vs extended (line numbers) – SSOT eye-mode */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailView(!detailView)}
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                title={detailView ? "Compact view (✓ / —)" : "Extended view (line numbers)"}
                data-testid="io-registry-detail-toggle"
              >
                {detailView ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
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
              <div className="h-full overflow-auto">
                <table className="w-full text-ui-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 z-40 border-b border-muted-foreground/30 bg-muted">
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
                      // ── Derive modes ─────────────────────────────────────
                      // Prefer new static-parse fields (pinModeModes/Lines);
                      // fall back to legacy usedAt for runtime-only pins.
                      const ops = record.usedAt || [];

                      const pmModes: string[] =
                        record.pinModeModes ??
                        ops
                          .filter((u) => u.operation.includes("pinMode"))
                          .map((u) => {
                            const m = u.operation.match(/pinMode:(\d+)/);
                            const n = m ? parseInt(m[1]) : -1;
                            return n === 0
                              ? "INPUT"
                              : n === 1
                                ? "OUTPUT"
                                : n === 2
                                  ? "INPUT_PULLUP"
                                  : "UNKNOWN";
                          });
                      const uniqueModes = [...new Set(pmModes)];

                      // Conflict: TC9 (write on input) or TC11 (multi-mode)
                      const hasConflict =
                        record.conflict ?? uniqueModes.length > 1;

                      // ── Helper: render an op cell ────────────────────────
                      // newLines  = from static parse (has line numbers)
                      // legacyOps = from runtime usedAt (line may be 0)
                      const renderOpCell = (
                        newLines: Array<number | "runtime"> | undefined,
                        legacyOps: typeof ops,
                      ) => {
                        const hasNew = (newLines?.length ?? 0) > 0;
                        const hasLegacy = legacyOps.length > 0;
                        const isUsed = hasNew || hasLegacy;

                        if (!isUsed)
                          return (
                            <span className="text-gray-400">—</span>
                          );

                        // Compact mode: just a checkmark
                        if (!detailView)
                          return (
                            <span className="text-green-500 font-bold">
                              ✓
                            </span>
                          );

                        // Extended mode: line numbers
                        const lines: Array<number | "runtime"> = hasNew
                          ? newLines!
                          : legacyOps.map((u) =>
                              u.line > 0
                                ? u.line
                                : ("runtime" as const),
                            );
                        return (
                          <div className="space-y-0.5 text-center">
                            {lines.map((line, i) => (
                              <div key={i} className="text-ui-xs">
                                {line === "runtime" ? (
                                  <span className="text-yellow-400 italic">
                                    runtime
                                  </span>
                                ) : (
                                  <span className="text-blue-400">
                                    L{line}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      };

                      const drCell = renderOpCell(
                        record.digitalReadLines,
                        ops.filter((u) => u.operation.includes("digitalRead")),
                      );
                      const dwCell = renderOpCell(
                        record.digitalWriteLines,
                        ops.filter((u) =>
                          u.operation.includes("digitalWrite"),
                        ),
                      );
                      const arCell = renderOpCell(
                        record.analogReadLines,
                        ops.filter((u) => u.operation.includes("analogRead")),
                      );
                      const awCell = renderOpCell(
                        record.analogWriteLines,
                        ops.filter((u) =>
                          u.operation.includes("analogWrite"),
                        ),
                      );

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

                          {/* pinMode Column – always shows mode name; conflict indicator if needed */}
                          <td
                            className={clsx(
                              "px-2 py-1 text-center",
                              hasConflict && "border-2 border-red-500",
                            )}
                          >
                            {pmModes.length > 0 ? (
                              <div className="space-y-0.5 text-center">
                                {uniqueModes.map((mode, i) => {
                                  const modeColor =
                                    mode === "INPUT"
                                      ? "text-blue-400"
                                      : mode === "OUTPUT"
                                        ? "text-orange-400"
                                        : "text-green-400";
                                  // In extended mode, also show line numbers per mode
                                  const modeLines = detailView
                                    ? record.pinModeLines?.filter(
                                        (_, li) =>
                                          record.pinModeModes?.[li] === mode,
                                      )
                                    : undefined;
                                  return (
                                    <div
                                      key={i}
                                      className="flex flex-col items-center"
                                    >
                                      <div className="flex items-center justify-center gap-1">
                                        <span className={modeColor}>
                                          {mode}
                                        </span>
                                        {hasConflict && (
                                          <span
                                            className="text-red-400 font-bold"
                                            title={record.conflictMessage}
                                          >
                                            !
                                          </span>
                                        )}
                                      </div>
                                      {modeLines && modeLines.length > 0 && (
                                        <div className="text-ui-xs text-blue-400">
                                          {modeLines.map((l) =>
                                            l === "runtime"
                                              ? "runtime"
                                              : `L${l}`,
                                          ).join(", ")}
                                        </div>
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
                            ) : (record.digitalReadLines?.length ?? 0) > 0 ||
                              (record.digitalWriteLines?.length ?? 0) > 0 ||
                              ops.some((u) =>
                                u.operation.includes("digitalRead") ||
                                u.operation.includes("digitalWrite"),
                              ) ? (
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
                          <td className="px-2 py-1 text-center">{drCell}</td>

                          {/* digitalWrite Column */}
                          <td className="px-2 py-1 text-center">{dwCell}</td>

                          {/* analogRead Column */}
                          <td className="px-2 py-1 text-center">{arCell}</td>

                          {/* analogWrite Column */}
                          <td className="px-2 py-1 text-center">{awCell}</td>
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
