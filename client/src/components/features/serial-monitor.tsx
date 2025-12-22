import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Zap, ChevronsDown } from 'lucide-react';

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
}

// Simple ANSI escape code processor
function processAnsiCodes(text: string): string {
  // Remove clear screen codes (both hex \x1b and unicode \u001b notation)
  let processed = text.replace(/\x1b\[2J/g, '').replace(/\u001b\[2J/g, '');
  // Remove cursor home codes
  processed = processed.replace(/\x1b\[H/g, '').replace(/\u001b\[H/g, '');
  // Remove other common ANSI codes (optional) - color codes etc
  processed = processed.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');
  return processed;
}

// Check if text contains special control characters
function hasControlChars(text: string): { hasClearScreen: boolean; hasCursorHome: boolean; hasCarriageReturn: boolean } {
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
  onClear
}: SerialMonitorProps) {
  // mark possibly-unused prop as intentionally read to satisfy TS noUnusedLocals
  void isConnected;
  const [inputValue, setInputValue] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [terminalLines, setTerminalLines] = useState<Array<{text: string, incomplete: boolean}>>([]);
  const lastScrollTopRef = useRef(0);

  // Reset auto-scroll when output is cleared
  useEffect(() => {
    if (output.length === 0) {
      shouldAutoScrollRef.current = true;
      setAutoScrollEnabled(true);
    }
  }, [output.length]);

  // Process output with ANSI interpretation
  useEffect(() => {
    const lines: Array<{text: string, incomplete: boolean}> = [];
    let shouldClear = false;

    output.forEach((line) => {
      const text = line.text;
      const controls = hasControlChars(text);
      
      // Check for clear screen ANSI codes
      if (controls.hasClearScreen) {
        shouldClear = true;
        lines.length = 0; // Clear all lines
      }
      
      // Check for cursor home - also clear (common pattern)
      if (controls.hasCursorHome) {
        if (shouldClear) {
          lines.length = 0; // Clear confirmed
          shouldClear = false;
        }
      }

      // Check for carriage return - overwrites current line
      if (controls.hasCarriageReturn) {
        // Split by \r to handle multiple carriage returns
        const parts = text.split('\r');
        const cleanParts = parts.map(p => processAnsiCodes(p));
        
        // The last part after \r overwrites the current line
        if (cleanParts.length > 1) {
          const finalText = cleanParts[cleanParts.length - 1];
          if (lines.length > 0 && !lines[lines.length - 1].incomplete) {
            // If last line is complete, this starts a new line
            lines.push({
              text: finalText,
              incomplete: !line.complete
            });
          } else {
            // Overwrite the last line
            if (lines.length > 0) {
              lines[lines.length - 1] = {
                text: finalText,
                incomplete: !line.complete
              };
            } else {
              lines.push({
                text: finalText,
                incomplete: !line.complete
              });
            }
          }
          return;
        }
      }

      // Process the text (remove ANSI codes) and add to lines
      const cleanText = processAnsiCodes(text);
      
      if (cleanText) {
        // Simply map each output line to a terminal line
        lines.push({
          text: cleanText,
          incomplete: !line.complete
        });
      }
    });

    setTerminalLines(lines);
  }, [output]);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    
    if (shouldAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    }
  }, [terminalLines]);

  const handleScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    
    const currentScrollTop = el.scrollTop;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    
    // User scrolled up manually
    if (currentScrollTop < lastScrollTopRef.current - 5) {
      shouldAutoScrollRef.current = false;
      setAutoScrollEnabled(false);
    }
    
    // User scrolled to bottom (within 20px tolerance)
    if (maxScrollTop - currentScrollTop < 20) {
      shouldAutoScrollRef.current = true;
      setAutoScrollEnabled(true);
    }
    
    lastScrollTopRef.current = currentScrollTop;
  };

  const toggleAutoScroll = () => {
    const newValue = !autoScrollEnabled;
    setAutoScrollEnabled(newValue);
    shouldAutoScrollRef.current = newValue;
    
    // If enabling, scroll to bottom immediately
    if (newValue && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      lastScrollTopRef.current = outputRef.current.scrollTop;
    }
  };

  const handleSend = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="serial-monitor">
      <div className="bg-muted px-4 border-b border-border flex items-center h-10">
        <div className="flex items-center w-full">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div
              className={`w-2 h-2 rounded-full ${isSimulationRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`}
              style={{
                boxShadow: isSimulationRunning ? '0 0 8px rgba(34, 197, 94, 0.8)' : 'none',
                transition: 'box-shadow 200ms ease-in-out'
              }}
              data-testid="connection-indicator"
            />
            <i className="fas fa-comments text-accent text-sm"></i>
            <span className="text-sm font-medium">Serial Monitor</span>
            <span className="text-xs text-muted-foreground">115200 baud</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAutoScroll}
              className={autoScrollEnabled ? 'text-green-500 hover:text-green-500' : 'text-muted-foreground'}
              title={autoScrollEnabled ? 'Auto-Scroll aktiv' : 'Auto-Scroll deaktiviert'}
              data-testid="button-toggle-autoscroll"
            >
              <ChevronsDown className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              data-testid="button-clear-serial"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <div
        ref={outputRef}
        className="flex-1 overflow-auto custom-scrollbar min-h-0"
        data-testid="serial-output"
        onScroll={handleScroll}
      >
        <div className="console-output p-3 text-xs font-mono">
          {terminalLines.length === 0 ? (
            <div className="text-muted-foreground italic">
              Serial output will appear here...
            </div>
          ) : (
            <div className="space-y-0">
              {terminalLines.map((line, index) => (
                <div 
                  key={`term-line-${index}`} 
                  className="text-foreground whitespace-pre-wrap break-words"
                >
                  {line.text}
                  {line.incomplete && (
                    <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-1" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-3 flex-shrink-0">
        <div className="flex space-x-2 items-center">
          <Input
            type="text"
            placeholder="Send to Arduino..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-input border-border text-foreground placeholder-muted-foreground h-9"
            data-testid="input-serial"
          />

          <Button
            onClick={handleSend}
            size="sm"
            disabled={!inputValue.trim() || !isSimulationRunning}
            className={`w-40 h-9 ${!inputValue.trim() || !isSimulationRunning ? '' : '!bg-green-600 hover:!bg-green-700 !text-white'}`}
            data-testid="button-send-serial"
          >
            <Zap className="h-3 w-3 mr-1" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}