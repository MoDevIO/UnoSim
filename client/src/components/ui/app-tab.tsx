import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared visual root for editor tabs and semantic tab primitives. */
export const appTabClassName = "app-tab ui-type-tab";

interface AppTabProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly active?: boolean;
}

export const AppTab = React.forwardRef<HTMLDivElement, AppTabProps>(
  ({ active, className, ...props }, ref) => (
    <div
      ref={ref}
      data-app-tab="true"
      {...(active === undefined ? {} : { "data-active": active ? "true" : "false" })}
      className={cn(
        appTabClassName,
        "group focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
        className,
      )}
      {...props}
    />
  ),
);
AppTab.displayName = "AppTab";

export const AppTabMain = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn("app-tab__main ui-type-tab", className)}
    {...props}
  />
));
AppTabMain.displayName = "AppTabMain";
