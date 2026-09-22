import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "@/components/ui/status-dot";

describe("StatusDot", () => {
  it.each([
    ["success", "HTTP ready", "bg-status-success"],
    ["error", "HTTP error", "bg-status-error"],
    ["warning", "HTTP degraded", "bg-status-warning"],
    ["info", "Parser information", "bg-accent-cyan"],
    ["busy", "HTTP compiling", "bg-accent-cyan"],
    ["idle", "WebSocket not connected", "bg-muted-foreground"],
    ["unknown", "WebSocket state unknown", "bg-muted-foreground"],
  ] as const)("renders %s as a labeled, passive dot", (status, label, colorClass) => {
    const { queryByRole } = render(<StatusDot status={status} label={label} />);
    const accessibleLabel = screen.getByText(label);
    const dot = accessibleLabel.parentElement;

    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("title", label);
    expect(dot).toHaveClass("inline-flex", "h-2", "w-2", "rounded-full", colorClass, "cursor-default");
    expect(dot.className).not.toMatch(/(?:^|\s)(?:hover:|focus-visible:|border-|bg-background|ring-|cursor-pointer)/);
    expect(dot).not.toHaveAttribute("role");
    expect(dot).not.toHaveAttribute("aria-label");
    expect(dot).not.toHaveAttribute("tabindex");
    expect(dot).not.toHaveAttribute("aria-live");
    expect(queryByRole("button")).not.toBeInTheDocument();
  });

  it("can preserve the pulse on an active status", () => {
    render(<StatusDot status="busy" label="WebSocket reconnecting" pulse />);

    expect(screen.getByText("WebSocket reconnecting").parentElement).toHaveClass("animate-pulse");
  });
});
