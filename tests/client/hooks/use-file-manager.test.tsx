import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileManager } from "../../../client/src/hooks/use-file-manager";

describe("useFileManager", () => {
  it("onLoadFiles triggers file input click when ref is set", () => {
    const { result } = renderHook(() => useFileManager());

    const clickMock = vi.fn();
    // simulate a DOM input element
    (result.current.fileInputRef as any).current = { click: clickMock };

    act(() => {
      result.current.onLoadFiles();
    });

    expect(clickMock).toHaveBeenCalled();
  });

  it("handleHiddenFileInput reads .ino files and calls onFilesLoaded", async () => {
    const onFilesLoaded = vi.fn();
    const { result } = renderHook(() => useFileManager({ onFilesLoaded }));

    const file = new File(["void setup() {}"], "example.ino", { type: "text/plain" });
    // Ensure text() exists in this test environment
    (file as any).text = async () => "void setup() {}";

    // Use a small FileList-like object (works reliably in JSDOM)
    const fakeFileList: any = { 0: file, length: 1, item: () => file };

    await act(async () => {
      await result.current.handleHiddenFileInput({
        target: { files: fakeFileList },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(onFilesLoaded).toHaveBeenCalledTimes(1);
    const [filesArg, replaceAll] = onFilesLoaded.mock.calls[0];
    expect(filesArg[0].name).toBe("example.ino");
    expect(filesArg[0].content).toContain("void setup");
    expect(replaceAll).toBe(false);
  });

  it("downloadAllFiles shows toast when there are no tabs", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useFileManager({ toast }));

    await act(async () => {
      await result.current.downloadAllFiles();
    });

    expect(toast).toHaveBeenCalled();
    expect(toast.mock.calls[0][0].title).toMatch(/Nothing to download/i);
  });
});
