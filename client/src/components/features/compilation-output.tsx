import { Button } from "@/components/ui/button";
import { Terminal, Trash2, CheckCircle2 } from "lucide-react";

interface CompilationError {
  file: string;
  line: number;
  column: number;
  type: "error" | "warning";
  message: string;
}

interface CompilationOutputProps {
  readonly output?: string;
  readonly errors?: CompilationError[];
  readonly onClear: () => void;
  readonly isSuccess?: boolean;
  readonly showSuccessMessage?: boolean;
  readonly hideHeader?: boolean;
}

export function CompilationOutput({
  output,
  errors,
  onClear,
  isSuccess = false,
  showSuccessMessage = true,
  hideHeader = false,
}: CompilationOutputProps) {
  return (
    <div
      className="h-full flex flex-col border-b border-border"
      data-testid="compilation-output"
    >
      {!hideHeader && (
        <div className="bg-muted px-[var(--header-padding-x)] border-b border-border flex items-center h-[var(--ui-header-height)] overflow-hidden">
          <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap gap-2">
            <div className="flex items-center space-x-2 flex-shrink-0">
              {isSuccess && showSuccessMessage ? (
                <CheckCircle2
                  className="text-green-500 opacity-95 h-5 w-5"
                  strokeWidth={1.67}
                />
              ) : (
                <Terminal
                  className="text-white opacity-95 h-5 w-5"
                  strokeWidth={1.67}
                />
              )}
              <span className="sr-only">Compilation Output</span>
            </div>
            {isSuccess && showSuccessMessage && (
              <span className="text-green-500 text-ui-sm font-medium flex-shrink-0">
                Compilation successful ✓
              </span>
            )}
            <div className="flex-1 min-w-0" />
            <Button
              variant="outline"
              size="sm"
              className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center ml-3"
              onClick={onClear}
              aria-label="Clear compilation output"
              title="Clear compilation output"
              data-testid="button-clear-output"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto custom-scrollbar">
        {errors && errors.length > 0 ? (
          <div data-testid="compilation-errors" className="p-3 font-mono whitespace-pre-wrap">
            {errors.map((e) => (
              <div
                key={`${e.file}:${e.line}:${e.column}:${e.type}:${e.message}`}
                className={e.type === "error" ? "text-red-400" : "text-yellow-400"}
              >
                {e.file}{e.line ? `:${e.line}` : ""}{e.column ? `:${e.column}` : ""} {e.type}: {e.message}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="console-output p-3 font-mono whitespace-pre-wrap"
            data-testid="compilation-text"
          >
            {output || (
              <div className="text-muted-foreground italic">
                Compilation output will appear here...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
