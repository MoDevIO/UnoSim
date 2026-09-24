import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";

const revision = "a".repeat(40);

async function pilotTopic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

function adapter(topics: Awaited<ReturnType<typeof pilotTopic>>[], bindings = new Map()) {
  return new CurriculumTutorAdapter({
    courseContent: {
      getSnapshot: async () => ({
        revision,
        tutor: {
          status: "valid" as const,
          manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
          topics,
          strategies: [],
          bindings,
        },
      }),
    },
  });
}

describe("Tutor topic precedence", () => {
  it("chooses an applicable active-example primary topic first", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const result = await adapter([memory, arrays], new Map([[
      "example",
      { topics: ["arrays", "memory-and-data-types"], primaryTopic: "memory-and-data-types" },
    ]])).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, exampleId: "example" });
    expect(result?.topicId).toBe("memory-and-data-types");
  });

  it("uses other bound topics before fact-matched repository topics", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const result = await adapter([memory, arrays], new Map([[
      "example",
      { topics: ["memory-and-data-types", "arrays"] },
    ]])).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, exampleId: "example" });
    expect(result?.topicId).toBe("memory-and-data-types");
  });

  it("falls back to fact matching and then to free Tutor when no bound topic applies", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const factMatch = await adapter([memory, arrays]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(factMatch?.topicId).toBe("arrays");

    const noMatch = await adapter([memory]).planInitial({ code: "void setup(){} void loop(){}", history: [], difficulty: 30 });
    expect(noMatch).toBeNull();
  });
});
