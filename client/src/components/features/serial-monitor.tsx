import { useRef, useEffect } from 'react';

interface OutputLine {
  text: string;
  complete: boolean;
}

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
function processAnsiCodes(text: string): string {
  let processed = text.replace(/\x1b\[2J/g, '').replace(/\u001b\[2J/g, '');
  processed = processed.replace(/\x1b\[H/g, '').replace(/\u001b\[H/g, '');
  processed = processed.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');
  return processed;
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
  isSimulationRunning = false,
  onSendMessage,
  onClear,
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
      const text = line.text;
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
