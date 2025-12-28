import { Button } from '@/components/ui/button';
import { Terminal, Trash2 } from 'lucide-react';

interface CompilationOutputProps {
  output: string;
  onClear: () => void;
}

export function CompilationOutput({ output, onClear }: CompilationOutputProps) {
  return (
    <div className="h-full flex flex-col border-b border-border" data-testid="compilation-output">
      <div className="bg-muted px-4 border-b border-border flex items-center h-10 overflow-hidden">
        <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Terminal className="text-accent h-4 w-4" />
            <span className="text-sm font-medium truncate">Compilation Output</span>
          </div>
          <div className="flex-1 min-w-0" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            data-testid="button-clear-output"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="console-output p-3 text-xs font-mono whitespace-pre-wrap" data-testid="compilation-text">
          {output || (
            <div className="text-muted-foreground italic">
              Compilation output will appear here...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
