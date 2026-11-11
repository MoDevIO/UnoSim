import type { RefObject } from "react";
import { Copy, LayoutGrid, Table, Trash2 } from "lucide-react";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import type { DebugMessage } from "@/hooks/use-debug-console";
import { debugMessageContent, decodeDebugFilter, filterDebugMessages, formatDebugMessages, tutorMessageDetails, type DebugFilter } from "@/lib/debug-messages";
import { DEBUG_FIELD_CLASS, DEBUG_PROTOCOL_CLASS, DEBUG_SENDER_BADGE_CLASS, DEBUG_SENDER_TEXT_CLASS } from "@/lib/data-colors";
import { getStatusTextClass } from "@/lib/status-semantics";
import { TutorReviewPanel } from "@/components/features/tutor-review-panel";
import { TUTOR_DIAGNOSTIC_OUTCOMES, TUTOR_DIAGNOSTIC_STAGES } from "@shared/tutor-diagnostic-vocabulary";

export interface DebugOutputProps {
  debugMessages: DebugMessage[];
  debugMessageFilter: string;
  setDebugMessageFilter: (value: string) => void;
  debugViewMode: "table" | "tiles";
  setDebugViewMode: (value: "table" | "tiles") => void;
  debugMessagesContainerRef: RefObject<HTMLDivElement>;
  onCopyDebugMessages: (text?: string, count?: number) => void;
  onClearDebugMessages: () => void;
  debugDroppedCount?: number;
}

function diagnosticStatus(outcome: string | undefined): "error" | "warning" | "info" {
  if (outcome === "failed") return "error";
  if (outcome === "rejected" || outcome === "discarded") return "warning";
  return "info";
}

function MessageContent({ message }: { readonly message: DebugMessage }) {
  const details = tutorMessageDetails(message);
  const content = debugMessageContent(message);
  const status = diagnosticStatus(details?.outcome);
  if (!details) return <span className="whitespace-pre-wrap break-words">{content}</span>;
  return <div className="min-w-0 break-words">
    <span className={getStatusTextClass(status)}>{content}</span>
    <span className="block text-muted-foreground">{details.operation} · {details.requestId}</span>
    <details className="mt-1"><summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring">Details</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-foreground"><code>{JSON.stringify(details, null, 2)}</code></pre></details>
  </div>;
}

export function DebugOutput(props: Readonly<DebugOutputProps>) {
  const { debugMessages, debugMessageFilter, setDebugMessageFilter, debugViewMode, setDebugViewMode, debugMessagesContainerRef, onCopyDebugMessages, onClearDebugMessages, debugDroppedCount = 0 } = props;
  const filter = decodeDebugFilter(debugMessageFilter);
  const change = (update: DebugFilter) => {
    const next = Object.fromEntries(Object.entries({ ...filter, ...update }).filter(([, value]) => value));
    setDebugMessageFilter(Object.keys(next).every((key) => key === "type") ? next.type?.toLowerCase() ?? "" : JSON.stringify(next));
  };
  const hasTutor = debugMessages.some((message) => message.category === "tutor") || filter.category === "tutor";
  const filtered = filterDebugMessages(debugMessages, debugMessageFilter);
  const shown = filtered.slice(debugViewMode === "table" ? -100 : -50);
  const selectClass = "min-w-0 rounded border bg-background px-2 py-1 text-ui-xs text-foreground";
  const types = Array.from(new Set(debugMessages.map((message) => message.type))).sort((a, b) => a.localeCompare(b));
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="panel-content-header flex-wrap justify-between gap-2 border-b px-3 py-2" style={{ height: "auto" }}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {hasTutor && <label className="text-ui-xs text-muted-foreground">Category <select aria-label="Category" className={selectClass} value={filter.category ?? ""} onChange={(event) => change({ category: event.target.value, stage: "", outcome: "", reason: "" })}><option value="">All messages</option><option value="tutor">Tutor</option></select></label>}
        <label className="text-ui-xs text-muted-foreground">Type <select aria-label="Message type" className={selectClass} value={filter.type ?? ""} onChange={(event) => change({ type: event.target.value })}><option value="">All Types</option>{types.map((type) => <option key={type} value={type.toLowerCase()}>{type}</option>)}</select></label>
        <input aria-label="Search debug messages" placeholder="Search / request ID" className={`${selectClass} w-44 max-w-full`} maxLength={128} value={filter.query ?? ""} onChange={(event) => change({ query: event.target.value })} />
        {filter.category === "tutor" && <>
          <select aria-label="Processing stage" className={selectClass} value={filter.stage ?? ""} onChange={(event) => change({ stage: event.target.value })}><option value="">All stages</option>{TUTOR_DIAGNOSTIC_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select>
          <select aria-label="Processing outcome" className={selectClass} value={filter.outcome ?? ""} onChange={(event) => change({ outcome: event.target.value })}><option value="">All outcomes</option>{TUTOR_DIAGNOSTIC_OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select>
          <select aria-label="Processing reason" className={selectClass} value={filter.reason ?? ""} onChange={(event) => change({ reason: event.target.value })}><option value="">All reasons</option>{Array.from(new Set(debugMessages.flatMap((message) => { const reason = tutorMessageDetails(message)?.reason; return reason ? [reason] : []; }))).sort((a, b) => a.localeCompare(b)).map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select>
        </>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ToolbarIconButton icon={debugViewMode === "table" ? <LayoutGrid /> : <Table />} label={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"} onClick={() => setDebugViewMode(debugViewMode === "table" ? "tiles" : "table")} />
        <ToolbarIconButton icon={<Copy />} label="Copy debug messages" onClick={() => onCopyDebugMessages(formatDebugMessages(filtered), filtered.length)} />
        <ToolbarIconButton icon={<Trash2 />} label="Clear debug messages" onClick={onClearDebugMessages} />
      </div>
    </div>
    <output className="block shrink-0 border-b px-3 py-1 text-ui-xs text-muted-foreground">{shown.length} of {filtered.length} matching messages shown; {filtered.length} available to copy.{debugDroppedCount > 0 ? ` ${debugDroppedCount} older messages removed (buffer limit).` : ""}</output>
    <UnifiedScrollArea className="min-h-0 flex-1" orientation="vertical" viewportRef={debugMessagesContainerRef}>
      {/* Inside the scroll area, so the review never covers the technical messages below it. */}
      {filter.category === "tutor" && <TutorReviewPanel />}
      {debugViewMode === "table" ? <table className="w-full border-collapse text-ui-xs">
        <thead><tr className="sticky top-0 z-40 border-b bg-muted">{["Time", "Sender", "Protocol", "Type", "Content"].map((label) => <th key={label} className="border-r px-2 py-1 text-left font-semibold text-muted-foreground">{label}</th>)}</tr></thead>
        <tbody>{shown.map((message) => <tr key={message.id} className="border-b align-top">
          <td className={`whitespace-nowrap border-r px-2 py-1 font-mono ${DEBUG_FIELD_CLASS.timestamp}`}>{message.timestamp.toLocaleTimeString()}</td>
          <td className={`border-r px-2 py-1 ${DEBUG_SENDER_TEXT_CLASS[message.sender] ?? "text-foreground"}`}>{message.sender.toUpperCase()}</td>
          <td className={`border-r px-2 py-1 ${message.protocol ? DEBUG_PROTOCOL_CLASS[message.protocol] ?? "text-muted-foreground" : "text-muted-foreground"}`}>{message.protocol?.toUpperCase() ?? "?"}</td>
          <td className={`border-r px-2 py-1 font-mono ${DEBUG_FIELD_CLASS.type}`}>{message.type}</td>
          <td className="max-w-md px-2 py-1 font-mono text-foreground"><MessageContent message={message} /></td>
        </tr>)}{shown.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">{debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}</td></tr>}</tbody>
      </table> : <div className="space-y-3 p-3">{shown.map((message) => <div key={message.id} className="rounded border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-ui-xs"><span className={`rounded px-2 py-0.5 font-semibold ${DEBUG_SENDER_BADGE_CLASS[message.sender] ?? "text-foreground"}`}>{message.sender.toUpperCase()}</span><span className={`${DEBUG_FIELD_CLASS.typeBadge} break-words font-mono`}>{message.type}</span><span className={DEBUG_FIELD_CLASS.timestamp}>{message.timestamp.toLocaleTimeString()}</span></div>
        <div className="font-mono text-ui-xs text-foreground"><MessageContent message={message} /></div>
      </div>)}{shown.length === 0 && <div className="py-8 text-center text-ui-xs text-muted-foreground">{debugMessages.length === 0 ? "No messages yet" : "No messages match filter"}</div>}</div>}
    </UnifiedScrollArea>
  </div>;
}
