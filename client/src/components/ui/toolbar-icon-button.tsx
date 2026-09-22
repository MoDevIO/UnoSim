import * as React from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getStatusHoverTextClass, getStatusTextClass } from "@/lib/status-semantics";

interface ToolbarIconButtonProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Button>, "children" | "size" | "variant"> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly destructive?: boolean;
  readonly pressed?: boolean;
  readonly status?: "default" | "success" | "muted" | "bright" | "error";
  readonly animated?: boolean;
  readonly animation?: "generating" | "waiting" | "evaluating" | "error";
  readonly iconSize?: "default" | "lg";
}

type ToolbarIconStatus = NonNullable<ToolbarIconButtonProps["status"]>;

const STATUS_CLASS_NAMES: Record<ToolbarIconStatus, string | undefined> = {
  success: `${getStatusTextClass("success")} ${getStatusHoverTextClass("success")}`,
  muted: "text-muted-foreground hover:text-muted-foreground",
  bright: "text-foreground hover:text-foreground",
  error: `${getStatusTextClass("error")} ${getStatusHoverTextClass("error")}`,
  default: undefined,
};

function getToolbarIconStatusClassName(
  status: ToolbarIconButtonProps["status"],
  pressed: boolean | undefined,
) {
  if (status !== undefined) return STATUS_CLASS_NAMES[status];
  if (pressed === undefined) return undefined;
  return pressed
    ? "text-status-success hover:text-status-success"
    : "text-muted-foreground hover:text-muted-foreground";
}

function getToolbarIconAnimationClassName(
  animation: ToolbarIconButtonProps["animation"],
  animated: boolean,
) {
  if (animation !== undefined) return `toolbar-icon-button-animation-${animation}`;
  if (animated) return "toolbar-icon-button-animated";
  return undefined;
}

/** Shared icon-only action used by compact panel toolbars. */
export function ToolbarIconButton({
  icon,
  label,
  destructive = false,
  pressed,
  status,
  animated = false,
  animation,
  iconSize = "default",
  className,
  title,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  ...props
}: Readonly<ToolbarIconButtonProps>) {
  const resolvedAriaPressed = ariaPressed ?? pressed;
  const statusClassName = getToolbarIconStatusClassName(status, pressed);
  const animationClassName = getToolbarIconAnimationClassName(animation, animated);
  let renderedIcon = icon;
  if (React.isValidElement(icon)) {
    renderedIcon = React.cloneElement(icon, {
        className: cn(
          destructive && "text-red-500",
          animationClassName,
          (icon.props as { className?: string }).className,
        ),
      });
  }

  return (
    <Button
      {...props}
      variant="ghost"
      size="icon"
      className={cn(
        "hover:border-transparent",
        statusClassName,
        iconSize === "lg" ? "[&_svg]:!h-5 [&_svg]:!w-5" : undefined,
        className,
      )}
      aria-label={ariaLabel ?? label}
      title={title ?? label}
      aria-pressed={resolvedAriaPressed}
    >
      {renderedIcon}
    </Button>
  );
}
