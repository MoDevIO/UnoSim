import { describe, expect, it } from "vitest";
import { parseExamplesConfig } from "../../../server/config";

describe("external examples configuration", () => {
  it("uses the public default repository and main ref", () => {
    expect(parseExamplesConfig({})).toMatchObject({
      mode: "repository-ref", source: "ttbombadil/unosim-examples",
      repository: "ttbombadil/unosim-examples", ref: "main",
    });
  });

  it("normalizes supported repository forms and defaults the ref", () => {
    for (const source of [
      "Owner/Repo", "https://github.com/Owner/Repo.git/",
      "https://raw.githubusercontent.com/Owner/Repo/",
    ]) {
      expect(parseExamplesConfig({ UNOSIM_EXAMPLES_SOURCE: source })).toMatchObject({
        mode: "repository-ref", repository: "owner/repo", ref: "main",
      });
    }
  });

  it("supports an explicit built-ins-only mode and validates migration input", () => {
    expect(parseExamplesConfig({ UNOSIM_EXAMPLES_SOURCE: "", UNOSIM_EXAMPLES_REF: "" })).toMatchObject({
      mode: "builtin", repository: null, ref: "",
    });
    expect(() => parseExamplesConfig({ UNOSIM_EXAMPLES_SOURCE: "", UNOSIM_EXAMPLES_REF: "v1" })).toThrow(/SOURCE/);
    expect(() => parseExamplesConfig({ UNOSIM_EXAMPLES_SOURCE: "https://cdn.example.test/repo" })).toThrow(/GitHub/);
    expect(() => parseExamplesConfig({ UNOSIM_EXAMPLES_CHANNEL: "stable" })).toThrow(/no longer supported/);
    expect(() => parseExamplesConfig({ UNOSIM_EXAMPLES_CHANNEL: "" })).toThrow(/no longer supported/);
    expect(() => parseExamplesConfig({ UNOSIM_EXAMPLES_REF: "feature/path" })).toThrow(/ref syntax/);
  });

  it("requires a production allowlist for an external source", () => {
    expect(() => parseExamplesConfig({}, "production")).toThrow(/ALLOWED_HOSTS/);
    expect(parseExamplesConfig({
      UNOSIM_EXAMPLES_ALLOWED_HOSTS: "api.github.com,raw.githubusercontent.com",
    }, "production").mode).toBe("repository-ref");
  });

  it("validates coupled limits", () => {
    expect(() => parseExamplesConfig({
      UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS: "5", UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES: "4",
    })).toThrow(/MAX_CONCURRENT_LOADS/);
    expect(() => parseExamplesConfig({
      UNOSIM_EXAMPLES_MAX_TOTAL_BYTES: "2097152", UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES: "1048576",
    })).toThrow(/SNAPSHOT_CACHE_MAX_BYTES/);
  });

  it.each([
    ["UNOSIM_EXAMPLES_VALIDATE_RATE_LIMIT_MAX_REQUESTS", "0"],
    ["UNOSIM_EXAMPLES_OVERRIDE_RATE_LIMIT_MAX_REQUESTS", "9"],
    ["UNOSIM_EXAMPLES_GLOBAL_LOAD_STARTS_PER_MINUTE", "121"],
    ["UNOSIM_EXAMPLES_MAX_CONCURRENT_LOADS", "17"],
    ["UNOSIM_EXAMPLES_MAX_LOAD_QUEUE", "129"],
    ["UNOSIM_EXAMPLES_MAX_FILE_FETCH_CONCURRENCY", "0"],
    ["UNOSIM_EXAMPLES_MAX_OUTBOUND_FETCHES", "65"],
    ["UNOSIM_EXAMPLES_MAX_SOURCES", "257"],
    ["UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_ENTRIES", "513"],
    ["UNOSIM_EXAMPLES_SNAPSHOT_CACHE_MAX_BYTES", "536870913"],
    ["UNOSIM_EXAMPLES_REFRESH_RETRY_MS", "999"],
  ])("rejects an out-of-range %s", (key, value) => {
    expect(() => parseExamplesConfig({ [key]: value })).toThrow(key);
  });
});
