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
});
