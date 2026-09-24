import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_TUTOR_STRATEGY } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";

const revision = "a".repeat(40);

async function topic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

function strategy(id: string) {
  return { ...BUILT_IN_TUTOR_STRATEGY, id };
}

describe("Tutor strategy precedence", () => {
  it("chooses per-example strategy over repository default", async () => {
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, defaultStrategy: "repository-default", topics: [], strategies: [] },
            topics: [await topic()],
            strategies: [strategy("repository-default"), strategy("example-policy")],
            bindings: new Map([["arrays-example", { strategy: "example-policy" }]]),
          },
        }),
      },
    });

    await expect(adapter.planInitial({
      code: "int values[] = {1, 2};",
      history: [],
      difficulty: 30,
      exampleId: "arrays-example",
    })).resolves.toMatchObject({ strategyId: "example-policy", strategySource: "repository" });
  });

  it("uses repository default for unbound sketches and built-in for no strategy", async () => {
    const tutor = await topic();
    const repositoryDefault = strategy("repository-default");
    const makeAdapter = (strategies: typeof repositoryDefault[]) => new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, defaultStrategy: strategies[0]?.id, topics: [], strategies: [] },
            topics: [tutor],
            strategies,
            bindings: new Map(),
          },
        }),
      },
    });

    await expect(makeAdapter([repositoryDefault]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ strategyId: "repository-default", strategySource: "repository" });
    await expect(makeAdapter([]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ strategyId: "built-in-default", strategySource: "built-in" });
  });
});
