import { LayoutGrid, Table, Copy, Trash2 } from "lucide-react";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";
import type { DebugOutputProps } from "./debug-output";

/** Readable, functional loading view; the full Debug UI loads only when its tab opens. */
export function BasicDebugOutput({ debugMessages, debugMessageFilter, setDebugMessageFilter, debugViewMode, setDebugViewMode, debugMessagesContainerRef, onCopyDebugMessages, onClearDebugMessages, enhancementPending = false }: DebugOutputProps & { enhancementPending?: boolean }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="panel-content-header justify-between gap-2 border-b px-3">
      <select aria-label="Message type" value={debugMessageFilter} onChange={(event) => setDebugMessageFilter(event.target.value.toLowerCase())} className="min-w-0 max-w-xs flex-1 rounded border bg-background px-2 py-1 text-ui-xs text-foreground">
        <option value="">All Types</option>{Array.from(new Set(debugMessages.map((message) => message.type))).sort((a, b) => a.localeCompare(b)).map((type) => <option key={type} value={type.toLowerCase()}>{type}</option>)}
      </select>
      <div className="flex shrink-0 items-center gap-2">
        <ToolbarIconButton icon={debugViewMode === "table" ? <LayoutGrid /> : <Table />} label={debugViewMode === "table" ? "Switch to tiles view" : "Switch to table view"} onClick={() => setDebugViewMode(debugViewMode === "table" ? "tiles" : "table")} />
        <ToolbarIconButton icon={<Copy />} label="Copy debug messages" onClick={() => onCopyDebugMessages()} disabled={enhancementPending} />
        <ToolbarIconButton icon={<Trash2 />} label="Clear debug messages" onClick={onClearDebugMessages} />
      </div>
    </div>
    <output className="px-3 py-1 text-ui-xs text-muted-foreground">Loading debug view…</output>
    <UnifiedScrollArea className="min-h-0 flex-1" orientation="vertical" viewportRef={debugMessagesContainerRef}>
      <span />
    </UnifiedScrollArea>
  </div>;
}
