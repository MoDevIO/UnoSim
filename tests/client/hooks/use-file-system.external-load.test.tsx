import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileSystem } from "@/hooks/useFileSystem";

const externalCode = "void setup() { external(); }\nvoid loop() {}";
const defaultSketch = {
  id: "default",
  name: "default.ino",
  content: "void setup() { defaultSketch(); }\nvoid loop() {}",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

describe("useFileSystem external code ownership", () => {
  it("does not overwrite LOAD_CODE content when sketch initialization is processed in the same batch", () => {
    const { result } = renderHook(() => useFileSystem({ sketches: undefined }));

    act(() => {
      result.current.setCode(externalCode);
      result.current.initializeDefaultSketch([defaultSketch]);
    });

    expect(result.current.code).toBe(externalCode);
    expect(result.current.codeRef.current).toBe(externalCode);
    expect(result.current.tabs).toEqual([
      expect.objectContaining({
        name: "default.ino",
        content: defaultSketch.content,
      }),
    ]);
  });
});
