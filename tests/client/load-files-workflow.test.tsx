import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesktopMenuBar } from "../../client/src/components/features/app-header";
import { SketchTabs } from "../../client/src/components/features/sketch-tabs";

function renderWorkflow() {
  const loadFilesTriggerRef = { current: null as (() => void) | null };
  const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  const onFilesLoaded = vi.fn();

  render(
    <>
      <DesktopMenuBar
        isMac={false}
        board="Arduino Uno"
        baudRate={9600}
        simulationTimeout={30}
        showCompilationOutput={false}
        onFileAdd={vi.fn()}
        onFileRename={vi.fn()}
        onFormatCode={vi.fn()}
        onLoadFiles={() => loadFilesTriggerRef.current?.()}
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
      />
      <SketchTabs
        tabs={[{ id: "main", name: "sketch.ino", content: "" }]}
        activeTabId="main"
        modifiedTabId={null}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onTabRename={vi.fn()}
        onTabAdd={vi.fn()}
        onFilesLoaded={onFilesLoaded}
        loadFilesTriggerRef={loadFilesTriggerRef}
      />
    </>,
  );

  return { inputClick, onFilesLoaded };
}

function renderCommandParity() {
  const renameTriggerRef = { current: null as (() => void) | null };
  const onTabRename = vi.fn();
  const onDownloadAllFiles = vi.fn();
  const onFileRename = vi.fn(() => renameTriggerRef.current?.());

  render(
    <>
      <DesktopMenuBar
        isMac={false}
        board="Arduino Uno"
        baudRate={9600}
        simulationTimeout={30}
        showCompilationOutput={false}
        onFileAdd={vi.fn()}
        onFileRename={onFileRename}
        onFormatCode={vi.fn()}
        onLoadFiles={vi.fn()}
        onDownloadAllFiles={onDownloadAllFiles}
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
      />
      <SketchTabs
        tabs={[{ id: "main", name: "sketch.ino", content: "" }]}
        activeTabId="main"
        modifiedTabId={null}
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onTabRename={onTabRename}
        onTabAdd={vi.fn()}
        renameTriggerRef={renameTriggerRef}
        onDownloadAllFiles={onDownloadAllFiles}
      />
    </>,
  );

  return { onTabRename, onDownloadAllFiles, renameTriggerRef, onFileRename };
}

async function openFileMenu() {
  const trigger = screen.getByRole("menuitem", { name: "File" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Load Files" })).toBeInTheDocument());
}

describe("Load Files workflow", () => {
  it("uses the shared visual root for the active sketch tab", () => {
    renderWorkflow();

    const sketchTab = screen.getByRole("button", { name: "sketch.ino" });
    const tabShell = sketchTab.closest(".app-tab");
    expect(sketchTab).toHaveClass("app-tab__main", "ui-type-tab");
    expect(sketchTab).not.toHaveClass("app-tab");
    expect(tabShell).toHaveAttribute("data-active", "true");
    expect(tabShell).toHaveAttribute("data-app-tab", "true");
    expect(tabShell).toHaveClass("app-tab", "ui-type-tab");
    expect(tabShell).not.toHaveClass("unified-tab-shell", "border-r", "tabs-active");
  });

  it("keeps multiple editor tabs, keyboard switching, and close actions functional", () => {
    const onTabClick = vi.fn();
    render(
      <SketchTabs
        tabs={[
          { id: "main", name: "sketch.ino", content: "" },
          { id: "header", name: "header.h", content: "" },
        ]}
        activeTabId="main"
        modifiedTabId={null}
        onTabClick={onTabClick}
        onTabClose={vi.fn()}
        onTabRename={vi.fn()}
        onTabAdd={vi.fn()}
      />,
    );

    expect(document.querySelectorAll(".app-tab")).toHaveLength(2);
    const headerTab = screen.getByRole("button", { name: "header.h" });
    fireEvent.keyDown(headerTab, { key: "Enter" });
    expect(onTabClick).toHaveBeenCalledWith("header");

    fireEvent.click(screen.getByRole("button", { name: "Close file" }));
    expect(screen.getByRole("heading", { name: "Delete File?" })).toBeInTheDocument();
  });

  it("routes File and ellipsis entry points to the same file input", async () => {
    const { inputClick } = renderWorkflow();

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Load Files" }));
    expect(inputClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body, { button: 0 });
    const options = screen.getByRole("button", { name: "Options" });
    fireEvent.pointerDown(options, { button: 0 });
    fireEvent.pointerUp(options, { button: 0 });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Load Files" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("menuitem", { name: "Load Files" }));
    expect(inputClick).toHaveBeenCalledTimes(2);

    inputClick.mockRestore();
  });

  it("routes main-menu and overflow Rename through the same dialog workflow", async () => {
    const { onTabRename, onFileRename, renameTriggerRef } = renderCommandParity();
    const renameCommand = vi.fn();
    renameTriggerRef.current = renameCommand;

    await openFileMenu();
    const renameItem = screen.getByRole("menuitem", { name: "Rename" });
    fireEvent.click(renameItem);
    expect(onFileRename).toHaveBeenCalledTimes(1);
    expect(renameCommand).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body, { button: 0 });
    const options = screen.getByRole("button", { name: "Options" });
    fireEvent.pointerDown(options, { button: 0 });
    fireEvent.pointerUp(options, { button: 0 });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onFileRename).toHaveBeenCalledTimes(1);
    expect(renameCommand).toHaveBeenCalledTimes(2);
    expect(onTabRename).not.toHaveBeenCalled();
  });

  it("routes File and overflow Save All Files to one callback", async () => {
    const { onDownloadAllFiles } = renderCommandParity();

    await openFileMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Save All Files" }));
    expect(onDownloadAllFiles).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body, { button: 0 });
    const options = screen.getByRole("button", { name: "Options" });
    fireEvent.pointerDown(options, { button: 0 });
    fireEvent.pointerUp(options, { button: 0 });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Save All Files" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("menuitem", { name: "Save All Files" }));
    expect(onDownloadAllFiles).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing replace/add modal semantics", async () => {
    const { onFilesLoaded, inputClick } = renderWorkflow();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const sketch = new File(["void setup() {}"], "new.ino", { type: "text/plain" });
    Object.defineProperty(sketch, "text", { value: () => Promise.resolve("void setup() {}") });
    fireEvent.change(input!, { target: { files: [sketch] } });
    expect(await screen.findByText("Sketch ersetzen?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ja (Sketch ersetzen)" }));
    expect(onFilesLoaded).toHaveBeenCalledWith(
      [{ name: "new.ino", path: "new.ino", content: "void setup() {}" }],
      true,
    );
    expect(inputClick).not.toHaveBeenCalled();
    inputClick.mockRestore();
  });
});
