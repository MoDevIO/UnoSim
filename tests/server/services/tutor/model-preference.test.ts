import { describe, expect, it } from "vitest";
import { parseTutorAutoModels, rankTutorModels } from "../../../../server/services/tutor/model-preference";

const PROVIDER_LIST = [
  "mistralai-mistral-small-4-119b-2603",
  "openai-gpt-oss-120b",
  "openai-gpt5.4-mini",
  "openai-gpt5.5",
  "glm-4.7",
  "qwen3.5-397b-a17b",
  "qwen3-omni-30b-a3b-instruct",
  "qwen-qwen3-embedding-8b",
  "e5-mistral-7b-instruct",
];

describe("rankTutorModels", () => {
  it("takes the operator's configured models first, in the configured order, when the provider lists them", () => {
    expect(rankTutorModels(PROVIDER_LIST, ["not-offered", "openai-gpt5.5", "mistralai-mistral-small-4-119b-2603"]).slice(0, 3)).toEqual([
      "openai-gpt5.5",
      "mistralai-mistral-small-4-119b-2603",
      "openai-gpt-oss-120b",
    ]);
  });

  it("prefers no model family by itself: without a configuration the provider's order applies", () => {
    expect(rankTutorModels(PROVIDER_LIST, [])[0]).toBe("mistralai-mistral-small-4-119b-2603");
    expect(rankTutorModels(["qwen3-omni-30b-a3b-instruct", "openai-gpt5.5"], [])[0]).toBe("qwen3-omni-30b-a3b-instruct");
    expect(rankTutorModels(["openai-gpt5.5", "qwen3-omni-30b-a3b-instruct"], [])[0]).toBe("openai-gpt5.5");
  });

  it("never chooses an embedding model automatically, even when its name says instruct", () => {
    const ranked = rankTutorModels(["e5-mistral-7b-instruct", "qwen-qwen3-embedding-8b", "glm-4.7"], []);
    expect(ranked).toEqual(["glm-4.7"]);
    expect(rankTutorModels(["e5-mistral-7b-instruct", "text-embedding-3"], [])).toEqual([]);
  });

  it("selects only IDs of the current provider response", () => {
    expect(rankTutorModels([], ["openai-gpt5.5"])).toEqual([]);
  });
});

describe("parseTutorAutoModels", () => {
  it("reads comma-separated exact model IDs and rejects invalid, duplicate or too many entries", () => {
    expect(parseTutorAutoModels(undefined)).toEqual([]);
    expect(parseTutorAutoModels(" openai-gpt5.5 , mistralai-mistral-small-4-119b-2603,")).toEqual(["openai-gpt5.5", "mistralai-mistral-small-4-119b-2603"]);
    expect(() => parseTutorAutoModels("bad model")).toThrow(/no model ID/);
    expect(() => parseTutorAutoModels("a,a")).toThrow(/twice/);
    expect(() => parseTutorAutoModels(Array.from({ length: 17 }, (_, index) => `m${index}`).join(","))).toThrow(/at most 16/);
  });
});
