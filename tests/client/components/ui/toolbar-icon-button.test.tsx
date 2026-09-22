import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolbarIconButton } from "@/components/ui/toolbar-icon-button";

describe("ToolbarIconButton", () => {
  it("renders a neutral icon-only action with an accessible label", () => {
    render(
      <ToolbarIconButton
        icon={<span data-testid="toolbar-icon" />}
        label="Show source locations"
      />,
    );

    const button = screen.getByRole("button", { name: "Show source locations" });
    expect(button).toHaveAttribute("title", "Show source locations");
    expect(button).toHaveClass("bg-transparent", "h-[var(--ui-button-height)]", "w-[var(--ui-button-height)]");
    expect(button.querySelector("[data-testid='toolbar-icon']")).not.toBeNull();
  });

  it("marks destructive actions on the icon button without an outline variant", () => {
    render(
      <ToolbarIconButton
        icon={<span />}
        label="Clear serial output"
        destructive
      />,
    );

    const button = screen.getByRole("button", { name: "Clear serial output" });
    expect(button).not.toHaveClass("border-destructive", "border-border/70");
    expect(button.querySelector("svg, span")).toHaveClass("text-red-500");
  });

  it("uses the semantic success color for pressed toggles and muted color otherwise", () => {
    render(
      <>
        <ToolbarIconButton
          icon={<span />}
          label="Active workspace"
          pressed
        />
        <ToolbarIconButton
          icon={<span />}
          label="Inactive workspace"
          pressed={false}
        />
      </>,
    );

    expect(screen.getByRole("button", { name: "Active workspace" })).toHaveClass("text-status-success");
    expect(screen.getByRole("button", { name: "Active workspace" })).toHaveClass("hover:text-status-success");
    expect(screen.getByRole("button", { name: "Active workspace" })).not.toHaveClass("text-primary");
    expect(screen.getByRole("button", { name: "Active workspace" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Inactive workspace" })).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("button", { name: "Inactive workspace" })).toHaveClass("hover:text-muted-foreground");
    expect(screen.getByRole("button", { name: "Inactive workspace" })).toHaveAttribute("aria-pressed", "false");
  });

  it("uses a visual status and animates only the icon without toggle semantics", () => {
    render(
      <ToolbarIconButton
        icon={<span data-testid="status-icon" />}
        label="Tutor ready"
        status="success"
        animated
      />,
    );

    const button = screen.getByRole("button", { name: "Tutor ready" });
    expect(button).toHaveClass("text-status-success", "hover:text-status-success");
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).not.toHaveClass("toolbar-icon-button-animated");
    expect(screen.getByTestId("status-icon")).toHaveClass("toolbar-icon-button-animated");
  });

  it("uses muted visual status without adding toggle semantics", () => {
    render(
      <ToolbarIconButton
        icon={<span />}
        label="Tutor not ready"
        status="muted"
      />,
    );

    const button = screen.getByRole("button", { name: "Tutor not ready" });
    expect(button).toHaveClass("text-muted-foreground", "hover:text-muted-foreground");
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("supports bright and error visual states with named icon-only animations", () => {
    render(
      <>
        <ToolbarIconButton
          icon={<span data-testid="bright-icon" />}
          label="Tutor waiting"
          status="bright"
        />
        <ToolbarIconButton
          icon={<span data-testid="error-icon" />}
          label="Tutor error"
          status="error"
          animation="error"
        />
      </>,
    );

    const brightButton = screen.getByRole("button", { name: "Tutor waiting" });
    expect(brightButton).toHaveClass("text-foreground", "hover:text-foreground");
    expect(brightButton).not.toHaveAttribute("aria-pressed");

    const errorButton = screen.getByRole("button", { name: "Tutor error" });
    expect(errorButton).toHaveClass("text-status-error", "hover:text-status-error");
    expect(errorButton).not.toHaveAttribute("aria-pressed");
    expect(screen.getByTestId("error-icon")).toHaveClass("toolbar-icon-button-animation-error");
    expect(errorButton).not.toHaveClass("toolbar-icon-button-animation-error");
  });

  it("opts into a larger SVG without changing the default icon size", () => {
    const { rerender } = render(
      <ToolbarIconButton
        icon={<span />}
        label="Default icon"
      />,
    );

    expect(screen.getByRole("button", { name: "Default icon" })).not.toHaveClass(
      "[&_svg]:!h-5",
      "[&_svg]:!w-5",
    );

    rerender(
      <ToolbarIconButton
        icon={<span />}
        label="Large icon"
        iconSize="lg"
      />,
    );

    expect(screen.getByRole("button", { name: "Large icon" })).toHaveClass(
      "[&_svg]:!h-5",
      "[&_svg]:!w-5",
    );
  });
});
