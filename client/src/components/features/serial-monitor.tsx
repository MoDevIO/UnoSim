import { useRef, useEffect } from 'react';
import type { OutputLine } from '@shared/schema';

interface SerialMonitorProps {
  output: OutputLine[];
  isConnected: boolean;
  isSimulationRunning: boolean;
  onSendMessage: (message: string) => void;
  onClear: () => void;
  showMonitor?: boolean;
  autoScrollEnabled?: boolean;
}

// Simple ANSI escape code processor
// NOTE: Backspace (\b) is handled separately in applyBackspaceAcrossLines for cross-line support
function processAnsiCodes(text: string): string {
  let processed = text.replace(/\x1b\[2J/g, '').replace(/\u001b\[2J/g, '');
  processed = processed.replace(/\x1b\[H/g, '').replace(/\u001b\[H/g, '');
  // Remove common ANSI color sequences
  processed = processed.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');
  // Clear line CSI (ESC[K) - remove it
  processed = processed.replace(/\x1b\[K/g, '').replace(/\u001b\[K/g, '');

  // Backspace within the SAME chunk: apply locally
  // (Cross-chunk backspaces are handled in applyBackspaceAcrossLines)
  if (processed.includes('\b')) {
    let out = '';
    for (const ch of processed) {
      if (ch === '\b') {
        out = out.slice(0, -1);
      } else {
        out += ch;
      }
    }
    processed = out;
  }

  // Expand tabs to 4 spaces
  if (processed.includes('\t')) {
    processed = processed.replace(/\t/g, '    ');
  }

  // Bell character: replace with visible marker (so it's not silently dropped)
  if (processed.includes('\x07')) {
    processed = processed.replace(/\x07/g, '␇');
  }

  // Form feed and vertical tab => normalize to newline
  if (processed.includes('\f') || processed.includes('\v')) {
    processed = processed.replace(/\f/g, '\n').replace(/\v/g, '\n');
  }

  return processed;
}

// Exported for unit testing and reuse inside the hook
export function applyBackspaceAcrossLines(
  lines: Array<{ text: string; incomplete: boolean }>,
  text: string,
  isComplete: boolean
): string | null {
  // Handle backspaces at the start of text
  if (text.includes('\b')) {
    // Count leading backspaces to remove from previous line
    let backspaceCount = 0;
    let idx = 0;
    while (idx < text.length && text[idx] === '\b') {
      backspaceCount++;
      idx++;
    }

    if (backspaceCount > 0 && lines.length > 0 && lines[lines.length - 1].incomplete) {
      const lastLine = lines[lines.length - 1];
      lastLine.text = lastLine.text.slice(0, Math.max(0, lastLine.text.length - backspaceCount));
      text = text.slice(backspaceCount);
    }
  }

  // If there's still text to process and we have an incomplete line, append to it
  if (text && lines.length > 0 && lines[lines.length - 1].incomplete) {
    const cleanText = processAnsiCodes(text);
    if (cleanText) {
      lines[lines.length - 1].text += cleanText;
      lines[lines.length - 1].incomplete = !isComplete;
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
    hasClearScreen: text.includes('\x1b[2J') || text.includes('\u001b[2J'),
    hasCursorHome: text.includes('\x1b[H') || text.includes('\u001b[H'),
    hasCarriageReturn: text.includes('\r')
  };
}

export function SerialMonitor({
  output,
  isConnected,
  isSimulationRunning: _isSimulationRunning = false,
  onSendMessage: _onSendMessage,
  onClear: _onClear,
  showMonitor = true,
  autoScrollEnabled = true
}: SerialMonitorProps) {
  void isConnected;
  const outputRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    // enable/disable autoscroll according to parent prop
    shouldAutoScrollRef.current = !!autoScrollEnabled;
  }, [autoScrollEnabled]);

  useEffect(() => {
    const lines: Array<{ text: string; incomplete: boolean }> = [];
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
      const backspaceResult = applyBackspaceAcrossLines(lines, text, line.complete ?? true);
      if (backspaceResult === null) {
        return; // handled fully
      }
      text = backspaceResult;

      if (controls.hasCarriageReturn) {
        const parts = text.split('\r');
        const cleanParts = parts.map((p) => processAnsiCodes(p));
        if (cleanParts.length > 1) {
          const finalText = cleanParts[cleanParts.length - 1];
          if (lines.length > 0 && !lines[lines.length - 1].incomplete) {
            lines.push({ text: finalText, incomplete: !line.complete });
          } else {
            if (lines.length > 0) {
              lines[lines.length - 1] = { text: finalText, incomplete: !line.complete };
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

    const el = outputRef.current;
    if (!el) return;
    el.innerHTML = '';
    if (lines.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'text-muted-foreground italic';
      placeholder.textContent = 'Serial output will appear here...';
      el.appendChild(placeholder);
    } else {
      lines.forEach((ln) => {
        const div = document.createElement('div');
        div.className = 'text-foreground whitespace-pre-wrap break-words';
        div.textContent = ln.text;
        el.appendChild(div);
      });
    }

    if (shouldAutoScrollRef.current && el) {
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    }
  }, [output]);

  const handleScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const maxScrollTop = el.scrollHeight - el.clientHeight;

    if (currentScrollTop < lastScrollTopRef.current - 5) {
      shouldAutoScrollRef.current = false;
    }
    if (maxScrollTop - currentScrollTop < 20) {
      shouldAutoScrollRef.current = true;
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  return (
    <div className="h-full flex flex-col" data-testid="serial-monitor">
      <div className="flex-1 min-h-0">
        {showMonitor ? (
          <div ref={outputRef} className="h-full overflow-auto custom-scrollbar p-3 text-xs font-mono" data-testid="serial-output" onScroll={handleScroll} />
        ) : (
          <div className="h-full" />
        )}
      </div>
    </div>
  );
}
