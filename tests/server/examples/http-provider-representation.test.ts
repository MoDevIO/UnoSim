import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../server/config";
import { SecureExamplesFetcher } from "../../../server/services/examples/http-provider";
import { GitHubRevisionResolver } from "../../../server/services/examples/github-revision-resolver";

vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn().mockResolvedValue([{ address: "140.82.121.3", family: 4 }]) } }));
const sha = "a".repeat(40);
const url = new URL("https://api.github.com/repos/owner/repo/commits/main");
const options = { representation: "github-commit-sha" } as const;
const originalToken = config.examples.githubToken;

afterEach(() => {
  vi.unstubAllGlobals();
  config.examples.githubToken = originalToken;
  vi.mocked(dns.lookup).mockResolvedValue([{ address: "140.82.121.3", family: 4 }] as never);
});

describe("GitHub SHA HTTP representation", () => {
  it("resolves a SHA even when the alternative JSON commit exceeds the manifest budget", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(
      new Headers(init?.headers).get("accept") === "application/vnd.github.sha" ? sha : JSON.stringify({ sha, patch: "x".repeat(300_000) }),
    ));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new GitHubRevisionResolver(new SecureExamplesFetcher()).resolve("owner/repo", "main", { identity: "user", requestId: "request" })).resolves.toBe(sha);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("accept")).toBe("application/vnd.github.sha");
  });

  it.each(["https://raw.githubusercontent.com/owner/repo/main/file.ino", "https://api.github.com/rate_limit"])("refuses the SHA representation outside a commit URL: %s", async (input) => {
    const fetchMock = vi.fn(async () => new Response(sha));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SecureExamplesFetcher().fetchText(new URL(input), 256, undefined, options)).rejects.toThrow(/representation/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combines the SHA header with the API token without forwarding either to raw content", async () => {
    config.examples.githubToken = "test-token";
    const fetchMock = vi.fn(async () => new Response(sha));
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = new SecureExamplesFetcher();
    await fetcher.fetchText(url, 256, undefined, options);
    await fetcher.fetchText(new URL("https://raw.githubusercontent.com/owner/repo/main/file.ino"), 256);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("accept")).toBe("application/vnd.github.sha");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer test-token");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("accept")).toBe(false);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("authorization")).toBe(false);
  });

  it.each([true, false])("identifies oversized SHA responses (content-length: %s)", async (declared) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(257), declared ? { headers: { "content-length": "257" } } : undefined)));
    await expect(new SecureExamplesFetcher().fetchText(url, 256, undefined, options)).rejects.toMatchObject({ name: "ExamplesResponseTooLargeError" });
  });

  it("does not send an already-aborted SHA request", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchMock = vi.fn(async () => new Response(sha)); vi.stubGlobal("fetch", fetchMock);
    await expect(new SecureExamplesFetcher().fetchText(url, 256, controller.signal, options)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
