import dns from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../server/config";
import { GitHubApiBudget, GITHUB_DEFAULT_SOURCE_RESERVE, githubApiBudget } from "../../../server/services/examples/github-api-budget";
import { GitHubRevisionResolver } from "../../../server/services/examples/github-revision-resolver";
import { SecureExamplesFetcher } from "../../../server/services/examples/http-provider";
import { ExamplesCache } from "../../../server/services/examples/examples-cache";
import { ExamplesLoadController } from "../../../server/services/examples/examples-load-controller";
import { SourceProvider } from "../../../server/services/examples/source-provider";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn().mockResolvedValue([{ address: "140.82.121.3" }]) },
}));

const revision = "a".repeat(40);
const context = { identity: "learner", requestId: "request" };
const nowMs = 1_800_000_000_000;

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("GitHub API budget", () => {
  it("blocks every call until the announced reset once GitHub reports exhaustion", () => {
    let now = nowMs;
    const budget = new GitHubApiBudget(() => now);
    budget.observe(403, headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(nowMs / 1000 + 900) }));

    expect(() => budget.assertMayCall("default")).toThrow(expect.objectContaining({ code: "RATE_LIMITED", retryAfterSeconds: 900 }));
    now = nowMs + 900_000;
    expect(() => budget.assertMayCall("default")).not.toThrow();
  });

  it("honours Retry-After for secondary limits", () => {
    const budget = new GitHubApiBudget(() => nowMs);
    budget.observe(429, headers({ "retry-after": "120" }));
    expect(() => budget.assertMayCall("default")).toThrow(expect.objectContaining({ retryAfterSeconds: 120 }));
  });

  it("keeps a reserve for the default source that overrides cannot spend", () => {
    const budget = new GitHubApiBudget(() => nowMs);
    budget.observe(200, headers({
      "x-ratelimit-remaining": String(GITHUB_DEFAULT_SOURCE_RESERVE),
      "x-ratelimit-reset": String(nowMs / 1000 + 600),
    }));

    expect(() => budget.assertMayCall("override")).toThrow(expect.objectContaining({ code: "RATE_LIMITED", retryAfterSeconds: 600 }));
    expect(() => budget.assertMayCall("default")).not.toThrow();
  });

  it("caps an implausible reset at one hour", () => {
    const budget = new GitHubApiBudget(() => nowMs);
    budget.observe(403, headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(nowMs / 1000 + 86_400) }));
    expect(budget.blockedForMs()).toBe(60 * 60 * 1000);
  });
});

describe("GitHub revision resolution under a rate limit", () => {
  it("sends no request while blocked and reports RATE_LIMITED with the remaining wait", async () => {
    const budget = new GitHubApiBudget(() => nowMs);
    budget.observe(403, headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(nowMs / 1000 + 300) }));
    const fetchText = vi.fn(async () => JSON.stringify({ sha: revision }));
    const resolver = new GitHubRevisionResolver({ fetchText }, budget);

    await expect(resolver.resolve("owner/repo", "main", context)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 300 });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("does not retry a rate-limited source before the reset, while the last good snapshot stays served", async () => {
    let now = nowMs;
    const budget = new GitHubApiBudget(() => now);
    let exhausted = false;
    const fetchText = vi.fn(async () => {
      if (!exhausted) return JSON.stringify({ sha: revision });
      budget.observe(403, headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 1_800) }));
      throw new Error("Examples source returned 403");
    });
    const cache = new ExamplesCache({ maxSources: 4, maxSnapshots: 4, maxSnapshotBytes: 10_000, now: () => now });
    const loads = new ExamplesLoadController({ maxConcurrentLoads: 2, maxLoadQueue: 2, maxOutboundFetches: 4, globalLoadStartsPerMinute: 60, now: () => now });
    const loader = { load: vi.fn(async () => ({ contentBytes: 1, examples: [] })) };
    const provider = new SourceProvider(new GitHubRevisionResolver({ fetchText }, budget), loader, cache, loads, {
      refreshMs: 100, refreshRetryMs: 30, now: () => now,
    });

    await provider.resolve("owner/repo", "main", context, false);
    exhausted = true;
    now += 101;
    await expect(provider.resolve("owner/repo", "main", context, false)).resolves.toMatchObject({ revision, stale: true });
    // The plain retry interval (30 ms) has passed many times, the GitHub reset has not.
    for (const step of [31, 60_000, 1_700_000]) {
      now = nowMs + 101 + step;
      await provider.resolve("owner/repo", "main", context, false);
    }
    expect(fetchText).toHaveBeenCalledTimes(2);
  });
});

describe("optional GitHub token", () => {
  const originalToken = config.examples.githubToken;

  beforeEach(() => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: "140.82.121.3", family: 4 }] as never);
  });

  afterEach(() => {
    config.examples.githubToken = originalToken;
    vi.unstubAllGlobals();
  });

  it("is sent to api.github.com only and the response updates the shared budget", async () => {
    config.examples.githubToken = "test-token-not-real";
    const fetchMock = vi.fn(async () => new Response("{}", {
      headers: { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3_600) },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = new SecureExamplesFetcher();

    await fetcher.fetchText(new URL("https://api.github.com/repos/owner/repo/commits/main"), 100);
    await fetcher.fetchText(new URL("https://raw.githubusercontent.com/owner/repo/abc/manifest.json"), 100);

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.any(URL), expect.objectContaining({
      headers: { authorization: "Bearer test-token-not-real" },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.any(URL), expect.not.objectContaining({ headers: expect.anything() }));
    expect(() => githubApiBudget.assertMayCall("override")).not.toThrow();
  });

  it("is optional and validated when configured", async () => {
    const { parseExamplesConfig } = await import("../../../server/config");
    expect(parseExamplesConfig({})).not.toHaveProperty("githubToken");
    expect(parseExamplesConfig({ UNOSIM_GITHUB_TOKEN: "  ghp_abc123  " })).toMatchObject({ githubToken: "ghp_abc123" });
    expect(() => parseExamplesConfig({ UNOSIM_GITHUB_TOKEN: "bad\r\ntoken" })).toThrow(/UNOSIM_GITHUB_TOKEN/);
  });
});
