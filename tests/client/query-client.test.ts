import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, queryClient } from "../../client/src/lib/queryClient";

describe("queryClient / apiRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Ensure window is defined (browser environment)
    if (!globalThis.window) {
      vi.stubGlobal("window", {});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("apiRequest", () => {
    it("returns response when request is OK", async () => {
      const mockResponse = { ok: true, status: 200, text: vi.fn(() => Promise.resolve("OK")) };
      fetchMock.mockResolvedValue(mockResponse);

      const result = await apiRequest("GET", "/api/test");

      expect(fetchMock).toHaveBeenCalledWith("/api/test", {
        method: "GET",
        headers: {},
        body: undefined,
        credentials: "include",
      });
      expect(result).toBe(mockResponse);
    });

    it("sends JSON body and Content-Type header when data is provided", async () => {
      const mockResponse = { ok: true, status: 200, text: vi.fn() };
      fetchMock.mockResolvedValue(mockResponse);

      const payload = { code: "void setup() {}" };
      await apiRequest("POST", "/api/compile", payload);

      expect(fetchMock).toHaveBeenCalledWith("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
    });

    it("throws when response is not OK (4xx)", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn(() => Promise.resolve("Resource not found")),
      };
      fetchMock.mockResolvedValue(mockResponse);

      await expect(apiRequest("GET", "/api/missing")).rejects.toThrow("404: Resource not found");
    });

    it("uses statusText when response body is empty", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn(() => Promise.resolve("")),
      };
      fetchMock.mockResolvedValue(mockResponse);

      await expect(apiRequest("GET", "/api/error")).rejects.toThrow(
        "500: Internal Server Error",
      );
    });

    it("includes x-test-run-id header when sessionStorage has __TEST_RUN_ID__", async () => {
      const mockSessionStorage = {
        getItem: vi.fn((key: string) => (key === "__TEST_RUN_ID__" ? "test-run-123" : null)),
      };
      vi.stubGlobal("sessionStorage", mockSessionStorage);

      const mockResponse = { ok: true, status: 200, text: vi.fn() };
      fetchMock.mockResolvedValue(mockResponse);

      await apiRequest("GET", "/api/test");

      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers["x-test-run-id"]).toBe("test-run-123");
    });

    it("skips x-test-run-id when sessionStorage is unavailable", async () => {
      // Make sessionStorage.getItem throw
      const mockSessionStorage = {
        getItem: vi.fn(() => { throw new Error("sessionStorage unavailable"); }),
      };
      vi.stubGlobal("sessionStorage", mockSessionStorage);

      const mockResponse = { ok: true, status: 200, text: vi.fn() };
      fetchMock.mockResolvedValue(mockResponse);

      // Should not throw
      await expect(apiRequest("GET", "/api/test")).resolves.toBeDefined();
    });

    it("does not add x-test-run-id header when sessionStorage has no __TEST_RUN_ID__", async () => {
      const mockSessionStorage = { getItem: vi.fn(() => null) };
      vi.stubGlobal("sessionStorage", mockSessionStorage);

      const mockResponse = { ok: true, status: 200, text: vi.fn() };
      fetchMock.mockResolvedValue(mockResponse);

      await apiRequest("GET", "/api/test");

      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers["x-test-run-id"]).toBeUndefined();
    });
  });

  describe("queryClient", () => {
    it("queryClient is created with correct default options", () => {
      expect(queryClient).toBeDefined();
      const options = queryClient.getDefaultOptions();
      expect(options.queries?.retry).toBe(false);
      expect(options.queries?.refetchInterval).toBe(false);
      expect(options.queries?.refetchOnWindowFocus).toBe(false);
      expect(options.queries?.staleTime).toBe(Infinity);
      expect(options.mutations?.retry).toBe(false);
    });
  });

  describe("getQueryFn (via queryClient)", () => {
    it("default queryFn throws on non-OK responses", async () => {
      const mockResponse = {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: vi.fn(() => Promise.resolve("Access denied")),
      };
      fetchMock.mockResolvedValue(mockResponse);

      const queryFn = queryClient.getDefaultOptions().queries?.queryFn as any;
      expect(queryFn).toBeDefined();

      await expect(
        queryFn({ queryKey: ["/api/data"], signal: new AbortController().signal }),
      ).rejects.toThrow("403");
    });

    it("default queryFn fetches and returns JSON on success", async () => {
      const jsonData = { result: "ok" };
      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn(),
        json: vi.fn(() => Promise.resolve(jsonData)),
      };
      fetchMock.mockResolvedValue(mockResponse);

      const queryFn = queryClient.getDefaultOptions().queries?.queryFn as any;
      const result = await queryFn({
        queryKey: ["/api", "data"],
        signal: new AbortController().signal,
      });

      expect(result).toEqual(jsonData);
      expect(fetchMock).toHaveBeenCalledWith("/api/data", { credentials: "include" });
    });
  });
});
