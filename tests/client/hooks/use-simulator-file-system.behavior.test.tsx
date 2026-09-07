import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSimulatorFileSystem } from "../../../client/src/hooks/useSimulatorFileSystem";

vi.mock("@/hooks/use-file-manager", () => ({
  useFileManager: ({ onFilesLoaded }: { onFilesLoaded: (files: Array<{ name: string; content: string }>, replaceAll: boolean) => void }) => ({
    fileInputRef: { current: null },
    onLoadFiles: vi.fn(),
    downloadAllFiles: vi.fn(),
    handleHiddenFileInput: vi.fn(),
    triggerFilesLoaded: onFilesLoaded,
  }),
}));

const tab = (id: string, name: string, content: string) => ({ id, name, content });

function setup(overrides: Partial<Parameters<typeof useSimulatorFileSystem>[0]> = {}) {
  const state = {
    code: "main",
    setCode: vi.fn(),
    isModified: true,
    setIsModified: vi.fn(),
    tabs: [tab("main", "sketch.ino", "main"), tab("header", "header.h", "header")],
    setTabs: vi.fn(),
    activeTabId: "main",
    setActiveTabId: vi.fn(),
    initializeDefaultSketch: vi.fn(),
    toast: vi.fn(),
    onReplaceAllFiles: vi.fn(),
    onLoadExample: vi.fn(),
    ...overrides,
  };
  return { state, result: renderHook(() => useSimulatorFileSystem(state)).result };
}

describe("useSimulatorFileSystem behavior", () => {
  it("switches tabs and resets modified state", () => {
    const { state, result } = setup();
    act(() => result.current.handleTabClick("header"));
    expect(state.setActiveTabId).toHaveBeenCalledWith("header");
    expect(state.setCode).toHaveBeenCalledWith("header");
    expect(state.setIsModified).toHaveBeenCalledWith(false);
  });

  it("adds, renames, and closes a non-main tab", () => {
    const { state, result } = setup();
    act(() => result.current.handleTabAdd());
    expect(state.setTabs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: "header_2.h" })]));
    act(() => result.current.handleTabRename("header", "renamed.h"));
    expect(state.setTabs).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "header", name: "renamed.h" })]));
    act(() => result.current.handleTabClose("header"));
    expect(state.setTabs).toHaveBeenCalledWith([tab("main", "sketch.ino", "main")]);
  });

  it("protects the main sketch and clears the active tab when the last tab closes", () => {
    const { state, result } = setup({ tabs: [tab("main", "sketch.ino", "main")], activeTabId: "main" });
    act(() => result.current.handleTabClose("main"));
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Cannot Delete", variant: "destructive" }));

    const activeHeader = setup({ activeTabId: "header" });
    act(() => activeHeader.result.current.handleTabClose("header"));
    expect(activeHeader.state.setActiveTabId).toHaveBeenCalledWith("main");
    expect(activeHeader.state.setCode).toHaveBeenCalledWith("main");
  });

  it("loads files in replace and append modes with ino files first", () => {
    const { state, result } = setup();
    const files = [
      { name: "z.h", content: "z" },
      { name: "main.ino", content: "ino" },
    ];
    act(() => result.current.handleFilesLoaded(files, true));
    expect(state.onReplaceAllFiles).toHaveBeenCalled();
    expect(state.setTabs).toHaveBeenCalledWith([
      expect.objectContaining({ name: "main.ino", content: "ino" }),
      expect.objectContaining({ name: "z.h", content: "z" }),
    ]);
    act(() => result.current.handleFilesLoaded([{ name: "extra.h", content: "extra" }], false));
    expect(state.setTabs).toHaveBeenLastCalledWith([...state.tabs, expect.objectContaining({ name: "extra.h" })]);
  });

  it("loads an example as the only active file", () => {
    const { state, result } = setup();
    act(() => result.current.handleLoadExample("01-blink.ino", "blink"));
    expect(state.onLoadExample).toHaveBeenCalled();
    expect(state.setTabs).toHaveBeenCalledWith([expect.objectContaining({ name: "01-blink.ino", content: "blink" })]);
    expect(state.setCode).toHaveBeenCalledWith("blink");
    expect(state.setIsModified).toHaveBeenCalledWith(false);
  });
});
