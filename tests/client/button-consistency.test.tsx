import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Copy, Eye, Trash2 } from "lucide-react";

describe("shared Button consistency", () => {
  it("keeps compact icon and text controls on the same visual geometry", () => {
    render(
      <>
        <Button size="icon" variant="outline" aria-label="view">
          <Eye />
        </Button>
        <Button size="sm" variant="outline">
          <Copy />
          Copy
        </Button>
        <Button size="sm" variant="destructiveOutline" disabled>
          <Trash2 />
          Clear
        </Button>
      </>,
    );

    const icon = screen.getByRole("button", { name: "view" });
    const compact = screen.getByRole("button", { name: "Copy" });
    const destructive = screen.getByRole("button", { name: "Clear" });

    for (const button of [icon, compact, destructive]) {
      expect(button).toHaveClass(
        "h-[var(--ui-button-height)]",
        "rounded-md",
        "border",
        "focus-visible:ring-2",
        "[&_svg]:size-4",
      );
    }
    expect(icon).toHaveClass("w-[var(--ui-button-height)]", "p-0", "border-border/70");
    expect(compact).toHaveClass("px-3", "border-border/70", "bg-background/70");
    expect(destructive).toHaveClass(
      "px-3",
      "border-destructive",
      "bg-background",
      "text-danger-soft",
    );
    expect(destructive).toBeDisabled();
  });
});
