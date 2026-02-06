import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCompilation } from "../../../client/src/hooks/use-compilation";
import { apiRequest } from "../../../client/src/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const buildParams = () => {
  const editorRef = {
    current: {
      getValue: () => "void setup() {}\nvoid loop() {}",
    },
  } as { current: { getValue: () => string } | null };

  const tabs = [
    { id: "tab-1", name: "sketch.ino", content: "tab code" },
    { id: "tab-2", name: "header.h", content: "header" },
  ];

  return {
    editorRef,
    tabs,
    activeTabId: "tab-1",
    code: "",
    setSerialOutput: vi.fn(),
    setParserMessages: vi.fn(),
    setParserPanelDismissed: vi.fn(),
    resetPinUI: vi.fn(),
    setIoRegistry: vi.fn(),
    setHasCompiledOnce: vi.fn(),
    setIsModified: vi.fn(),
    setDebugMessages: vi.fn(),
    addDebugMessage: vi.fn(),
    ensureBackendConnected: vi.fn(() => true),
    isBackendUnreachableError: vi.fn(() => false),
    triggerErrorGlitch: vi.fn(),
    toast: vi.fn(),
    startSimulation: vi.fn(),
  };
};

describe("useCompilation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial compilation state", () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCompilation(params), { wrapper });

    expect(result.current.compilationStatus).toBe("ready");
    expect(result.current.arduinoCliStatus).toBe("idle");
    expect(result.current.gccStatus).toBe("idle");
    expect(result.current.hasCompilationErrors).toBe(false);
    expect(result.current.lastCompilationResult).toBeNull();
    expect(result.current.cliOutput).toBe("");
  });

  it("clears compilation output and parser messages", () => {
    const params = buildParams();
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.setCliOutput("old output");
      result.current.setLastCompilationResult("error");
    });

    act(() => {
      result.current.handleClearCompilationOutput();
    });

    expect(result.current.cliOutput).toBe("");
    expect(result.current.lastCompilationResult).toBeNull();
    expect(params.setParserMessages).toHaveBeenCalledWith([]);
  });

  it("handles compile success and updates state", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(result.current.lastCompilationResult).toBe("success");
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/compile",
      expect.objectContaining({ code: expect.any(String) }),
    );
    expect(result.current.cliOutput).toBe("OK");
    expect(result.current.hasCompilationErrors).toBe(false);
    expect(params.setSerialOutput).toHaveBeenCalledWith([]);
    expect(params.setIoRegistry).toHaveBeenCalled();
  });

  it("shows toast when compiling without code", () => {
    const params = buildParams();
    params.editorRef.current = { getValue: () => "" };
    params.tabs = [];
    params.code = "";

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "No Code" }),
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("handles compile failure and shows error", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: false,
        errors: "Compilation error",
        parserMessages: [{ type: "error", message: "Syntax error" }],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(result.current.lastCompilationResult).toBe("error");
    });

    expect(result.current.cliOutput).toBe("Compilation error");
    expect(result.current.hasCompilationErrors).toBe(true);
    expect(params.triggerErrorGlitch).toHaveBeenCalled();
    expect(params.setParserMessages).toHaveBeenCalledWith([
      { type: "error", message: "Syntax error" },
    ]);
    expect(params.setParserPanelDismissed).toHaveBeenCalledWith(false);
  });

  it("handles backend unreachable during compile", async () => {
    const params = buildParams();
    params.isBackendUnreachableError.mockReturnValue(true);
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockRejectedValue: (value: unknown) => void;
    };

    apiRequestMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(params.isBackendUnreachableError).toHaveBeenCalled();
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backend unreachable",
        variant: "destructive",
      }),
    );
  });

  it("compiles with multiple tabs as headers", async () => {
    const params = buildParams();
    params.tabs = [
      { id: "tab-1", name: "sketch.ino", content: "main code" },
      { id: "tab-2", name: "header1.h", content: "header 1" },
      { id: "tab-3", name: "header2.h", content: "header 2" },
    ];
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalled();
    });

    const callArgs = (apiRequest as any).mock.calls[0][2];
    expect(callArgs.headers).toHaveLength(2);
    expect(callArgs.headers[0]).toEqual({
      name: "header1.h",
      content: "header 1",
    });
    expect(callArgs.headers[1]).toEqual({
      name: "header2.h",
      content: "header 2",
    });
  });

  it("handleCompileAndStart starts simulation on success", async () => {
    vi.useFakeTimers();
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "Compiled successfully",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(params.startSimulation).toHaveBeenCalled();
    });

    expect(result.current.compilationStatus).toBe("success");
    expect(params.setHasCompiledOnce).toHaveBeenCalledWith(true);
    expect(params.setIsModified).toHaveBeenCalledWith(false);

    vi.useRealTimers();
  });

  it("handleCompileAndStart does not start simulation on error", async () => {
    vi.useFakeTimers();
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: false,
        errors: "Compilation failed",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(result.current.compilationStatus).toBe("error");
    });

    expect(params.startSimulation).not.toHaveBeenCalled();
    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Compilation Completed with Errors",
        variant: "destructive",
      }),
    );

    vi.useRealTimers();
  });

  it("checks backend connection before compiling", () => {
    const params = buildParams();
    params.ensureBackendConnected.mockReturnValue(false);
    const wrapper = createWrapper();

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    expect(params.ensureBackendConnected).toHaveBeenCalledWith(
      "Simulation starten",
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("resets pin UI and clears outputs before compiling", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(params.resetPinUI).toHaveBeenCalled();
    });

    expect(params.setSerialOutput).toHaveBeenCalledWith([]);
    expect(params.setParserMessages).toHaveBeenCalledWith([]);
  });

  it("adds debug messages during compilation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(params.addDebugMessage).toHaveBeenCalled();
    });

    expect(params.addDebugMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "frontend",
        type: "compile_request",
      }),
    );
  });

  it("calls compileMutation.mutate when handleCompile is invoked", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/compile",
        expect.objectContaining({ code: expect.any(String) }),
      );
    });
  });

  it("handles network error by showing toast", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockRejectedValue: (value: unknown) => void;
    };

    apiRequestMock.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    // Wait for mutation to process error and show toast
    await waitFor(
      () => {
        expect(params.toast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "destructive",
          }),
        );
      },
      { timeout: 3000 },
    );
  });

  it("getMainSketchCode gets value from editor when available", async () => {
    const params = buildParams();
    params.editorRef.current = { getValue: () => "editor code" };
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalled();
    });

    const callArgs = (apiRequest as any).mock.calls[0][2];
    expect(callArgs.code).toBe("editor code");
  });

  it("getMainSketchCode falls back to first tab content", async () => {
    const params = buildParams();
    params.editorRef.current = null;
    params.tabs = [{ id: "tab-1", name: "sketch.ino", content: "tab code" }];
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalled();
    });

    const callArgs = (apiRequest as any).mock.calls[0][2];
    expect(callArgs.code).toBe("tab code");
  });

  it("shows toast notification on successful compilation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "Compiled successfully",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalled();
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Arduino-CLI Compilation succeeded",
        description: "Your sketch has been compiled successfully",
      }),
    );
  });

  it("shows toast notification on failed compilation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: false,
        errors: "Compilation failed",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompile();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalled();
    });

    expect(params.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Arduino-CLI Compilation failed",
        description: "There were errors in your sketch",
        variant: "destructive",
      }),
    );
  });

  it("handles editorRef.getValue() throwing error in handleCompileAndStart", async () => {
    const params = buildParams();
    params.editorRef.current = {
      getValue: vi.fn().mockImplementation(() => {
        throw new Error("Editor error");
      }),
    };
    params.tabs = [{ id: "tab-1", name: "sketch.ino", content: "fallback code" }];

    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    // Should fallback to tabs[0].content when getValue throws
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/compile",
        expect.objectContaining({ code: "fallback code" }),
      );
    });
  });

  it("handles editorRef null in handleCompileAndStart with tabs fallback", async () => {
    const params = buildParams();
    params.editorRef.current = null;
    params.tabs = [{ id: "tab-1", name: "sketch.ino", content: "tab content" }];

    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/compile",
        expect.objectContaining({ code: "tab content" }),
      );
    });
  });

  it("handles editorRef null and empty tabs with code fallback", async () => {
    const params = buildParams();
    params.editorRef.current = null;
    params.tabs = [];
    params.code = "code fallback";

    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "OK",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/compile",
        expect.objectContaining({ code: "code fallback" }),
      );
    });
  });

  it("handles compile and start success calling startSimulation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: true,
        output: "Compilation successful",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(params.startSimulation).toHaveBeenCalled();
    });

    expect(params.setHasCompiledOnce).toHaveBeenCalledWith(true);
    expect(params.setIsModified).toHaveBeenCalledWith(false);
  });

  it("handles compile and start failure without calling startSimulation", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };

    apiRequestMock.mockResolvedValue({
      headers: { get: () => "application/json" },
      json: vi.fn().mockResolvedValue({
        success: false,
        output: "Compilation error",
        errors: "Error details",
        parserMessages: [],
      }),
      text: vi.fn(),
    });

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Compilation Completed with Errors",
          description: "Simulation will not start due to compilation errors.",
          variant: "destructive",
        }),
      );
    });

    expect(params.startSimulation).not.toHaveBeenCalled();
  });

  it("handles compile and start API error", async () => {
    const params = buildParams();
    const wrapper = createWrapper();

    const apiRequestMock = apiRequest as unknown as {
      mockRejectedValue: (value: unknown) => void;
    };

    (apiRequestMock as any).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useCompilation(params), { wrapper });

    act(() => {
      result.current.handleCompileAndStart();
    });

    await waitFor(() => {
      expect(params.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Compilation Failed",
          description: "Simulation will not start due to compilation errors.",
          variant: "destructive",
        }),
      );
    });

    expect(params.startSimulation).not.toHaveBeenCalled();
  });
});
