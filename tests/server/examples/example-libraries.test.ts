import { describe, expect, it, vi } from "vitest";
import { ExamplesRepository } from "../../../server/services/examples/examples-repository";

const AUNIT = { name: "AUnit", version: "1.7.1" };

describe("library requirements in the examples API (SSOT Libraries §8.2)", () => {
  const repository = new ExamplesRepository({
    builtInProvider: { getExamples: async () => [
      { id: "builtin-tests", title: "tests", category: "x", main: "t.ino", source: "builtin" as const, files: [{ name: "t.ino", path: "t.ino", content: "x" }], libraries: [AUNIT] },
      { id: "builtin-blink", title: "blink", category: "x", main: "b.ino", source: "builtin" as const, files: [{ name: "b.ino", path: "b.ino", content: "x" }] },
    ] },
    sourceProvider: { resolve: vi.fn(), getRevision: vi.fn() },
  });

  it("travel through catalog and detail unchanged", async () => {
    const catalog = await repository.getBuiltInCatalog();
    const detail = await repository.getExample(undefined, undefined, "builtin-tests", {} as never);

    expect(catalog.examples[0].libraries).toEqual([AUNIT]);
    expect(detail?.libraries).toEqual([AUNIT]);
  });

  it("are absent for an example without requirements", async () => {
    const detail = await repository.getExample(undefined, undefined, "builtin-blink", {} as never);

    expect(detail).not.toHaveProperty("libraries");
  });
});
