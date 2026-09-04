import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

type ScrollAreaProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> & {
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportClassName?: string;
  viewportTestId?: string;
  viewportProps?: React.ComponentPropsWithoutRef<
    typeof ScrollAreaPrimitive.Viewport
  >;
  scrollbarClassName?: string;
  thumbClassName?: string;
};

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      className,
      children,
      viewportRef,
      viewportClassName,
      viewportTestId,
      viewportProps,
      scrollbarClassName,
      thumbClassName,
      ...props
    },
    ref,
  ) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      ref={viewportRef}
      data-testid={viewportTestId}
      className={cn(
        "h-full w-full rounded-[inherit]",
        viewportClassName,
        viewportProps?.className,
      )}
      {...viewportProps}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar className={scrollbarClassName} thumbClassName={thumbClassName} />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<
    typeof ScrollAreaPrimitive.ScrollAreaScrollbar
  > & { thumbClassName?: string }
>(({ className, orientation = "vertical", thumbClassName, ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-[var(--ui-scrollbar-size)] border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-[var(--ui-scrollbar-size)] flex-col border-t border-t-transparent p-[1px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={cn("relative flex-1 rounded-full bg-border", thumbClassName)}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea /*, ScrollBar (internal) */ }; // ScrollBar is used only internally
