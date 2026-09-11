import { describe, expect, it } from "vitest";
import {
  normalizeRepositoryInput,
  resolveExamplesSelection,
  toGithubRawRepositoryBase,
} from "../../../server/services/examples/source-selection";

describe("external examples source selection", () => {
  it("normalizes supported public GitHub forms", () => {
    expect(normalizeRepositoryInput("Owner/Repo")).toBe("owner/repo");
    expect(normalizeRepositoryInput("https://github.com/Owner/Repo.git/")).toBe("owner/repo");
    expect(normalizeRepositoryInput("https://raw.githubusercontent.com/Owner/Repo", { allowRawGithub: true })).toBe("owner/repo");
    expect(normalizeRepositoryInput("https://raw.githubusercontent.com/Owner/Repo")).toBeNull();
    expect(normalizeRepositoryInput("https://github.com/owner/repo/tree/main")).toBeNull();
    expect(normalizeRepositoryInput("https://example.test/owner/repo")).toBeNull();
    expect(toGithubRawRepositoryBase("owner/repo").href).toBe("https://raw.githubusercontent.com/owner/repo/");
  });

  it("keeps default and browser selection request-scoped", () => {
    const defaults = { mode: "repository-ref" as const, repository: "default/repo", ref: "main" };
    expect(resolveExamplesSelection({ kind: "default" }, defaults)).toEqual({
      selection: "default", mode: "repository-ref", repository: "default/repo", ref: "main",
    });
    expect(resolveExamplesSelection({ kind: "browser-override", repository: "other/repo", ref: "preview" }, defaults)).toEqual({
      selection: "browser-override", mode: "repository-ref", repository: "other/repo", ref: "preview",
    });
  });
});
