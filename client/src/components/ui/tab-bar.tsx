import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface TabBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render the shared styling on a child such as Radix TabsList. */
  readonly asChild?: boolean;
}

/** Shared visual/layout contract for editor and output tab strips. */
export const TabBar = React.forwardRef<HTMLDivElement, TabBarProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={ref}
        className={cn("unified-tab-bar", className)}
        {...props}
      />
    );
  },
);
TabBar.displayName = "TabBar";
