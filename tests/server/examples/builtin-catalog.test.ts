import { describe, expect, it, vi } from "vitest";
import { ExamplesRepository } from "../../../server/services/examples/examples-repository";

describe("independent built-in catalog", () => {
  it("lists local examples without starting a failing or hanging external operation", async () => {
    const resolve = vi.fn(async () => { throw new Error("GitHub unavailable"); });
    const getRevision = vi.fn(() => new Promise<never>(() => undefined));
    const repository = new ExamplesRepository({
      builtInProvider: { getExamples: async () => ["blink", "input"].map(id => ({
        id: `builtin-${id}`, title: id, category: "Built-in", main: `${id}.ino`, source: "builtin" as const,
        files: [{ name: `${id}.ino`, path: `${id}.ino`, content: "void setup(){} void loop(){}" }],
      })) },
      sourceProvider: { resolve, getRevision },
    });
    const catalog = await repository.getBuiltInCatalog();
    expect(catalog.source).toMatchObject({ mode: "builtin", repository: null, ref: null, revision: null, status: "builtin", stale: false });
    expect(catalog.examples.map(e => e.id)).toEqual(["builtin-blink", "builtin-input"]);
    expect(catalog.examples[0].files[0]).not.toHaveProperty("content");
    expect(resolve).not.toHaveBeenCalled(); expect(getRevision).not.toHaveBeenCalled();
  });
});
