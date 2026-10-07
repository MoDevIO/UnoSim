import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "ui-type-toolbar inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 py-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-[var(--ui-button-height)]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs",
        destructiveOutline:
          "border-destructive bg-background text-danger-soft shadow-xs hover:bg-destructive hover:text-destructive-foreground",
        outline:
          "text-foreground shadow-xs hover:border-border hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /* use the shared CSS variable for consistent button height */
        default: "h-[var(--ui-button-height)] px-4",
        sm: "h-[var(--ui-button-height)] rounded-md px-3",
        lg: "h-[var(--ui-button-height)] rounded-md px-6",
        icon:
          "h-[var(--ui-button-height)] w-[var(--ui-button-height)] shrink-0 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
