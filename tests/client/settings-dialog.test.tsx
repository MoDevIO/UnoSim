import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsDialog from "@/components/features/settings-dialog";

vi.mock("@/components/features/external-examples-settings", () => ({
  ExternalExamplesSettings: () => (
    <section aria-label="External Examples settings">External Examples</section>
  ),
}));

describe("SettingsDialog layout", () => {
  it("groups all existing settings into the four information-architecture sections", () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace & Interaction" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Feedback & Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "External Examples settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("ui font scale")).toBeInTheDocument();
    expect(screen.getByLabelText("show pin monitor")).toBeInTheDocument();
    expect(screen.getByLabelText("enable experimental workspace layout")).toBeInTheDocument();
    expect(screen.getByLabelText("keep examples menu open")).toBeInTheDocument();
    expect(screen.getByLabelText("enable debug mode")).toBeInTheDocument();
    expect(screen.getByLabelText("toast duration")).toBeInTheDocument();
  });

  it("keeps existing setting persistence interactions intact", () => {
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("ui font scale"), { target: { value: "1.125" } });
    expect(localStorage.getItem("unoFontScale")).toBe("1.125");

    fireEvent.click(screen.getByLabelText("show pin monitor"));
    expect(localStorage.getItem("unoPinMonitorVisible")).toBe("1");

    fireEvent.change(screen.getByLabelText("toast duration"), { target: { value: "4" } });
    expect(localStorage.getItem("unoToastDuration")).toBe("2000");
  });
});
