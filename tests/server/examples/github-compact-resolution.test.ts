import { describe, expect, it, vi } from "vitest";
import { Logger } from "@shared/logger";
import { GitHubRevisionResolver } from "../../../server/services/examples/github-revision-resolver";

const sha = "a".repeat(40);
const context = { identity: "user", requestId: "diagnostic-request" };

describe("compact GitHub revision resolution", () => {
  it.each(["main", "v1.2.3", sha])("requests a bounded SHA representation for %s", async (ref) => {
    const fetchText = vi.fn(async () => `${sha}\n`);
    await expect(new GitHubRevisionResolver({ fetchText }).resolve("owner/repo", ref, context)).resolves.toBe(sha);
    expect(fetchText).toHaveBeenCalledWith(new URL(`https://api.github.com/repos/owner/repo/commits/${ref}`), 256, undefined, { representation: "github-commit-sha" });
  });

  it.each(["short", "A".repeat(40), "a".repeat(257), JSON.stringify({ sha })])("rejects malformed SHA text without a JSON fallback", async (text) => {
    const fetchText = vi.fn(async () => text);
    await expect(new GitHubRevisionResolver({ fetchText }).resolve("owner/repo", "main", context)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(fetchText).toHaveBeenCalledOnce();
  });

  it("records safe diagnostics without copying an upstream secret", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const fetchText = vi.fn(async () => { throw new Error("upstream-secret-content"); });
      await expect(new GitHubRevisionResolver({ fetchText }).resolve("owner/repo", "main", context)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("resolve-ref"));
      expect(warn.mock.calls.flat().join(" ")).toContain(context.requestId);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("upstream-secret-content");
    } finally { warn.mockRestore(); }
  });
});
