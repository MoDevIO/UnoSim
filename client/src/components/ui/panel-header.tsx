import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PanelHeaderProps {
  readonly title: ReactNode;
  readonly icon?: ReactNode;
  readonly leadingContent?: ReactNode;
  readonly centerAction?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

/** Shared visual contract for compact panel headers in the workspace. */
export function PanelHeader({
  title,
  icon,
  leadingContent,
  centerAction,
  actions,
  className,
  testId,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "relative flex h-[var(--ui-header-height)] shrink-0 items-center gap-3 border-b border-border bg-muted px-3",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex shrink-0 items-center [&_svg]:!h-5 [&_svg]:!w-5">
          {icon}
        </span>
        <span
          className="font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ fontSize: "var(--fs-body-xs)" }}
        >
          {title}
        </span>
        {leadingContent}
      </div>
      {centerAction}
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  );
}
