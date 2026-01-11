import { AlertCircle, AlertTriangle, Info, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ParserMessage } from '@shared/schema';
import { clsx } from 'clsx';

interface ParserOutputProps {
  messages: ParserMessage[];
  onClear: () => void;
  onGoToLine?: (line: number) => void;
  onInsertSuggestion?: (suggestion: string, line?: number) => void;
}

export function ParserOutput({ messages, onClear, onGoToLine, onInsertSuggestion }: ParserOutputProps) {
  if (messages.length === 0) {
    return null;
  }

  // Group messages by category for better organization
  const messagesByCategory = messages.reduce(
    (acc, msg) => {
      if (!acc[msg.category]) {
        acc[msg.category] = [];
      }
      acc[msg.category].push(msg);
      return acc;
    },
    {} as Record<string, ParserMessage[]>
  );

  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      serial: 'Serial Configuration',
      structure: 'Code Structure',
      hardware: 'Hardware Compatibility',
      pins: 'Pin Conflicts',
      performance: 'Performance Issues',
    };
    return labels[category] || category;
  };

  const getSeverityIcon = (severity: 1 | 2 | 3) => {
    if (severity === 1) return <Info className="w-4 h-4 text-blue-400" />;
    if (severity === 2) return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    return <AlertCircle className="w-4 h-4 text-red-400" />;
  };

  const getSeverityLabel = (severity: 1 | 2 | 3): string => {
    if (severity === 1) return 'Info';
    if (severity === 2) return 'Warning';
    return 'Error';
  };

  const totalErrors = messages.filter(m => m.severity === 3).length;
  const totalWarnings = messages.filter(m => m.severity === 2).length;
  const totalInfos = messages.filter(m => m.severity === 1).length;

  return (
    <div className="h-full flex flex-col border-b border-border">
      {/* Header */}
      <div className="bg-muted px-4 border-b border-border flex items-center h-10 overflow-hidden">
        <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <AlertCircle className="text-white opacity-95 h-5 w-5" strokeWidth={1.67} />
            <span className="text-sm font-medium text-white opacity-95">Parser Analysis</span>
          </div>
          <div className="flex items-center gap-3 ml-4 text-xs">
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
            className="h-8 w-8 p-0 flex items-center justify-center"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-3 text-xs space-y-2">
          {Object.entries(messagesByCategory).map(([category, categoryMessages]) => (
            <div key={category} className="space-y-1">
              {/* Category Header */}
              <div className="text-muted-foreground font-semibold uppercase tracking-wide text-[10px] mb-1.5">
                {getCategoryLabel(category)}
              </div>

              {/* Category Messages */}
              {categoryMessages.map((message) => (
                <div
                  key={message.id}
                  className="p-2 bg-muted/50 rounded border-l-2 cursor-pointer hover:bg-muted/70 transition-colors"
                  style={{
                    borderLeftColor: 
                      message.severity === 1 ? 'rgb(96 165 250)' : // blue-400
                      message.severity === 2 ? 'rgb(250 204 21)' : // yellow-400
                      'rgb(248 113 113)' // red-400
                  }}
                  onClick={() => message.line !== undefined && onGoToLine?.(message.line)}
                >
                  <div className="flex items-start gap-2">
                    {getSeverityIcon(message.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground font-medium mb-1">
                        {message.message}
                      </div>
                      <div className="text-muted-foreground text-[10px] space-x-2">
                        {message.line !== undefined && <span>Line {message.line}</span>}
                        {message.column !== undefined && message.column > 0 && (
                          <span>• Col {message.column}</span>
                        )}
                        <span>• {getSeverityLabel(message.severity)}</span>
                      </div>
                      {message.suggestion && (
                        <div className="mt-1.5 p-2 border border-muted-foreground/30 rounded bg-muted/30 flex items-start gap-2">
                          <div className="flex-1 text-muted-foreground text-[10px]">
                            <span className="font-semibold">Suggestion:</span> {message.suggestion}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInsertSuggestion?.(message.suggestion!, message.line);
                            }}
                            className="h-5 w-5 p-0 flex items-center justify-center hover:bg-primary/20"
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
          ))}
        </div>
      </div>
    </div>
  );
}
