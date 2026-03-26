import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileManager } from "@/hooks/use-file-manager";

describe("useFileManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stable refs and callbacks", () => {
    const { result } = renderHook(() => useFileManager());
    expect(result.current.fileInputRef).toBeDefined();
    expect(typeof result.current.onLoadFiles).toBe("function");
    expect(typeof result.current.downloadAllFiles).toBe("function");
    expect(typeof result.current.handleHiddenFileInput).toBe("function");
    expect(result.current.lastLoadedFiles).toBeNull();
  });

  it("onLoadFiles triggers file input click", () => {
    const { result } = renderHook(() => useFileManager());
    const clickFn = vi.fn();
    (result.current.fileInputRef as any).current = { click: clickFn };

    act(() => {
      result.current.onLoadFiles();
    });

    expect(clickFn).toHaveBeenCalled();
  });

  it("downloadAllFiles toasts if no tabs provided", async () => {
    const toastFn = vi.fn();
    const { result } = renderHook(() => useFileManager({ toast: toastFn }));

    await act(async () => {
      await result.current.downloadAllFiles([]);
    });

    expect(toastFn).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Nothing to download" }),
    );
  });

  it("downloadAllFiles creates download links", async () => {
    vi.useFakeTimers();
    const toastFn = vi.fn();
    const { result } = renderHook(() =>
      useFileManager({ toast: toastFn }),
    );

    const createElement = vi.spyOn(document, "createElement");
    vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);

    await act(async () => {
      result.current.downloadAllFiles([
        { name: "sketch.ino", content: "void setup(){}" },
      ]);
    });

    // Fast-forward through the setTimeout delays
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(createElement).toHaveBeenCalledWith("a");
    vi.useRealTimers();
  });

  it("handleHiddenFileInput reads .ino files", async () => {
    const onFilesLoaded = vi.fn();
    const { result } = renderHook(() => useFileManager({ onFilesLoaded }));

    const fileContent = "void setup(){}";
    // Create a mock file with explicit text() method for jsdom compatibility
    const mockFile = {
      name: "sketch.ino",
      text: () => Promise.resolve(fileContent),
    };

    const event = {
      target: {
        files: [mockFile],
      },
    };

    await act(async () => {
      await result.current.handleHiddenFileInput(event as any);
    });

    expect(onFilesLoaded).toHaveBeenCalledWith(
      [{ name: "sketch.ino", content: fileContent }],
      false,
    );
  });

  it("handleHiddenFileInput ignores non .ino/.h files", async () => {
    const onFilesLoaded = vi.fn();
    const { result } = renderHook(() => useFileManager({ onFilesLoaded }));

    const file = new File(["data"], "readme.txt", { type: "text/plain" });
    const event = { target: { files: [file] } };

    await act(async () => {
      await result.current.handleHiddenFileInput(event as any);
    });

    expect(onFilesLoaded).not.toHaveBeenCalled();
  });

  it("handleHiddenFileInput handles no files", async () => {
    const onFilesLoaded = vi.fn();
    const { result } = renderHook(() => useFileManager({ onFilesLoaded }));

    const event = { target: { files: null } };

    await act(async () => {
      await result.current.handleHiddenFileInput(event as any);
    });

    expect(onFilesLoaded).not.toHaveBeenCalled();
  });
});
