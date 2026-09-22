import {
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Plus,
  Eye,
  EyeOff,
  ListFilter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ParserMessage, IOPinRecord } from "@shared/schema";
import { clsx } from "clsx";
import { useState } from "react";
import * as React from "react";
import type { SeverityLevel } from "@shared/reserved-names-validator";
import type { SourceLocation } from "@shared/source-project";
import {
  formatSourceNavigationTarget,
  isSourceLocation,
  isNavigableSourceTarget,
  type SourceNavigationTarget,
} from "@/types/source-navigation";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import { TabBar } from "@/components/ui/tab-bar";
import { getSeverityStatus, getStatusColor, getStatusTextClass } from "@/lib/status-semantics";

// Module-level constants (not re-created on every render)
const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
const ALL_PIN_RECORDS: IOPinRecord[] = Array.from({ length: 20 }, (_, pinId) => ({
  pin: pinId >= 14 ? `A${pinId - 14}` : String(pinId),
  pinId,
  defined: false,
  usedAt: [],
}));

function getPinId(record: IOPinRecord): number | undefined {
  if (record.pinId !== undefined) return record.pinId;
  if (/^\d+$/.test(record.pin)) return Number.parseInt(record.pin, 10);
  const analogMatch = /^A([0-5])$/.exec(record.pin);
  return analogMatch ? 14 + Number.parseInt(analogMatch[1], 10) : undefined;
}

// Module-level pure helpers — fix S6481 (no re-creation on render)
function getSeverityIcon(severity: SeverityLevel): JSX.Element {
  switch (severity) {
    case 1:
      return <Info className={`w-4 h-4 ${getStatusTextClass(getSeverityStatus(severity))}`} />;
    case 2:
      return <AlertTriangle className={`w-4 h-4 ${getStatusTextClass(getSeverityStatus(severity))}`} />;
    case 3:
      return <AlertCircle className={`w-4 h-4 ${getStatusTextClass(getSeverityStatus(severity))}`} />;
  }
}

function getSeverityLabel(severity: SeverityLevel): string {
  switch (severity) {
    case 1:
      return "Info";
    case 2:
      return "Warning";
    case 3:
      return "Error";
  }
}

function getSeverityColor(severity: SeverityLevel): string {
  return getStatusColor(getSeverityStatus(severity));
}

/** Returns an RX/TX badge element for pin 0/1, or null. Fixes S1940 IIFE anti-pattern. */
function getRxTxBadge(pin: string): JSX.Element | null {
  if (pin === "0") return <span className="text-blue-400 text-ui-xs font-semibold">RX</span>;
  if (pin === "1") return <span className="text-red-400 text-ui-xs font-semibold">TX</span>;
  return null;
}

/** Returns a PWM tilde element for PWM-capable pins, or null. Fixes S1940 IIFE anti-pattern. */
function getPwmTilde(pin: string): JSX.Element | null {
  const n = Number.parseInt(pin, 10);
  return !Number.isNaN(n) && PWM_PINS.has(n)
    ? <span className="text-yellow-400">~</span>
    : null;
}

// Module-level pure pin-operation helpers (fix S6481 — no useCallback needed)
function hasPinModeInfo(record: IOPinRecord): boolean {
  return record.defined ||
    (record.pinModeLines?.length ?? 0) > 0 ||
    (record.pinModeLocations?.length ?? 0) > 0;
}

function hasReadOperations(record: IOPinRecord): boolean {
  return (record.digitalReadLines?.length ?? 0) > 0 ||
    (record.digitalReadLocations?.length ?? 0) > 0 ||
    (record.analogReadLines?.length ?? 0) > 0 ||
    (record.analogReadLocations?.length ?? 0) > 0;
}

function hasWriteOperations(record: IOPinRecord): boolean {
  return (record.digitalWriteLines?.length ?? 0) > 0 ||
    (record.digitalWriteLocations?.length ?? 0) > 0 ||
    (record.analogWriteLines?.length ?? 0) > 0 ||
    (record.analogWriteLocations?.length ?? 0) > 0;
}

function isPinProgrammed(record: IOPinRecord): boolean {
  return (
    hasPinModeInfo(record) ||
    hasReadOperations(record) ||
    hasWriteOperations(record) ||
    (record.usedAt?.length ?? 0) > 0
  );
}

function getLocationButton(
  target: SourceNavigationTarget,
  onGoToLine?: (target: SourceNavigationTarget) => void,
): JSX.Element {
  const label = formatSourceNavigationTarget(target);
  const sourceLocation = isSourceLocation(target)
    ? {
        fileName: target.file.split(/[\\/]/).pop() || target.file,
        lineLabel: `:${target.line}`,
      }
    : null;
  const navigable = isNavigableSourceTarget(target);
  if (!navigable || !onGoToLine) {
    return (
      <span className={target === 0 ? "text-yellow-400 italic" : "text-blue-400"}>
        {target === 0 ? "runtime" : label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="inline-flex max-w-[10rem] overflow-hidden whitespace-nowrap align-bottom text-blue-400 underline decoration-dotted underline-offset-2 hover:text-foreground"
      aria-label={`Go to ${label}`}
      title={label}
      onClick={() => onGoToLine(target)}
    >
      {sourceLocation ? (
        <span className="inline-flex min-w-0 max-w-full items-baseline">
          <span className="min-w-0 truncate">{sourceLocation.fileName}</span>
          <span className="shrink-0">{sourceLocation.lineLabel}</span>
        </span>
      ) : (
        label
      )}
    </button>
  );
}

function getMessageNavigationTarget(
  message: ParserMessage,
): SourceNavigationTarget | undefined {
  if (message.line === undefined) return undefined;
  if (!message.file) return message.line;
  return { file: message.file, line: message.line, column: message.column };
}

// Helper to convert pin mode number to label
function getPinModeLabel(modeNum: number): string {
  switch (modeNum) {
    case 0:
      return "INPUT";
    case 1:
      return "OUTPUT";
    case 2:
      return "INPUT_PULLUP";
    default:
      return "UNKNOWN";
  }
}

/** Returns tailwind color class for a named pin mode string. Fixes S3358 (nested ternary). */
function getPinModeColor(mode: string): string {
  if (mode === "INPUT") return "text-blue-400";
  if (mode === "OUTPUT") return "text-orange-400";
  return "text-green-400";
}

/** Returns tailwind color class for a numeric pin mode value. Fixes S3358 (nested ternary). */
function getPinModeLegacyColor(pinMode: number): string {
  if (pinMode === 0) return "text-blue-400";
  if (pinMode === 1) return "text-orange-400";
  return "text-green-400";
}

/** Renders the pinMode cell with proper fallbacks. Module-level = no re-creation on render (fixes S6481). */
function renderPinModeCell(
  record: IOPinRecord,
  pmModes: string[],
  uniqueModes: string[],
  hasConflict: boolean,
  showDetail: boolean,
  ops: Array<{ operation: string }>,
  onGoToLine?: (target: SourceNavigationTarget) => void,
): JSX.Element {
  if (pmModes.length > 0) {
    return (
      <div className="space-y-0.5 text-center">
        {uniqueModes.map((mode) => {
          const modeColor = getPinModeColor(mode);
          const modeLines = showDetail
            ? record.pinModeLines?.filter(
                (_, li) => record.pinModeModes?.[li] === mode,
              )
            : undefined;
          const modeLocations = showDetail
            ? (record.pinModeLocations ?? []).filter((_, index) =>
                record.pinModeModes ? record.pinModeModes[index] === mode : true,
              )
            : [];
          let sourceDetails: JSX.Element | null = null;
          if (modeLocations.length > 0) {
            sourceDetails = (
              <div className="text-ui-xs space-x-1">
                {modeLocations.map((location, locationIndex) => (
                  <span key={`${location.file}:${location.line}:${locationIndex}`}>
                    {getLocationButton(location, onGoToLine)}
                  </span>
                ))}
              </div>
            );
          } else if (modeLines && modeLines.length > 0) {
            sourceDetails = (
              <div className="text-ui-xs text-blue-400">
                {modeLines.map((l) => (l === "runtime" ? "runtime" : `L${l}`)).join(", ")}
              </div>
            );
          }
          return (
            <div key={`mode-${mode}-${record.pin}`} className="flex flex-col items-center">
              <div className="flex items-center justify-center gap-1">
                <span className={modeColor}>{mode}</span>
                {hasConflict && (
                  <span className={`${getStatusTextClass("error")} font-bold`} title={record.conflictMessage}>!</span>
                )}
              </div>
              {sourceDetails}
            </div>
          );
        })}
      </div>
    );
  }
  if (record.defined && record.pinMode !== undefined) {
    const modeColor = getPinModeLegacyColor(record.pinMode);
    return (
      <div className="text-center">
        <span className={modeColor}>{getPinModeLabel(record.pinMode)}</span>
      </div>
    );
  }
  const hasDigitalOps = ops.some(
    (u) => u.operation.includes("digitalRead") || u.operation.includes("digitalWrite"),
  );
  if (
    (record.digitalReadLines?.length ?? 0) > 0 ||
    (record.digitalWriteLines?.length ?? 0) > 0 ||
    hasDigitalOps
  ) {
    return (
      <div className="flex items-center justify-center" title="pinMode() missing">
        <X className={`w-4 h-4 ${getStatusTextClass("error")}`} />
      </div>
    );
  }
  return <span className="text-gray-400">—</span>;
}

type ParserMessagesByCategory = Record<string, ParserMessage[]>;

function groupMessagesByCategory(messages: ParserMessage[]): ParserMessagesByCategory {
  return messages.reduce<ParserMessagesByCategory>((groups, message) => {
    const categoryMessages = groups[message.category] ?? [];
    categoryMessages.push(message);
    groups[message.category] = categoryMessages;
    return groups;
  }, {});
}

const CATEGORY_LABELS: Record<string, string> = {
  serial: "Serial Configuration",
  structure: "Code Structure",
  hardware: "Hardware Compatibility",
  pins: "Pin Conflicts",
  performance: "Performance Issues",
};

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function filterIoRegistry(
  ioRegistry: IOPinRecord[],
  showAllPins: boolean,
): IOPinRecord[] {
  if (!showAllPins) return ioRegistry.filter(isPinProgrammed);

  const pinsById = new Map(ALL_PIN_RECORDS.map((record) => [record.pinId, record]));
  for (const record of ioRegistry) {
    const pinId = getPinId(record);
    if (pinId !== undefined) pinsById.set(pinId, record);
  }
  return [...pinsById.values()];
}

interface ParserMessagesListProps {
  readonly messagesByCategory: ParserMessagesByCategory;
  readonly onGoToLine?: (target: SourceNavigationTarget) => void;
  readonly onInsertSuggestion?: (suggestion: string, line?: number) => void;
  readonly messagesContainerRef?: React.RefObject<HTMLDivElement>;
}

function ParserMessagesList({
  messagesByCategory,
  onGoToLine,
  onInsertSuggestion,
  messagesContainerRef,
}: ParserMessagesListProps) {
  return (
    <UnifiedScrollArea
      className="flex-1"
      orientation="both"
      viewportClassName="p-3 text-ui-xs space-y-2"
      viewportRef={messagesContainerRef}
      viewportTestId="parser-messages-container"
    >
      {Object.entries(messagesByCategory).map(([category, categoryMessages]) => (
        <div key={category} className="space-y-1">
          <div className="text-muted-foreground font-semibold uppercase tracking-wide text-ui-xs mb-1.5">
            {getCategoryLabel(category)}
          </div>
          {categoryMessages.map((message) => {
            const target = getMessageNavigationTarget(message);
            return (
              <div
                key={message.id}
                className="bg-muted/50 rounded border-l-2 transition-colors"
                style={{ borderLeftColor: getSeverityColor(message.severity) }}
              >
                <button
                  type="button"
                  className="parser-message-btn w-full text-left p-2 cursor-pointer hover:bg-muted/70 block"
                  tabIndex={isNavigableSourceTarget(target) ? 0 : -1}
                  onClick={() => {
                    if (isNavigableSourceTarget(target)) onGoToLine?.(target);
                  }}
                  onKeyDown={(event) => {
                    const isActivationKey = event.key === "Enter" || event.key === " ";
                    if (isActivationKey && isNavigableSourceTarget(target)) {
                      event.preventDefault();
                      onGoToLine?.(target);
                    }
                  }}
                >
                  <div className="flex items-start gap-2">
                    {getSeverityIcon(message.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground font-medium mb-1">
                        {message.message}
                      </div>
                      <div className="text-muted-foreground text-ui-xs space-x-2">
                        {message.line !== undefined && (
                          <span>{message.file ? `${message.file}:${message.line}` : `Line ${message.line}`}</span>
                        )}
                        {message.column !== undefined && message.column > 0 && (
                          <span>• Col {message.column}</span>
                        )}
                        <span>• {getSeverityLabel(message.severity)}</span>
                      </div>
                    </div>
                  </div>
                </button>
                {message.suggestion && (
                  <div className="ml-8 mr-2 mb-2 p-2 border border-muted-foreground/30 rounded bg-muted/30 flex items-start gap-2">
                    <div className="flex-1 min-w-0 text-muted-foreground text-ui-xs">
                      <span className="font-semibold">Suggestion:</span>{" "}
                      {message.suggestion}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onInsertSuggestion?.(message.suggestion ?? "", message.line)}
                      className="ml-3"
                      title="Insert suggestion"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </UnifiedScrollArea>
  );
}

type RegistryOperation = NonNullable<IOPinRecord["usedAt"]>[number];

interface RegistryOperationCellProps {
  readonly lines: Array<number | "runtime"> | undefined;
  readonly locations: SourceLocation[] | undefined;
  readonly legacyOperations: RegistryOperation[];
  readonly detailView: boolean;
  readonly onGoToLine?: (target: SourceNavigationTarget) => void;
}

function renderRegistryOperationCell({
  lines,
  locations,
  legacyOperations,
  detailView,
  onGoToLine,
}: RegistryOperationCellProps): JSX.Element {
  const hasNew = (lines?.length ?? 0) > 0 || (locations?.length ?? 0) > 0;
  const isUsed = hasNew || legacyOperations.length > 0;
  if (!isUsed) return <span className="text-gray-400">—</span>;
  if (!detailView) return <span className="text-green-500 font-bold">✓</span>;

  const sourceLocations = locations && locations.length > 0 ? locations : undefined;
  const visibleLines: Array<number | "runtime"> = hasNew
    ? lines!
    : legacyOperations.map((operation) =>
        operation.line > 0 ? operation.line : "runtime",
      );

  return (
    <div className="space-y-0.5 text-center">
      {sourceLocations
        ? sourceLocations.map((location, locationIndex) => (
            <div
              key={`${location.file}:${location.line}:${locationIndex}`}
              className="text-ui-xs"
            >
              {getLocationButton(location, onGoToLine)}
            </div>
          ))
        : visibleLines.map((line) => (
            <div key={`line-${line}`} className="text-ui-xs">
              {line === "runtime" ? (
                <span className="text-yellow-400 italic">runtime</span>
              ) : (
                <span className="text-blue-400">L{line}</span>
              )}
            </div>
          ))}
    </div>
  );
}

interface IoRegistryRowProps {
  readonly record: IOPinRecord;
  readonly index: number;
  readonly detailView: boolean;
  readonly onGoToLine?: (target: SourceNavigationTarget) => void;
}

function IoRegistryRow({ record, index, detailView, onGoToLine }: IoRegistryRowProps) {
  const operations = record.usedAt || [];
  const pinModes: string[] = record.pinModeModes ?? operations
    .filter((operation) => operation.operation.includes("pinMode"))
    .map((operation) => {
      const match = /pinMode:(\d+)/.exec(operation.operation);
      return getPinModeLabel(match ? Number.parseInt(match[1]) : -1);
    });
  const uniqueModes = [...new Set(pinModes)];
  const hasOutputMode = uniqueModes.includes("OUTPUT");
  const hasInputMode = uniqueModes.includes("INPUT") || uniqueModes.includes("INPUT_PULLUP");
  const hasRuntimeRead = operations.some(
    (operation) => operation.operation === "digitalRead" || operation.operation === "analogRead",
  );
  const hasRuntimeWrite = operations.some(
    (operation) => operation.operation === "digitalWrite" || operation.operation === "analogWrite",
  );
  const hasConflict = record.conflict ?? (
    uniqueModes.length > 1 ||
    (hasOutputMode && hasRuntimeRead) ||
    (hasInputMode && hasRuntimeWrite)
  );
  const digitalReadCell = renderRegistryOperationCell({
    lines: record.digitalReadLines,
    locations: record.digitalReadLocations,
    legacyOperations: operations.filter((operation) => operation.operation.includes("digitalRead")),
    detailView,
    onGoToLine,
  });
  const digitalWriteCell = renderRegistryOperationCell({
    lines: record.digitalWriteLines,
    locations: record.digitalWriteLocations,
    legacyOperations: operations.filter((operation) => operation.operation.includes("digitalWrite")),
    detailView,
    onGoToLine,
  });
  const analogReadCell = renderRegistryOperationCell({
    lines: record.analogReadLines,
    locations: record.analogReadLocations,
    legacyOperations: operations.filter((operation) => operation.operation.includes("analogRead")),
    detailView,
    onGoToLine,
  });
  const analogWriteCell = renderRegistryOperationCell({
    lines: record.analogWriteLines,
    locations: record.analogWriteLocations,
    legacyOperations: operations.filter((operation) => operation.operation.includes("analogWrite")),
    detailView,
    onGoToLine,
  });

  return (
    <tr
      className={`border-b border-muted-foreground/10 h-7 ${index % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
    >
      <td className="px-2 py-1 text-right font-mono font-semibold text-cyan-400">
        <div className="flex items-center justify-end gap-2">
          {getRxTxBadge(String(record.pin))}
          {getPwmTilde(String(record.pin))}
          <span>{record.pin}</span>
        </div>
      </td>
      <td className={clsx("px-2 py-1 text-center", hasConflict && "border-2 border-red-500")}>
        {renderPinModeCell(
          record,
          pinModes,
          uniqueModes,
          hasConflict,
          detailView,
          operations,
          onGoToLine,
        )}
      </td>
      <td className="px-2 py-1 text-center">{digitalReadCell}</td>
      <td className="px-2 py-1 text-center">{digitalWriteCell}</td>
      <td className="px-2 py-1 text-center">{analogReadCell}</td>
      <td className="px-2 py-1 text-center">{analogWriteCell}</td>
    </tr>
  );
}

interface IoRegistryBodyProps {
  readonly filteredRegistry: IOPinRecord[];
  readonly showAllPins: boolean;
  readonly setShowAllPins: (show: boolean) => void;
  readonly detailView: boolean;
  readonly onGoToLine?: (target: SourceNavigationTarget) => void;
}

function IoRegistryBody({
  filteredRegistry,
  showAllPins,
  setShowAllPins,
  detailView,
  onGoToLine,
}: IoRegistryBodyProps) {
  if (filteredRegistry.length === 0 && showAllPins) {
    return <div className="text-muted-foreground p-4 text-center text-ui-xs">No pins available</div>;
  }
  if (filteredRegistry.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-center text-ui-xs">
        <div className="space-y-2">
          <p>No pins statically detected</p>
          <p>Dynamically configured pins will appear during simulation.</p>
          <Button
            variant="link"
            size="sm"
            onClick={() => setShowAllPins(true)}
            className="h-auto p-0 text-ui-xs text-blue-400"
          >
            Show all pins →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <table
        className={clsx(
          "w-full table-fixed text-ui-xs border-collapse",
          detailView ? "min-w-[60rem]" : "min-w-[36rem]",
        )}
      >
        <colgroup>
          <col className={detailView ? "w-[4rem]" : "w-[3rem]"} />
          <col className={detailView ? "w-[10rem]" : "w-[7rem]"} />
          <col className={detailView ? "w-[10rem]" : "w-[5.5rem]"} />
          <col className={detailView ? "w-[10rem]" : "w-[5.5rem]"} />
          <col className={detailView ? "w-[10rem]" : "w-[5.5rem]"} />
          <col className={detailView ? "w-[10rem]" : "w-[5.5rem]"} />
        </colgroup>
        <thead>
          <tr className="sticky top-0 z-40 border-b border-muted-foreground/30 bg-muted">
            <th className="px-2 py-1 text-right font-semibold text-foreground">Pin</th>
            <th className="px-2 py-1 text-center font-semibold text-foreground">pinMode</th>
            <th className="px-2 py-1 text-center font-semibold text-foreground">digitalRead</th>
            <th className="px-2 py-1 text-center font-semibold text-foreground">digitalWrite</th>
            <th className="px-2 py-1 text-center font-semibold text-foreground">analogRead</th>
            <th className="px-2 py-1 text-center font-semibold text-foreground">analogWrite</th>
          </tr>
        </thead>
        <tbody>
          {filteredRegistry.map((record, index) => (
            <IoRegistryRow
              key={record.pin}
              record={record}
              index={index}
              detailView={detailView}
              onGoToLine={onGoToLine}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ParserOutputProps {
  readonly messages: ParserMessage[];
  readonly ioRegistry?: IOPinRecord[];
  readonly onClear: () => void;
  readonly onGoToLine?: (target: SourceNavigationTarget) => void;
  readonly onInsertSuggestion?: (suggestion: string, line?: number) => void;
  readonly hideHeader?: boolean;
  readonly defaultTab?: "messages" | "registry";
  readonly messagesContainerRef?: React.RefObject<HTMLDivElement>;
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

  // Do NOT auto-switch tabs - let user control which tab they want to see
  // Previously this auto-switched to registry when no messages, but that was confusing

  const messagesByCategory = React.useMemo(
    () => groupMessagesByCategory(messages),
    [messages],
  );

  // Filter pins: show only programmed pins by default, all pins if showAllPins is true
  const filteredRegistry = React.useMemo(
    () => filterIoRegistry(ioRegistry, showAllPins),
    [ioRegistry, showAllPins],
  );

  // Count of programmed pins (pins with any operation)
  const totalProgrammedPins = React.useMemo(
    () => ioRegistry.filter(isPinProgrammed).length,
    [ioRegistry],
  );

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
          <div className="bg-muted px-[var(--header-padding-x)] border-b border-border flex items-center h-[var(--ui-header-height)] overflow-hidden">
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
            <TabBar asChild className="bg-transparent h-auto ml-4 p-0 gap-1">
              <TabsList>
                <TabsTrigger
                  value="messages"
                  className="data-[state=inactive]:text-muted-foreground"
                >
                  Messages {messages.length > 0 && `(${messages.length})`}
                </TabsTrigger>
                <TabsTrigger
                  value="registry"
                  className="data-[state=inactive]:text-muted-foreground"
                >
                  I/O Registry{" "}
                  {(showAllPins ? ioRegistry.length : totalProgrammedPins) >
                    0 &&
                    `(${showAllPins ? ioRegistry.length : totalProgrammedPins})`}
                </TabsTrigger>
              </TabsList>
            </TabBar>
            <div className="flex items-center gap-3 ml-4 text-ui-sm">
              {totalErrors > 0 && (
                <span className="flex items-center gap-1">
                  <AlertCircle className={`w-3.5 h-3.5 ${getStatusTextClass("error")}`} />
                  <span className={getStatusTextClass("error")}>{totalErrors}</span>
                </span>
              )}
              {totalWarnings > 0 && (
                <span className="flex items-center gap-1">
                  <AlertTriangle className={`w-3.5 h-3.5 ${getStatusTextClass("warning")}`} />
                  <span className={getStatusTextClass("warning")}>{totalWarnings}</span>
                </span>
              )}
              {totalInfos > 0 && (
                <span className="flex items-center gap-1">
                  <Info className={`w-3.5 h-3.5 ${getStatusTextClass("info")}`} />
                  <span className={getStatusTextClass("info")}>{totalInfos}</span>
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0" />
            <Button
              variant="outline"
              size="icon"
              onClick={onClear}
              className="ml-2"
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
          {messages.length === 0 ? (
            <div className="text-muted-foreground p-4 text-center text-ui-xs">
              No parser messages
            </div>
          ) : (
            <ParserMessagesList
              messagesByCategory={messagesByCategory}
              onGoToLine={onGoToLine}
              onInsertSuggestion={onInsertSuggestion}
              messagesContainerRef={messagesContainerRef}
            />
          )}
        </TabsContent>

        {/* I/O Registry Tab */}
        <TabsContent
          value="registry"
          className="flex-1 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden"
        >
          {/* Toggle Button for Pin Visibility */}
          <div className="panel-content-header sticky top-0 bg-muted/50 border-b border-muted-foreground/30 px-3 justify-between z-10">
            <span className="text-ui-xs text-muted-foreground">
              {showAllPins
                ? `All pins (${filteredRegistry.length})`
                : `Programmed pins (${totalProgrammedPins})`}
            </span>
            <div className="flex items-center gap-1">
              <ToolbarIconButton
                icon={<ListFilter className="h-3.5 w-3.5" />}
                label={showAllPins ? "Show programmed pins" : "Show all pins"}
                onClick={() => setShowAllPins(!showAllPins)}
                aria-pressed={showAllPins}
              />
              {/* Eye button: compact (✓/—) vs extended (line numbers) – SSOT eye-mode */}
              <ToolbarIconButton
                icon={detailView ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                label={detailView ? "Hide source locations" : "Show source locations"}
                onClick={() => setDetailView(!detailView)}
                data-testid="io-registry-detail-toggle"
              />
            </div>
          </div>

          <UnifiedScrollArea
            className="flex-1"
            orientation="both"
            scrollbarVisibility="always"
          >
            <IoRegistryBody
              filteredRegistry={filteredRegistry}
              showAllPins={showAllPins}
              setShowAllPins={setShowAllPins}
              detailView={detailView}
              onGoToLine={onGoToLine}
            />
          </UnifiedScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
