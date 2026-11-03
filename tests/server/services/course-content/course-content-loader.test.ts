import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CourseContentLoader } from "../../../../server/services/course-content/course-content-loader";

const revision = "a".repeat(40);
const example = {
  id: "arrays-example",
  title: "Arrays",
  category: "Data",
  main: "main.ino",
  files: [{ name: "main.ino", path: "examples/main.ino" }],
};

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const annotation = `/* @unosim-tutor
schemaVersion: 1
topics:
  - memory-and-data-types
primaryTopic: memory-and-data-types
strategy: repository-default
@end-unosim-tutor */`;

function fetcherFor(files: Record<string, string>) {
  const fetchText = vi.fn(async (url: URL) => {
    const body = files[url.pathname];
    if (body === undefined) throw new Error(`missing ${url.pathname}`);
    return body;
  });
  return { fetchText };
}

describe("unified Course Content loader", () => {
  it("rethrows an abort while loading optional Tutor content", async () => {
    const controller = new AbortController();
    const fetchText = vi.fn(async (url: URL, _maxBytes: number, signal?: AbortSignal) => {
      if (url.pathname.endsWith("/manifest.json")) {
        return JSON.stringify({
          schemaVersion: 2,
          examples: [example],
          tutor: { manifest: "tutor/manifest.yaml" },
        });
      }
      if (url.pathname.endsWith("/examples/main.ino")) return "void setup() {}";
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw controller.signal.reason;
    });

    await expect(new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps valid Examples when optional Tutor fetch times out with AbortError", async () => {
    const controller = new AbortController();
    const fetchText = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("/manifest.json")) {
        return JSON.stringify({
          schemaVersion: 2,
          examples: [example],
          tutor: { manifest: "tutor/manifest.yaml" },
        });
      }
      if (url.pathname.endsWith("/examples/main.ino")) return "void setup() {}";
      const timeout = new Error("request timed out");
      timeout.name = "AbortError";
      throw timeout;
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2)
      .load("owner/repo", revision, controller.signal);

    expect(controller.signal.aborted).toBe(false);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  it("loads schema-v1 Examples and reports no Tutor capability", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({ schemaVersion: 1, examples: [example] }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}",
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor.status).toBe("absent");
  });

  it("keeps valid Examples when the optional Tutor manifest is missing", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [example],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}",
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  it("isolates an invalid embedded annotation from the Examples capability", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [example],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nprompt: unsafe\n@end-unosim-tutor */\n",
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples[0]?.files[0]?.content).toBe("void setup() {}\n");
    expect(loaded.examples[0]).not.toHaveProperty("tutorAnnotation");
    expect(loaded.exampleTutorAnnotations.size).toBe(0);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  it("retains valid objectives with the built-in Tutor when no repository Tutor descriptor exists", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({ schemaVersion: 2, examples: [example] }),
      [`/owner/repo/${revision}/examples/main.ino`]: `void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\nlearningObjectives:\n  - Den Ablauf verstehen.\n@end-unosim-tutor */\n`,
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.tutor.status).toBe("absent");
    expect(loaded.exampleTutorAnnotations.get("arrays-example")?.learningObjectives).toEqual(["Den Ablauf verstehen."]);
  });

  it("invalidates Tutor capability when a secondary file contains a Tutor block", async () => {
    const twoFilesExample = {
      ...example,
      files: [
        ...example.files,
        { name: "helper.h", path: "examples/helper.h" },
      ],
    };
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [twoFilesExample],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}\n",
      [`/owner/repo/${revision}/examples/helper.h`]: `int value;\n${annotation}\n`,
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples[0]?.files.find(({ name }) => name === "helper.h")?.content).toBe("int value;\n");
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  it("loads all enumerated Tutor files from the same immutable revision", async () => {
    const topic = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    const strategy = [
      "schemaVersion: 1",
      "id: repository-default",
      "questionKindWeights:",
      "  recall: 10",
      "  concept: 25",
      "  application: 35",
      "  prediction: 15",
      "  transfer: 15",
      "sketchSpecificity: prefer",
      "repetition: strict",
      "remediation: scaffold-first",
      "clarification: same-indicator",
      "progression: mastery-then-advance",
      "scaffolding: prefer-content",
      "feedbackVerbosity: short",
      "hintFirst: true",
      "adaptiveDifficulty: current-contract",
      "",
    ].join("\n");
    const manifest = [
      "schemaVersion: 1",
      "defaultStrategy: repository-default",
      "topics:",
      "  - id: memory-and-data-types",
      "    path: tutor/topics/memory-and-data-types.yaml",
      `    sha256: ${digest(topic)}`,
      "strategies:",
      "  - id: repository-default",
      "    path: tutor/strategies/repository-default.yaml",
      `    sha256: ${digest(strategy)}`,
      "",
    ].join("\n");
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [example],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: `void setup() {}\n${annotation}\n`,
      [`/owner/repo/${revision}/tutor/manifest.yaml`]: manifest,
      [`/owner/repo/${revision}/tutor/topics/memory-and-data-types.yaml`]: topic,
      [`/owner/repo/${revision}/tutor/strategies/repository-default.yaml`]: strategy,
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.tutor.status).toBe("valid");
    if (loaded.tutor.status !== "valid") return;
    expect(loaded.tutor.topics).toHaveLength(1);
    expect(loaded.tutor.strategies).toHaveLength(1);
    expect(loaded.exampleTutorAnnotations.get("arrays-example")?.primaryTopic).toBe("memory-and-data-types");
    expect(loaded.examples[0]?.files[0]?.content).toBe("void setup() {}\n");
    expect(loaded.examples[0]?.tutorAnnotation?.strategy).toBe("repository-default");
    expect(fetchText.mock.calls.every(([url]) => (url as URL).pathname.includes(`/${revision}/`))).toBe(true);
  });

  it("rejects the complete Tutor bundle on a referenced hash mismatch", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [example],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}",
      [`/owner/repo/${revision}/tutor/manifest.yaml`]: [
        "schemaVersion: 1",
        "topics:",
        "  - id: arrays",
        "    path: tutor/topics/arrays.yaml",
        `    sha256: ${"0".repeat(64)}`,
        "strategies: []",
        "",
      ].join("\n"),
      [`/owner/repo/${revision}/tutor/topics/arrays.yaml`]: "schemaVersion: 1\nid: arrays\n",
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  describe("Tutor files of the bundle", () => {
    async function tutorWith(topics: Array<{ id: string; source: string }>) {
      const entries = topics.flatMap(({ id, source }) => [
        `  - id: ${id}`,
        `    path: tutor/topics/${id}.yaml`,
        `    sha256: ${digest(source)}`,
      ]);
      const { fetchText } = fetcherFor({
        [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({ schemaVersion: 2, examples: [example], tutor: { manifest: "tutor/manifest.yaml" } }),
        [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}",
        [`/owner/repo/${revision}/tutor/manifest.yaml`]: ["schemaVersion: 1", "topics:", ...entries, "strategies: []", ""].join("\n"),
        ...Object.fromEntries(topics.map(({ id, source }) => [`/owner/repo/${revision}/tutor/topics/${id}.yaml`, source])),
      });
      return (await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision)).tutor;
    }

    it("accepts the pilot topic", async () => {
      const topic = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");

      expect(await tutorWith([{ id: "memory-and-data-types", source: topic }])).toMatchObject({ status: "valid" });
    });

    it.each([
      ["an unknown field", (topic: string) => topic.replace("schemaVersion: 1", "schemaVersion: 1\nunexpected: true")],
      ["a YAML language tag", (topic: string) => topic.replace("title: Speicher und Datentypen", "title: !!js/function '() => 1'")],
      ["a custom YAML tag", (topic: string) => topic.replace("title: Speicher und Datentypen", "title: !custom value")],
    ])("rejects a topic with %s", async (_case, change) => {
      const topic = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
      const changed = change(topic);

      expect(changed).not.toBe(topic);
      expect(await tutorWith([{ id: "memory-and-data-types", source: changed }])).toMatchObject({ status: "invalid" });
    });

    it("rejects a manifest that lists a topic id twice", async () => {
      const topic = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
      const entry = { id: "memory-and-data-types", source: topic };

      expect(await tutorWith([entry, entry])).toMatchObject({ status: "invalid" });
    });
  });

  it("rejects a bundle whose embedded annotation references an unknown Tutor item", async () => {
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({
        schemaVersion: 2,
        examples: [example],
        tutor: { manifest: "tutor/manifest.yaml" },
      }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}\n/* @unosim-tutor\nschemaVersion: 1\ntopics: [unknown-topic]\n@end-unosim-tutor */\n",
      [`/owner/repo/${revision}/tutor/manifest.yaml`]: "schemaVersion: 1\ntopics: []\nstrategies: []\n",
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });

  it("loads manifest and Topic v2 phase data atomically", async () => {
    const topicV1 = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    const topic = topicV1.replace("schemaVersion: 1", "schemaVersion: 2\nextensions:\n  - topic: memory-and-data-types\n    objective: Ein verwandtes Beispiel vergleichen.\n");
    const strategy = [
      "schemaVersion: 1",
      "id: repository-default",
      "questionKindWeights:",
      "  recall: 10",
      "  concept: 25",
      "  application: 35",
      "  prediction: 15",
      "  transfer: 15",
      "sketchSpecificity: prefer",
      "repetition: strict",
      "remediation: scaffold-first",
      "clarification: same-indicator",
      "progression: mastery-then-advance",
      "scaffolding: prefer-content",
      "feedbackVerbosity: short",
      "hintFirst: true",
      "adaptiveDifficulty: current-contract",
      "",
    ].join("\n");
    const manifest = [
      "schemaVersion: 2",
      "defaultStrategy: repository-default",
      "phaseStrategies:",
      "  deepen: repository-default",
      "  expand: repository-default",
      "topics:",
      "  - id: memory-and-data-types",
      "    path: tutor/topics/memory-and-data-types.yaml",
      `    sha256: ${digest(topic)}`,
      "strategies:",
      "  - id: repository-default",
      "    path: tutor/strategies/repository-default.yaml",
      `    sha256: ${digest(strategy)}`,
      "",
    ].join("\n");
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({ schemaVersion: 2, examples: [example], tutor: { manifest: "tutor/manifest.yaml" } }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}\n",
      [`/owner/repo/${revision}/tutor/manifest.yaml`]: manifest,
      [`/owner/repo/${revision}/tutor/topics/memory-and-data-types.yaml`]: topic,
      [`/owner/repo/${revision}/tutor/strategies/repository-default.yaml`]: strategy,
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.tutor).toMatchObject({ status: "valid", manifest: { schemaVersion: 2 } });
    if (loaded.tutor.status === "valid") {
      expect(loaded.tutor.topics[0]?.schemaVersion).toBe(2);
      expect(loaded.tutor.manifest.schemaVersion === 2 && loaded.tutor.manifest.phaseStrategies?.deepen).toBe("repository-default");
    }
  });

  it("invalidates the complete Tutor bundle for an unknown phase strategy or extension target", async () => {
    const topicV1 = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    const topic = topicV1.replace("schemaVersion: 1", "schemaVersion: 2\nextensions:\n  - topic: missing-topic\n    objective: Unbekanntes Ziel.\n");
    const manifest = [
      "schemaVersion: 2",
      "phaseStrategies:",
      "  deepen: missing-strategy",
      "topics:",
      "  - id: memory-and-data-types",
      "    path: tutor/topics/memory-and-data-types.yaml",
      `    sha256: ${digest(topic)}`,
      "strategies: []",
      "",
    ].join("\n");
    const { fetchText } = fetcherFor({
      [`/owner/repo/${revision}/manifest.json`]: JSON.stringify({ schemaVersion: 2, examples: [example], tutor: { manifest: "tutor/manifest.yaml" } }),
      [`/owner/repo/${revision}/examples/main.ino`]: "void setup() {}\n",
      [`/owner/repo/${revision}/tutor/manifest.yaml`]: manifest,
      [`/owner/repo/${revision}/tutor/topics/memory-and-data-types.yaml`]: topic,
    });

    const loaded = await new CourseContentLoader({ fetchText }, 2).load("owner/repo", revision);
    expect(loaded.examples).toHaveLength(1);
    expect(loaded.tutor).toMatchObject({ status: "invalid" });
  });
});
