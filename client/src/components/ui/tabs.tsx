import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { AppTab } from "@/components/ui/app-tab";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Keep defaults minimal; let callers control spacing/scroll/background
      "flex items-center justify-start gap-2 rounded-none",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

type TabsTriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>,
  "asChild"
>;

const TabsTrigger = React.forwardRef<HTMLDivElement, TabsTriggerProps>(
  ({ className, children, ...props }, ref) => (
    <TabsPrimitive.Trigger asChild {...props}>
      <AppTab
        ref={ref}
        className={cn(
          "justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        {children}
      </AppTab>
    </TabsPrimitive.Trigger>
  ),
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
