import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("shared Button consistency", () => {
  it("keeps icon-only controls square and text controls on the shared height", () => {
    render(
      <>
        <Button size="icon" aria-label="view">
          View
        </Button>
        <Button size="sm" variant="destructive" disabled>
          Clear
        </Button>
      </>,
    );

    const icon = screen.getByRole("button", { name: "view" });
    const destructive = screen.getByRole("button", { name: "Clear" });
    expect(icon).toHaveClass("h-[var(--ui-button-height)]", "w-[var(--ui-button-height)]");
    expect(icon).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring");
    expect(destructive).toHaveClass("h-[var(--ui-button-height)]", "bg-destructive");
    expect(destructive).toBeDisabled();
  });
});
