import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileManagement } from "../../../client/src/hooks/use-file-management";
import type { FileEntry } from "../../../client/src/hooks/use-file-manager";

// lightweight sketch type for tests; matches shape used by hook
interface Sketch {
  id: string;
  title: string;
  content: string;
}


// helper to create a minimal IOPinRecord array
const makePins = () => {
  const pins: any[] = [];
  for (let i = 0; i <= 13; i++) pins.push({ pin: String(i), defined: false, usedAt: [] });
  for (let i = 0; i <= 5; i++) pins.push({ pin: `A${i}`, defined: false, usedAt: [] });
  return pins;
};

describe("useFileManagement", () => {
  const baseParams: any = {};

  beforeEach(() => {
    // reset base params before each test
    baseParams.simulationStatus = "stopped";
    baseParams.sendMessage = vi.fn();
    baseParams.setTabs = vi.fn();
    baseParams.setActiveTabId = vi.fn();
    baseParams.setCode = vi.fn();
    baseParams.setIsModified = vi.fn();
    baseParams.clearOutputs = vi.fn();
    baseParams.resetPinUI = vi.fn();
    baseParams.setCompilationStatus = vi.fn();
    baseParams.setArduinoCliStatus = vi.fn();
    baseParams.setGccStatus = vi.fn();
    baseParams.setLastCompilationResult = vi.fn();
    baseParams.setSimulationStatus = vi.fn();
    baseParams.setHasCompiledOnce = vi.fn();
    baseParams.setCompilationPanelSize = vi.fn();
    baseParams.setActiveOutputTab = vi.fn();
    baseParams.setIoRegistry = vi.fn();
    baseParams.setParserPanelDismissed = vi.fn();
    baseParams.tabs = [];
  });

  it("initializes default sketch when sketches prop appears", () => {
    const sketches: Sketch[] = [
      { id: "1", title: "foo", content: "bar" },
    ];

    const { result, rerender } = renderHook(
      ({ sketches }: { sketches?: Sketch[] }) => useFileManagement({ ...baseParams, sketches }),
      { initialProps: { sketches: undefined } },
    );

    // first render should not have initialized
    expect(baseParams.setTabs).not.toHaveBeenCalled();

    // re-render with sketches
    // cast to any because props type inference from initialProps is narrow
    rerender({ sketches } as any);

    expect(baseParams.setCode).toHaveBeenCalledWith("bar");
    expect(baseParams.setTabs).toHaveBeenCalled();
    expect(baseParams.setActiveTabId).toHaveBeenCalledWith("default-sketch");
  });

  it("handleFilesLoaded replaces all tabs when replaceAll=true", () => {
    const { result } = renderHook(() => useFileManagement(baseParams));

    const files: FileEntry[] = [
      { name: "a.ino", content: "one" },
      { name: "b.h", content: "two" },
    ];

    act(() => {
      result.current.handleFilesLoaded(files, true);
    });

    // a stop_simulation message should not be sent (simulation was stopped)
    expect(baseParams.sendMessage).not.toHaveBeenCalled();
    expect(baseParams.setTabs).toHaveBeenCalled();
    expect(baseParams.clearOutputs).toHaveBeenCalled();
    expect(baseParams.setCompilationStatus).toHaveBeenCalledWith("ready");
  });

  it("handleFilesLoaded appends headers when replaceAll=false", () => {
    // start with an existing tab array to verify merging
    const originalTabs = [{ id: "orig", name: "orig.ino", content: "x" }];
    baseParams.tabs = originalTabs;
    const { result } = renderHook(() => useFileManagement(baseParams));

    const files: FileEntry[] = [{ name: "new.h", content: "y" }];

    act(() => {
      result.current.handleFilesLoaded(files, false);
    });

    // setTabs is invoked with a function; execute it to ensure it produces correct merge
    expect(baseParams.setTabs).toHaveBeenCalledTimes(1);
    const updater = baseParams.setTabs.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    const merged = updater(originalTabs);
    expect(merged).toEqual([
      originalTabs[0],
      expect.objectContaining({ name: "new.h" }),
    ]);
  });

  it("handleLoadExample stops running simulation and resets state", () => {
    baseParams.simulationStatus = "running";
    const { result } = renderHook(() => useFileManagement(baseParams));

    act(() => {
      result.current.handleLoadExample("example.ino", "content123");
    });

    expect(baseParams.sendMessage).toHaveBeenCalledWith({ type: "stop_simulation" });
    expect(baseParams.setTabs).toHaveBeenCalled();
    expect(baseParams.setCode).toHaveBeenCalledWith("content123");
    expect(baseParams.setCompilationStatus).toHaveBeenCalledWith("ready");
    expect(baseParams.setSimulationStatus).toHaveBeenCalledWith("stopped");
  });

  it("exposes file manager helpers from useFileManager", () => {
    const { result } = renderHook(() => useFileManagement(baseParams));
    expect(typeof result.current.onLoadFiles).toBe("function");
    expect(typeof result.current.handleHiddenFileInput).toBe("function");
    expect(typeof result.current.downloadAllFiles).toBe("function");
    expect(result.current.fileInputRef).toBeDefined();
  });
});
