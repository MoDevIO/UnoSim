import { describe, expect, it } from "vitest";
import { DEFAULT_TUTOR_AUTO_MODELS, automaticTutorModels, parseTutorAutoModels } from "../../../../server/services/tutor/model-preference";

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

describe("automaticTutorModels", () => {
  it("offers only the operator's approved models, in the approved order, when the provider lists them", () => {
    expect(automaticTutorModels(PROVIDER_LIST, ["not-offered", "openai-gpt5.5", "mistralai-mistral-small-4-119b-2603"])).toEqual([
      "openai-gpt5.5",
      "mistralai-mistral-small-4-119b-2603",
    ]);
  });

  it("never falls back to an unapproved model, whatever the provider offers (review of 51982e4ac)", () => {
    expect(automaticTutorModels(["openai-gpt5.4-mini"], ["openai-gpt5.5"])).toEqual([]);
    expect(automaticTutorModels(PROVIDER_LIST, [])).toEqual([]);
    expect(automaticTutorModels([], ["openai-gpt5.5"])).toEqual([]);
  });

  it("never chooses an embedding model even when the operator lists it (review F5)", () => {
    expect(automaticTutorModels(PROVIDER_LIST, ["e5-mistral-7b-instruct", "openai-gpt5.4-mini"])).toEqual(["openai-gpt5.4-mini"]);
    expect(automaticTutorModels(PROVIDER_LIST, ["qwen-qwen3-embedding-8b"])).toEqual([]);
  });
});

describe("parseTutorAutoModels", () => {
  it("defaults to the model that passed the live comparison; an empty value turns Automatic off", () => {
    expect(parseTutorAutoModels(undefined)).toEqual(DEFAULT_TUTOR_AUTO_MODELS);
    expect(DEFAULT_TUTOR_AUTO_MODELS).toEqual(["openai-gpt5.5"]);
    expect(parseTutorAutoModels("")).toEqual([]);
    expect(parseTutorAutoModels(" , ")).toEqual([]);
  });

  it("reads comma-separated exact model IDs and rejects invalid, duplicate or too many entries", () => {
    expect(parseTutorAutoModels(" openai-gpt5.5 , mistralai-mistral-small-4-119b-2603,")).toEqual(["openai-gpt5.5", "mistralai-mistral-small-4-119b-2603"]);
    expect(() => parseTutorAutoModels("bad model")).toThrow(/no model ID/);
    expect(() => parseTutorAutoModels("e5-mistral-7b-instruct,openai-gpt5.4-mini")).toThrow(/no chat model/);
    expect(() => parseTutorAutoModels("a,a")).toThrow(/twice/);
    expect(() => parseTutorAutoModels(Array.from({ length: 17 }, (_, index) => `m${index}`).join(","))).toThrow(/at most 16/);
  });
});
