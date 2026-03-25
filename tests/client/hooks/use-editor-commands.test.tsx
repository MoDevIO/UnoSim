import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RefObject } from "react";
import { useEditorCommands } from "../../../client/src/hooks/use-editor-commands";

// Utilities -------------------------------------------------------------------
function makeEditor(): any {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    find: vi.fn(),
    selectAll: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    goToLine: vi.fn(),
    insertSuggestionSmartly: vi.fn(),
  };
}

function createRef(editor: any): RefObject<any> {
  return { current: editor } as RefObject<any>;
}

function buildToast() {
  return vi.fn();
}

// Tests -----------------------------------------------------------------------
describe("useEditorCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ensure npm test environment's prompt is stubbed
    vi.stubGlobal("prompt", vi.fn());
  });

  it("runs basic commands when available", () => {
    const ed = makeEditor();
    const ref = createRef(ed);
    const toast = buildToast();
    const { result } = renderHook(() =>
      useEditorCommands(ref, { toast, code: "foo", setCode: vi.fn() }),
    );

    act(() => {
      result.current.undo();
      result.current.redo();
      result.current.find();
      result.current.selectAll();
      result.current.copy();
      result.current.cut();
      result.current.paste();
    });

    expect(ed.undo).toHaveBeenCalled();
    expect(ed.redo).toHaveBeenCalled();
    expect(ed.find).toHaveBeenCalled();
    expect(ed.selectAll).toHaveBeenCalled();
    expect(ed.copy).toHaveBeenCalled();
    expect(ed.cut).toHaveBeenCalled();
    expect(ed.paste).toHaveBeenCalled();
  });

  it("notifies via toast when command missing or editor absent", () => {
    const ref = createRef(null);
    const toast = buildToast();
    const { result } = renderHook(() => useEditorCommands(ref, { toast }));

    act(() => {
      result.current.undo();
      result.current.copy();
      result.current.goToLine();
    });

    // expect toast called at least once for missing ed
    expect(toast).toHaveBeenCalled();
  });

  it("insertSuggestion invokes editor method and suppressAutoStopOnce", () => {
    const ed = makeEditor();
    const ref = createRef(ed);
    const toast = buildToast();
    const suppress = vi.fn();
    const { result } = renderHook(() =>
      useEditorCommands(ref, { toast, suppressAutoStopOnce: suppress }),
    );

    act(() => {
      result.current.insertSuggestion("abc", 3);
    });

    expect(suppress).toHaveBeenCalled();
    expect(ed.insertSuggestionSmartly).toHaveBeenCalledWith("abc", 3);
    expect(toast).toHaveBeenCalled();
  });

  it("goToLine validates input and calls editor", () => {
    const ed = makeEditor();
    const ref = createRef(ed);
    const toast = buildToast();
    const _promptStub = vi.stubGlobal("prompt", vi.fn().mockReturnValue("5"));
    const { result } = renderHook(() => useEditorCommands(ref, { toast }));

    act(() => {
      result.current.goToLine();
    });

    expect(ed.goToLine).toHaveBeenCalledWith(5);
  });

  it("goToLine catches and logs error when goToLine throws", () => {
    const ed = makeEditor();
    ed.goToLine = vi.fn(() => {
      throw new Error("editor crash");
    });
    const ref = createRef(ed);
    const toast = buildToast();
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("3"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useEditorCommands(ref, { toast }));

    act(() => {
      result.current.goToLine();
    });

    expect(consoleSpy).toHaveBeenCalledWith("Go to line failed", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("insertSuggestion logs error when insertSuggestionSmartly not available", () => {
    const ed = makeEditor();
    delete ed.insertSuggestionSmartly;
    const ref = createRef(ed);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useEditorCommands(ref, {}));

    act(() => {
      result.current.insertSuggestion("abc");
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "insertSuggestionSmartly method not available on editor",
    );
    consoleSpy.mockRestore();
  });

  it("insertSuggestion catches error when insertSuggestionSmartly throws", () => {
    const ed = makeEditor();
    ed.insertSuggestionSmartly = vi.fn(() => {
      throw new Error("insert failed");
    });
    const ref = createRef(ed);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useEditorCommands(ref, {}));

    act(() => {
      result.current.insertSuggestion("abc");
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("formatCode applies formatting and updates state", () => {
    const ed = makeEditor();
    const ref = createRef(ed);
    let code = "x";
    const setCode = vi.fn((fn) => {
      code = typeof fn === "function" ? fn(code) : fn;
    });
    const toast = buildToast();
    const { result } = renderHook(() =>
      useEditorCommands(ref, { toast, code, setCode }),
    );

    act(() => {
      result.current.formatCode();
    });

    expect(setCode).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });
});