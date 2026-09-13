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

async function openFileMenu() {
  const trigger = screen.getByRole("menuitem", { name: "File" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Load Files" })).toBeInTheDocument());
}

describe("Load Files workflow", () => {
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
