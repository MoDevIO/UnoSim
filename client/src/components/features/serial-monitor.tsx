import { useRef, useEffect, useState, useCallback, useMemo, ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Trash2, Monitor } from "lucide-react";
import type { OutputLine } from "@shared/schema";

interface SerialMonitorProps {
  readonly output: OutputLine[];
  readonly isConnected: boolean;
  readonly isSimulationRunning: boolean;
  readonly onSendMessage: (message: string) => void;
  readonly onClear: () => void;
  readonly showMonitor?: boolean;
  readonly autoScrollEnabled?: boolean;
  readonly headerActions?: ReactNode;
  readonly showHeader?: boolean;
}

interface ProcessedLine {
  text: string;
  incomplete: boolean;
}

const ROW_HEIGHT = 20; // Exact line height in pixels (matches Monaco editor: 14px font + 20px line-height)
const OVERSCAN_COUNT = 10; // Extra lines above/below viewport for smooth scrolling
const ENABLE_VIRTUAL_SCROLL = true; // Feature flag for virtual scrolling
const ENABLE_RAF_BATCHING = typeof process !== 'undefined' && process.env.NODE_ENV !== 'test'; // Disable rAF in tests

// Simple ANSI escape code processor
// NOTE: Backspace (\b) is handled separately in applyBackspaceAcrossLines for cross-line support
function processAnsiCodes(text: string): string {
  let processed = text.replace(/\x1b\[2J/g, "").replace(/\u001b\[2J/g, "");
  processed = processed.replace(/\x1b\[H/g, "").replace(/\u001b\[H/g, "");
  // Remove common ANSI color sequences
  processed = processed
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\u001b\[[0-9;]*m/g, "");
  // Clear line CSI (ESC[K) - remove it
  processed = processed.replace(/\x1b\[K/g, "").replace(/\u001b\[K/g, "");

  // Backspace within the SAME chunk: apply locally
  // (Cross-chunk backspaces are handled in applyBackspaceAcrossLines)
  if (processed.includes("\b")) {
    let out = "";
    for (const ch of processed) {
      if (ch === "\b") {
        out = out.slice(0, -1);
      } else {
        out += ch;
      }
    }
    processed = out;
  }

  // Expand tabs to 4 spaces
  if (processed.includes("\t")) {
    processed = processed.replace(/\t/g, "    ");
  }

  // Bell character: replace with visible marker (so it's not silently dropped)
  if (processed.includes("\x07")) {
    processed = processed.replace(/\x07/g, "␇");
  }

  // Form feed and vertical tab => normalize to newline
  if (processed.includes("\f") || processed.includes("\v")) {
    processed = processed.replace(/\f/g, "\n").replace(/\v/g, "\n");
  }

  return processed;
}

// Exported for unit testing and reuse inside the hook
export function applyBackspaceAcrossLines(
  lines: Array<{ text: string; incomplete: boolean }>,
  text: string,
  isComplete: boolean,
): string | null {
  // Handle backspaces at the start of text
  if (text.includes("\b")) {
    // Count leading backspaces to remove from previous line
    let backspaceCount = 0;
    let idx = 0;
    while (idx < text.length && text[idx] === "\b") {
      backspaceCount++;
      idx++;
    }

    if (
      backspaceCount > 0 &&
      lines.length > 0 &&
      lines.at(-1)!.incomplete
    ) {
      const lastLine = lines.at(-1)!;
      lastLine.text = lastLine.text.slice(
        0,
        Math.max(0, lastLine.text.length - backspaceCount),
      );
      text = text.slice(backspaceCount);
    }
  }

  // If there's still text to process and we have an incomplete line, append to it
  if (text && lines.length > 0 && lines.at(-1)!.incomplete) {
    const cleanText = processAnsiCodes(text);
    if (cleanText) {
      lines.at(-1)!.text += cleanText;
      lines.at(-1)!.incomplete = !isComplete;
    }
    return null; // already handled
  }

  // No text left after backspace processing, or no incomplete line to append to
  if (!text) {
    return null;
  }

  // Text remains: caller should handle it (new line or other processing)
  return text;
}

function hasControlChars(text: string) {
  return {
    hasClearScreen: text.includes("\x1b[2J") || text.includes("\u001b[2J"),
    hasCursorHome: text.includes("\x1b[H") || text.includes("\u001b[H"),
    hasCarriageReturn: text.includes("\r"),
  };
}

export function SerialMonitor({
  output,
  isConnected,
  isSimulationRunning: _isSimulationRunning = false,
  onSendMessage: _onSendMessage,
  onClear: _onClear,
  showMonitor = true,
  autoScrollEnabled = true,
  headerActions,
  showHeader = true,
}: SerialMonitorProps) {
  void isConnected;
  const outputRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600); // Default height
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    // enable/disable autoscroll according to parent prop
    shouldAutoScrollRef.current = !!autoScrollEnabled;
  }, [autoScrollEnabled]);

  // Measure container height for virtual scrolling
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Check if ResizeObserver is available (not available in some test environments)
    if (globalThis.ResizeObserver === undefined) {
      setContainerHeight(600); // Fallback height for tests
      return;
    }
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Process output lines with rAF batching
  const processedLines = useMemo(() => {
    const lines: ProcessedLine[] = [];
    let shouldClear = false;

    output.forEach((line) => {
      let text = line.text;
      const controls = hasControlChars(text);

      if (controls.hasClearScreen) {
        shouldClear = true;
        lines.length = 0;
      }

      if (controls.hasCursorHome) {
        if (shouldClear) {
          lines.length = 0;
          shouldClear = false;
        }
      }

      // Handle backspace across line boundaries: apply to last incomplete line
      const backspaceResult = applyBackspaceAcrossLines(
        lines,
        text,
        line.complete ?? true,
      );
      if (backspaceResult === null) {
        return; // handled fully
      }
      text = backspaceResult;

      if (controls.hasCarriageReturn) {
        const parts = text.split("\r");
        const cleanParts = parts.map((p) => processAnsiCodes(p));
        if (cleanParts.length > 1) {
          const finalText = cleanParts.at(-1)!;
          if (lines.length > 0 && !lines.at(-1)!.incomplete) {
            lines.push({ text: finalText, incomplete: !line.complete });
          } else {
            if (lines.length > 0) {
              lines[lines.length - 1] = {
                text: finalText,
                incomplete: !line.complete,
              };
            } else {
              lines.push({ text: finalText, incomplete: !line.complete });
            }
          }
          return;
        }
      }

      const cleanText = processAnsiCodes(text);
      if (cleanText) {
        lines.push({ text: cleanText, incomplete: !line.complete });
      }
    });

    return lines;
  }, [output]);

  // Calculate visible range for virtual scrolling
  const { visibleLines, visibleStart, totalHeight, offsetY } = useMemo(() => {
    if (!ENABLE_VIRTUAL_SCROLL || processedLines.length < 100) {
      // Don't virtualize for small lists
      return {
        visibleLines: processedLines,
        visibleStart: 0,
        totalHeight: processedLines.length * ROW_HEIGHT,
        offsetY: 0,
      };
    }

    const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_COUNT);
    const visibleEnd = Math.min(
      processedLines.length,
      Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN_COUNT
    );

    return {
      visibleLines: processedLines.slice(visibleStart, visibleEnd),
      visibleStart,
      totalHeight: processedLines.length * ROW_HEIGHT,
      offsetY: visibleStart * ROW_HEIGHT,
    };
  }, [processedLines, scrollTop, containerHeight]);

  // Render visible lines with rAF batching (disabled in tests for synchronous rendering)
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;

    const renderContent = () => {
      el.innerHTML = "";

      if (processedLines.length === 0) {
        const placeholder = document.createElement("div");
        placeholder.className = "text-muted-foreground italic";
        placeholder.textContent = "Serial output will appear here...";
        el.appendChild(placeholder);
      } else if (ENABLE_VIRTUAL_SCROLL && processedLines.length >= 100) {
        // Virtual scrolling mode (only for large outputs)
        const viewport = document.createElement("div");
        viewport.style.height = `${totalHeight}px`;
        viewport.style.position = "relative";

        const content = document.createElement("div");
        content.style.transform = `translateY(${offsetY}px)`;
        content.style.willChange = "transform";

        visibleLines.forEach((ln) => {
          const div = document.createElement("div");
          div.className = "text-foreground whitespace-pre-wrap break-words";
          div.style.height = `${ROW_HEIGHT}px`;
          div.style.lineHeight = `${ROW_HEIGHT}px`;
          div.style.fontSize = "var(--fs-code-base)"; // Scales with global --ui-font-scale
          div.textContent = ln.text;
          content.appendChild(div);
        });

        viewport.appendChild(content);
        el.appendChild(viewport);
      } else {
        // Standard rendering mode (for small outputs or when virtualization disabled)
        processedLines.forEach((ln) => {
          const div = document.createElement("div");
          div.className = "text-foreground whitespace-pre-wrap break-words";
          div.style.fontSize = "var(--fs-code-base)"; // Scales with global --ui-font-scale
          div.style.lineHeight = "var(--lh-code-base)"; // Scales with global --ui-font-scale
          div.textContent = ln.text;
          el.appendChild(div);
        });
      }

      // Auto-scroll to bottom if enabled
      if (shouldAutoScrollRef.current && el) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
      }
    };

    // Use rAF batching in production, immediate rendering in tests
    if (ENABLE_RAF_BATCHING) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        renderContent();
        rafIdRef.current = null;
      });
    } else {
      renderContent();
    }
  }, [visibleLines, visibleStart, totalHeight, offsetY, processedLines]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;

    const currentScrollTop = el.scrollTop;
    setScrollTop(currentScrollTop); // Update scroll position for virtual scrolling

    const maxScrollTop = el.scrollHeight - el.clientHeight;

    if (currentScrollTop < lastScrollTopRef.current - 5) {
      shouldAutoScrollRef.current = false;
    }
    if (maxScrollTop - currentScrollTop < 20) {
      shouldAutoScrollRef.current = true;
    }
    lastScrollTopRef.current = currentScrollTop;
  }, []);

  return (
    <div className="h-full flex flex-col" data-testid="serial-monitor" ref={containerRef}>
      {/* Header - Consistent with other panel headers */}
      {showHeader && (
        <div className="flex items-center justify-between px-[var(--header-padding-x)] h-[var(--ui-header-height)] bg-muted border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground mr-1" strokeWidth={1.5} />
            <span className="font-semibold text-xs tracking-wide uppercase text-muted-foreground/80">Serial Monitor</span>
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <Button
              variant="ghost"
              size="sm"
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
              onClick={() => _onClear()}
              title="Clear serial output"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Content area - flex-1 for remaining space */}
      <div className="flex-1 min-h-0">
        {showMonitor ? (
          <ScrollArea
            className="h-full"
            viewportRef={outputRef}
            viewportTestId="serial-output"
            viewportProps={{ onScroll: handleScroll }}
            viewportClassName="p-3 font-mono"
            thumbClassName="bg-status-success"
          />
        ) : (
          <div className="h-full" />
        )}
      </div>
    </div>
  );
}
