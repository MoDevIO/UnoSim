import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesktopMenuBar } from "../../client/src/components/features/app-header";

const topLevelMenus = ["File", "Edit", "Sketch", "Tools", "Help"] as const;

function getTrigger(name: string) {
  return screen.getByRole("menuitem", { name });
}

function getOpenMenus() {
  return document.querySelectorAll('[role="menu"][data-state="open"]');
}

async function openMenu(name: string) {
  const trigger = getTrigger(name);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(trigger, { button: 0 });
  await expectOnlyMenuOpen(name);
}

async function expectOnlyMenuOpen(name: string) {
  await waitFor(() => {
    expect(getOpenMenus()).toHaveLength(1);
    expect(getTrigger(name)).toHaveAttribute("data-state", "open");
    expect(getTrigger(name)).toHaveAttribute("aria-expanded", "true");

    topLevelMenus
      .filter((menuName) => menuName !== name)
      .forEach((menuName) => {
        expect(getTrigger(menuName)).toHaveAttribute("data-state", "closed");
        expect(getTrigger(menuName)).toHaveAttribute("aria-expanded", "false");
      });
  });
}

function renderMenuBar() {
  return render(
    <DesktopMenuBar
      isMac={false}
      board="Arduino Uno"
      baudRate={9600}
      simulationTimeout={30}
      showCompilationOutput={false}
      onFileAdd={vi.fn()}
      onFileRename={vi.fn()}
      onFormatCode={vi.fn()}
      onLoadFiles={vi.fn()}
      onDownloadAllFiles={vi.fn()}
      onSettings={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onCut={vi.fn()}
      onCopy={vi.fn()}
      onPaste={vi.fn()}
      onSelectAll={vi.fn()}
      onGoToLine={vi.fn()}
      onFind={vi.fn()}
      onCompile={vi.fn()}
      onCompileAndStart={vi.fn()}
      onOutputPanelToggle={vi.fn()}
      onTimeoutChange={vi.fn()}
    />,
  );
}

describe("Desktop top-level menus", () => {
  it("opens every top-level menu without a redundant title row", async () => {
    for (const name of topLevelMenus) {
      cleanup();
      renderMenuBar();
      await openMenu(name);
      await waitFor(() => expect(screen.getAllByText(name, { exact: true })).toHaveLength(1));

      const firstItemByMenu = {
        File: /New File/,
        Edit: /Undo/,
        Sketch: (accessibleName: string) => accessibleName.startsWith("Compile") && !accessibleName.includes("/"),
        Tools: /Board:/,
        Help: /Github/,
      } as const;
      expect(screen.getByRole("menuitem", { name: firstItemByMenu[name] })).toBeInTheDocument();
    }
  });

  it("does not open a menu from hover while the menubar is closed", async () => {
    renderMenuBar();
    fireEvent.pointerEnter(getTrigger("Edit"));

    await waitFor(() => expect(getOpenMenus()).toHaveLength(0));
    topLevelMenus.forEach((name) => {
      expect(getTrigger(name)).toHaveAttribute("data-state", "closed");
    });
  });

  it("switches every menu forward on pointer hover with exactly one open", async () => {
    renderMenuBar();
    await openMenu("File");

    for (const [name, item] of [
      ["Edit", /Undo/],
      ["Sketch", (accessibleName: string) => accessibleName.startsWith("Compile") && !accessibleName.includes("/")],
      ["Tools", /Board:/],
      ["Help", /Github/],
    ] as const) {
      fireEvent.pointerEnter(getTrigger(name));
      await expectOnlyMenuOpen(name);
      expect(screen.getByRole("menuitem", { name: item })).toBeInTheDocument();
    }
  });

  it("does not leave an earlier trigger active after repeated hover switches", async () => {
    renderMenuBar();
    await openMenu("File");

    fireEvent.pointerEnter(getTrigger("Edit"));
    await expectOnlyMenuOpen("Edit");
    fireEvent.pointerEnter(getTrigger("Sketch"));
    await expectOnlyMenuOpen("Sketch");

    expect(getTrigger("File")).toHaveAttribute("data-state", "closed");
    expect(getTrigger("Edit")).toHaveAttribute("data-state", "closed");
    expect(getTrigger("Sketch")).toHaveAttribute("data-state", "open");
  });

  it("closes the active menu and clears active triggers on outside click and Escape", async () => {
    renderMenuBar();
    await openMenu("File");
    fireEvent.pointerDown(document.body, { button: 0, ctrlKey: false });

    await waitFor(() => expect(getOpenMenus()).toHaveLength(0));
    topLevelMenus.forEach((name) => {
      expect(getTrigger(name)).toHaveAttribute("data-state", "closed");
    });

    await openMenu("Tools");
    const openMenuElement = document.querySelector<HTMLElement>('[role="menu"][data-state="open"]');
    expect(openMenuElement).not.toBeNull();
    fireEvent.keyDown(openMenuElement!, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(getOpenMenus()).toHaveLength(0));
    topLevelMenus.forEach((name) => {
      expect(getTrigger(name)).toHaveAttribute("data-state", "closed");
    });
  });

  it("switches every menu backward on pointer hover with exactly one open", async () => {
    renderMenuBar();
    await openMenu("Help");

    for (const name of ["Tools", "Sketch", "Edit", "File"] as const) {
      fireEvent.pointerEnter(getTrigger(name));
      await expectOnlyMenuOpen(name);
    }

    expect(screen.getByRole("menuitem", { name: /New File/ })).toBeInTheDocument();
  });
});
