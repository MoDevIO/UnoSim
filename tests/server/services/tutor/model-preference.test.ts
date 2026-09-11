import { describe, expect, it } from "vitest";
import { rankTutorModels } from "../../../../server/services/tutor/model-preference";

describe("rankTutorModels", () => {
  it("prefers available Qwen family IDs without depending on one exact deployment name", () => {
    expect(rankTutorModels([
      "mistralai-mistral-small-2503",
      "qwen2.5-72b-instruct",
      "qwen3-coder",
    ])).toEqual([
      "qwen2.5-72b-instruct",
      "qwen3-coder",
      "mistralai-mistral-small-2503",
    ]);
  });

  it("falls back to the next suitable instruction/reasoning family", () => {
    expect(rankTutorModels([
      "mistral-small",
      "generic-instruct-model",
      "base-model",
    ])).toEqual([
      "generic-instruct-model",
      "mistral-small",
      "base-model",
    ]);
  });

  it("keeps provider order for equal preference scores", () => {
    expect(rankTutorModels(["first-model", "second-model"])).toEqual([
      "first-model",
      "second-model",
    ]);
  });
});
