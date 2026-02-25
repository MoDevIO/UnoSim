import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBackendHealth } from "../../../client/src/hooks/use-backend-health";
import type { QueryClient } from "@tanstack/react-query";

// Mock dependencies
const mockToast = vi.fn();
const mockRefetchQueries = vi.fn();
const mockQueryClient = {
  refetchQueries: mockRefetchQueries,
} as unknown as QueryClient;

vi.mock("../../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockUseWebSocket = vi.fn();
vi.mock("../../../client/src/hooks/use-websocket", () => ({
  useWebSocket: () => mockUseWebSocket(),
}));

describe("useBackendHealth", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockToast.mockClear();
    mockRefetchQueries.mockClear();
    
    // Default WebSocket mock state
    mockUseWebSocket.mockReturnValue({
      isConnected: true,
      connectionError: null,
      hasEverConnected: true,
    });

    // Mock fetch for health check
    fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should initialize with backend reachable", () => {
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    expect(result.current.backendReachable).toBe(true);
    expect(result.current.backendPingError).toBeNull();
    expect(result.current.showErrorGlitch).toBe(false);
  });

  it("should poll health endpoint every second", async () => {
    renderHook(() => useBackendHealth(mockQueryClient));

    // Initial call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/health", {
      method: "GET",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });

    // Wait for next interval
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("should detect backend unreachable on fetch error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));
    
    let result: any;
    await act(async () => {
      const hook = renderHook(() => useBackendHealth(mockQueryClient));
      result = hook.result;
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.backendReachable).toBe(false);
      expect(result.current.backendPingError).toBe("Network error");
    });
  });

  it("should show toast when backend becomes unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("Connection refused"));

    await act(async () => {
      renderHook(() => useBackendHealth(mockQueryClient));
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Backend unreachable",
        description: "Connection refused",
        variant: "destructive",
      });
    });
  });

  it("should show recovery toast when backend becomes reachable again", async () => {
    // Start with failing backend
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Down");
      }
      return { ok: true, status: 200 } as Response;
    });
    
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    // First ping happens immediately on mount and fails
    await waitFor(() => {
      expect(result.current.backendReachable).toBe(false);
    });

    mockToast.mockClear();

    // Second ping succeeds after 1000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Backend reachable again",
        description: "Connection restored.",
      });
    });
  });

  it("should refetch queries when backend recovers", async () => {
    // Start unreachable
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Down");
      }
      return { ok: true, status: 200 } as Response;
    });
    
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    // First ping happens immediately on mount and fails
    await waitFor(() => {
      expect(result.current.backendReachable).toBe(false);
    });

    // Second ping succeeds after 1000ms
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockRefetchQueries).toHaveBeenCalledWith({
        queryKey: ["/api/sketches"],
      });
    });
  });

  it("should handle HTTP error status codes", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.backendReachable).toBe(false);
      expect(result.current.backendPingError).toContain("HTTP 503");
    });
  });

  it("should timeout health checks after 800ms", async () => {
    // Mock a slow response that never resolves
    fetchSpy.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useBackendHealth(mockQueryClient));

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    // Fetch should have been aborted
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("should show toast for WebSocket connection error", () => {
    mockUseWebSocket.mockReturnValue({
      isConnected: false,
      connectionError: "WebSocket connection failed",
      hasEverConnected: false,
    });

    renderHook(() => useBackendHealth(mockQueryClient));

    expect(mockToast).toHaveBeenCalledWith({
      title: "Backend unreachable",
      description: "WebSocket connection failed",
      variant: "destructive",
    });
  });

  it("should show toast when WebSocket connection is lost", () => {
    mockUseWebSocket.mockReturnValue({
      isConnected: false,
      connectionError: null,
      hasEverConnected: true,
    });

    renderHook(() => useBackendHealth(mockQueryClient));

    expect(mockToast).toHaveBeenCalledWith({
      title: "Connection lost",
      description: "Trying to re-establish backend connection...",
      variant: "destructive",
    });
  });

  it("ensureBackendConnected should return false when backend unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("Down"));

    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.backendReachable).toBe(false);
    });

    mockToast.mockClear();

    const isConnected = result.current.ensureBackendConnected("Test action");

    expect(isConnected).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backend unreachable",
        variant: "destructive",
      }),
    );
  });

  it("ensureBackendConnected should return false when WebSocket disconnected", () => {
    mockUseWebSocket.mockReturnValue({
      isConnected: false,
      connectionError: "WS error",
      hasEverConnected: true,
    });

    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    const isConnected = result.current.ensureBackendConnected("Compile");

    expect(isConnected).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Backend unreachable",
        description: expect.stringContaining("WS error"),
        variant: "destructive",
      }),
    );
  });

  it("ensureBackendConnected should return true when backend reachable", () => {
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    const isConnected = result.current.ensureBackendConnected("Test");

    expect(isConnected).toBe(true);
  });

  it("isBackendUnreachableError should detect network errors", () => {
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    expect(
      result.current.isBackendUnreachableError(new Error("Failed to fetch")),
    ).toBe(true);

    expect(
      result.current.isBackendUnreachableError(new Error("NetworkError occurred")),
    ).toBe(true);

    expect(
      result.current.isBackendUnreachableError(new Error("ERR_CONNECTION_REFUSED")),
    ).toBe(true);

    expect(
      result.current.isBackendUnreachableError(new Error("Network request failed")),
    ).toBe(true);

    expect(
      result.current.isBackendUnreachableError(new Error("Some other error")),
    ).toBe(false);
  });

  it("triggerErrorGlitch should show and hide glitch effect", async () => {
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    expect(result.current.showErrorGlitch).toBe(false);

    // Fix: All state changes inside act
    await act(async () => {
      result.current.triggerErrorGlitch(600);
    });

    expect(result.current.showErrorGlitch).toBe(true);

    // Wait for effect to disappear using act timer advance
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.showErrorGlitch).toBe(false);
  });

  it("triggerErrorGlitch should use custom duration", () => {
    const { result } = renderHook(() => useBackendHealth(mockQueryClient));

    act(() => {
      result.current.triggerErrorGlitch(1200);
    });

    expect(result.current.showErrorGlitch).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Still showing after 600ms
    expect(result.current.showErrorGlitch).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Hidden after 1200ms total
    expect(result.current.showErrorGlitch).toBe(false);
  });

  it("should cleanup interval on unmount", () => {
    const { unmount } = renderHook(() => useBackendHealth(mockQueryClient));

    const callsBefore = fetchSpy.mock.calls.length;

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // No new calls after unmount
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it("should not update state after unmount", async () => {
    fetchSpy.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true } as Response), 100)),
    );

    const { result, unmount } = renderHook(() => useBackendHealth(mockQueryClient));

    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // State should not change after unmount (no errors thrown)
    expect(result.current.backendReachable).toBe(true);
  });
});
