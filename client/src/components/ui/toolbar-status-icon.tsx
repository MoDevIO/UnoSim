import * as React from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getStatusTextClass } from "@/lib/status-semantics";

interface ToolbarStatusIconProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly status: "success" | "error";
  readonly className?: string;
}

/** Non-interactive status indicator sized and aligned like a toolbar icon button. */
export function ToolbarStatusIcon({ icon, label, status, className }: ToolbarStatusIconProps) {
  const iconColorClass = getStatusTextClass(status);
  const statusIcon = React.isValidElement(icon)
    ? React.cloneElement(icon, {
        className: cn((icon.props as { className?: string }).className, iconColorClass),
      })
    : icon;

  return (
    <output
      aria-live="polite"
      title={label}
      className={cn(
        "ui-type-toolbar inline-flex h-[var(--ui-button-height)] w-[var(--ui-button-height)] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md p-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-default",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {statusIcon}
    </output>
  );
}
