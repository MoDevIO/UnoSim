import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SketchTabs } from "@/components/features/sketch-tabs";

function renderTabs(extra: Partial<React.ComponentProps<typeof SketchTabs>> = {}) {
  render(
    <SketchTabs
      tabs={[{ id: "main", name: "sketch.ino", content: "" }]}
      activeTabId="main"
      modifiedTabId={null}
      onTabClick={vi.fn()}
      onTabClose={vi.fn()}
      onTabRename={vi.fn()}
      onTabAdd={vi.fn()}
      {...extra}
    />,
  );
}

describe("Libraries (n) in the tab options menu (SSOT Libraries §5.1)", () => {
  it("is an entry of the options menu with the direct count, not a button of the tab bar", async () => {
    const user = userEvent.setup();
    const onOpenLibraries = vi.fn();
    renderTabs({ librariesCount: 1, onOpenLibraries });

    expect(screen.queryByRole("button", { name: /Libraries/ })).toBeNull();
    await user.click(screen.getByTitle("Options"));
    await user.click(await screen.findByRole("menuitem", { name: "Libraries (1)" }));

    expect(onOpenLibraries).toHaveBeenCalledOnce();
  });

  it("is absent without a handler", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByTitle("Options"));
    await screen.findByRole("menuitem", { name: "Save All Files" });

    expect(screen.queryByRole("menuitem", { name: /Libraries/ })).toBeNull();
  });
});
