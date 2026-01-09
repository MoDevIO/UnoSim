import * as React from "react";
import { cn } from "@/lib/utils";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface InputGroupProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onSubmit?: () => void;
  inputTestId?: string;
  buttonTestId?: string;
}

export const InputGroup = React.forwardRef<HTMLInputElement, InputGroupProps>(
  ({ className, onSubmit, inputTestId, buttonTestId, disabled, onKeyDown, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (onKeyDown) onKeyDown(e as any);
      if (e.key === "Enter") {
        e.preventDefault();
        if (!disabled && onSubmit) onSubmit();
      }
    };

    return (
      <div
        className={cn(
          "w-full",
          className
        )}
      >
        <div className="flex items-center w-full rounded-md border border-border bg-input overflow-hidden transition-colors duration-150 focus-within:ring-0 focus-within:outline-none">
          <input
            ref={ref}
            {...props}
            data-testid={inputTestId}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex-1 bg-transparent px-3 py-2 h-9 text-base placeholder-muted-foreground text-foreground focus:outline-none",
              // ensure no internal rounding or border
              "rounded-none border-0"
            )}
          />

          <Button
            type="button"
            onClick={onSubmit}
            size="sm"
            disabled={disabled}
            data-testid={buttonTestId}
            className={cn(
              "h-9 w-9 p-0 flex items-center justify-center transition-colors duration-150 rounded-none",
              disabled ? "bg-background text-muted-foreground" : "bg-green-600 hover:bg-green-700 text-white",
              // remove default border so edges flush
              "border-0"
            )}
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
);
InputGroup.displayName = "InputGroup";

export default InputGroup;
