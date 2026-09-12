import { describe, expect, it } from "vitest";
import {
  examplesRefSchema,
  fullCommitShaSchema,
  repositorySlugSchema,
  validateExamplesRequestSchema,
} from "../../shared/examples";

describe("external examples shared contract", () => {
  it("accepts only canonical repository slugs", () => {
    expect(repositorySlugSchema.safeParse("owner/repository").success).toBe(true);
    expect(repositorySlugSchema.safeParse(`${"a".repeat(39)}/${"r".repeat(100)}`).success).toBe(true);
    for (const value of ["Owner/repo", "owner/repo.git", "owner/..", "ow--ner/repo", "owner/repo/extra", "owner /repo"]) {
      expect(repositorySlugSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("enforces ref and revision syntax", () => {
    for (const value of ["main", "release-1", "V1.2.0", "a".repeat(128)]) {
      expect(examplesRefSchema.safeParse(value).success, value).toBe(true);
    }
    for (const value of ["", "-bad", "feature/path", "a".repeat(129), "ä"]) {
      expect(examplesRefSchema.safeParse(value).success, value).toBe(false);
    }
    expect(fullCommitShaSchema.safeParse("a".repeat(40)).success).toBe(true);
    expect(fullCommitShaSchema.safeParse("A".repeat(40)).success).toBe(false);
  });

  it("rejects unknown or partial validate fields", () => {
    expect(validateExamplesRequestSchema.safeParse({
      schemaVersion: 1,
      selection: { repository: "owner/repo", ref: "main", rawUrl: "https://example.test" },
    }).success).toBe(false);
    expect(validateExamplesRequestSchema.safeParse({
      schemaVersion: 1,
      selection: { repository: "owner/repo" },
    }).success).toBe(false);
  });
});
