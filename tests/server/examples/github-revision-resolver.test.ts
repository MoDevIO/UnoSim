import { describe, expect, it, vi } from "vitest";
import { GitHubRevisionResolver } from "../../../server/services/examples/github-revision-resolver";

const revision = "a".repeat(40);

describe("GitHub revision resolver", () => {
  it("resolves a movable ref through the credential-free public commits API", async () => {
    const fetchText = vi.fn(async () => JSON.stringify({ sha: revision }));
    const resolver = new GitHubRevisionResolver({ fetchText });
    await expect(resolver.resolve("owner/repo", "main", { identity: "user", requestId: "request" }))
      .resolves.toBe(revision);
    expect(fetchText).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/owner/repo/commits/main"),
      expect.any(Number),
      undefined,
    );
  });

  it("maps unknown refs and malformed revisions to a stable error", async () => {
    const unavailable = new GitHubRevisionResolver({ fetchText: vi.fn(async () => { throw new Error("404"); }) });
    await expect(unavailable.resolve("owner/repo", "missing", { identity: "user", requestId: "request" }))
      .rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    const malformed = new GitHubRevisionResolver({ fetchText: vi.fn(async () => JSON.stringify({ sha: "short" })) });
    await expect(malformed.resolve("owner/repo", "main", { identity: "user", requestId: "request" }))
      .rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});
