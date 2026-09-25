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
});
