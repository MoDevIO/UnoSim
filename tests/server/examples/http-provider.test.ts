import dns from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecureExamplesFetcher, validateSourceUrl } from "../../../server/services/examples/http-provider";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn().mockResolvedValue([{ address: "140.82.121.3" }]) },
}));

describe("secure external examples fetcher", () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "140.82.121.3", family: 4 }] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows only HTTPS allowlisted hosts without credentials", () => {
    expect(validateSourceUrl("https://api.github.com/repos/owner/repo/commits/main").hostname).toBe("api.github.com");
    expect(() => validateSourceUrl("http://api.github.com/repos/owner/repo")).toThrow(/HTTPS/);
    expect(() => validateSourceUrl("https://user:secret@api.github.com/repos/owner/repo")).toThrow(/Invalid/);
    expect(() => validateSourceUrl("https://example.test/owner/repo")).toThrow(/allowlisted/);
    expect(() => validateSourceUrl("https://127.0.0.1/owner/repo")).toThrow(/IP literal/);
  });

  it("rejects redirects and private DNS targets", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = new SecureExamplesFetcher();
    await expect(fetcher.fetchText(new URL("https://api.github.com/test"), 100)).rejects.toThrow(/Redirects/);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.not.objectContaining({ headers: expect.anything() }));
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(fetcher.fetchText(new URL("https://api.github.com/test"), 100)).rejects.toThrow(/private or reserved/);
  });

  it("enforces declared and streamed response size limits", async () => {
    const fetcher = new SecureExamplesFetcher();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("small", { headers: { "content-length": "101" } })));
    await expect(fetcher.fetchText(new URL("https://api.github.com/test"), 100)).rejects.toThrow(/size limit/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(101))));
    await expect(fetcher.fetchText(new URL("https://api.github.com/test"), 100)).rejects.toThrow(/size limit/);
  });

  it("aborts an outbound request at the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = new SecureExamplesFetcher().fetchText(new URL("https://api.github.com/test"), 100);
    const rejection = expect(pending).rejects.toThrow(/Aborted/);
    await vi.advanceTimersByTimeAsync(5_001);
    await rejection;
  });
});
