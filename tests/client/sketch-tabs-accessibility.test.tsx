import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SketchTabs } from "@/components/features/sketch-tabs";

describe("SketchTabs accessibility", () => {
  it("announces when a file tab is modified while preserving its marker", () => {
    render(
      <SketchTabs
        tabs={[{ id: "main", name: "sketch.ino", content: "" }]}
        activeTabId="main"
        modifiedTabId="main"
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onTabRename={vi.fn()}
        onTabAdd={vi.fn()}
      />,
    );

    const modifiedTab = screen.getByRole("button", { name: "sketch.ino, modified" });
    expect(modifiedTab).toHaveAttribute("title", "sketch.ino, modified");
    expect(modifiedTab).toHaveTextContent("•");
  });

  it("does not announce an unchanged file as modified", () => {
    render(
      <SketchTabs
        tabs={[{ id: "main", name: "sketch.ino", content: "" }]}
        activeTabId="main"
        modifiedTabId={null}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onTabRename={vi.fn()}
        onTabAdd={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "sketch.ino" })).toBeInTheDocument();
  });
});
