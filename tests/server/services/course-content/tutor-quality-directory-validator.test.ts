import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { validateTutorCourseContentDirectory } from "../../../../server/services/course-content/tutor-quality-directory-validator";

const temporaryDirectories: string[] = [];
const executeFile = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Tutor Course Content directory validator", () => {
  it("loads the real bundle boundary, verifies hashes, and resolves quality cases", async () => {
    const directory = await courseContentDirectory();

    await expect(validateTutorCourseContentDirectory(directory)).resolves.toEqual([]);
  });

  it("reports an Example without a quality case whose activated Topic cannot be mastered", async () => {
    const serialOnly = { id: "serial-literal", source: 'void setup() { Serial.begin(9600); Serial.println("Hallo"); } void loop() {}\n' };
    const withPrerequisite = await courseContentDirectory(true, { topic: topicSource({ outputPrerequisite: true }), extraExample: serialOnly });
    const withoutPrerequisite = await courseContentDirectory(true, { topic: topicSource({ outputPrerequisite: false }), extraExample: serialOnly });

    await expect(validateTutorCourseContentDirectory(withPrerequisite)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unmasterable-example-activation", exampleId: "serial-literal", topicId: "variables-and-serial" }),
    ]));
    const accepted = await validateTutorCourseContentDirectory(withoutPrerequisite);
    expect(accepted.filter(({ code }) => code === "unmasterable-example-activation")).toEqual([]);
  });

  it("fails closed when a declared Tutor hash is inconsistent", async () => {
    const directory = await courseContentDirectory();
    await writeFile(path.join(directory, "tutor/topics/variables.yaml"), `${topicSource()}\n# changed\n`, "utf8");

    await expect(validateTutorCourseContentDirectory(directory)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-course-content-bundle" }),
    ]));
  });

  it("fails when the quality case manifest is absent", async () => {
    const directory = await courseContentDirectory(false);

    await expect(validateTutorCourseContentDirectory(directory)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-quality-cases" }),
    ]));
  });

  it("returns a nonzero CLI status when the hard gate finds issues", async () => {
    const directory = await courseContentDirectory(false);

    await expect(executeFile(
      path.resolve("node_modules/.bin/tsx"),
      ["scripts/validate-tutor-course-content.mjs", directory],
      { cwd: process.cwd() },
    )).rejects.toMatchObject({ code: 1 });
  });

  it("returns usage status when no Course Content directory is provided", async () => {
    await expect(executeFile(
      path.resolve("node_modules/.bin/tsx"),
      ["scripts/validate-tutor-course-content.mjs"],
      { cwd: process.cwd() },
    )).rejects.toMatchObject({ code: 2 });
  });
});

async function courseContentDirectory(
  withCases = true,
  options: { readonly topic?: string; readonly extraExample?: { readonly id: string; readonly source: string } } = {},
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "unosim-tutor-quality-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "examples"), { recursive: true });
  await mkdir(path.join(directory, "tutor/topics"), { recursive: true });
  const serial = "int value = 3; void setup() { Serial.println(value); } void loop() {}\n";
  const pwm = "const int pin = 9; void setup() {} void loop() { analogWrite(pin, 128); }\n";
  const topic = options.topic ?? topicSource();
  await writeFile(path.join(directory, "examples/serial.ino"), serial, "utf8");
  if (options.extraExample) {
    await writeFile(path.join(directory, `examples/${options.extraExample.id}.ino`), options.extraExample.source, "utf8");
  }
  await writeFile(path.join(directory, "examples/pwm.ino"), pwm, "utf8");
  await writeFile(path.join(directory, "tutor/topics/variables.yaml"), topic, "utf8");
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    examples: [
      { id: "serial", title: "Serial", category: "Test", files: [{ name: "serial.ino", path: "examples/serial.ino" }], main: "serial.ino" },
      { id: "pwm", title: "PWM", category: "Test", files: [{ name: "pwm.ino", path: "examples/pwm.ino" }], main: "pwm.ino" },
      ...(options.extraExample ? [{
        id: options.extraExample.id,
        title: "Extra",
        category: "Test",
        files: [{ name: `${options.extraExample.id}.ino`, path: `examples/${options.extraExample.id}.ino` }],
        main: `${options.extraExample.id}.ino`,
      }] : []),
    ],
    tutor: { manifest: "tutor/manifest.yaml" },
  }), "utf8");
  await writeFile(path.join(directory, "tutor/manifest.yaml"), [
    "schemaVersion: 1",
    "topics:",
    "  - id: variables-and-serial",
    "    path: tutor/topics/variables.yaml",
    `    sha256: ${digest(topic)}`,
    "strategies: []",
    "",
  ].join("\n"), "utf8");
  if (withCases) {
    await writeFile(path.join(directory, "tutor/quality-cases.yaml"), [
      "schemaVersion: 1",
      "cases:",
      "  - id: serial-positive",
      "    example: serial",
      "    expectedTopics: [variables-and-serial]",
      "  - id: pwm-negative",
      "    example: pwm",
      "    forbiddenTopics: [variables-and-serial]",
      "",
    ].join("\n"), "utf8");
  }
  return directory;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Default: one Concept, three Serial questions. With `outputPrerequisite` set: an int-only Concept
// "values" and a Serial Concept "output" that does (true) or does not (false) require it.
function topicSource(variant?: { readonly outputPrerequisite: boolean }): string {
  if (variant) return prerequisiteTopicSource(variant.outputPrerequisite);
  return [
    "schemaVersion: 1",
    "id: variables-and-serial",
    "title: Variablen",
    "locale: de-DE",
    "activation:",
    "  any:",
    "    - fact: serial-call",
    "      values: [print]",
    "concepts:",
    "  - id: values",
    "    title: Werte",
    "    objective: Werte und Ausgabe verbinden.",
    "    prerequisites: []",
    "    difficulty:",
    "      entry: [1, 50]",
    "      transfer: [20, 80]",
    "    misconceptions: []",
    "    indicators:",
    "      - id: value-use",
    "        description: Verwendung erklären.",
    "    mastery:",
    "      minimumSuccessfulProbes: 1",
    "      successRatingAtLeast: 3",
    "      requiredIndicators: [value-use]",
    "      minimumDistinctQuestionKinds: 1",
    "      recentWeakAnswersAllowed: 0",
    "questions:",
    ...["concept", "transfer", "prediction"].flatMap((kind, index) => [
      `  - id: question-${index + 1}`,
      "    concept: values",
      "    indicator: value-use",
      `    kind: ${kind}`,
      "    difficulty: [1, 80]",
      "    requires:",
      "      - fact: serial-call",
      "        values: [print]",
      `    text: Was prüft Frage ${index + 1}?`,
    ]),
    "scaffolds: []",
    "progression:",
    "  entryConcepts: [values]",
    "  preferredOrder: [values]",
    "  onRating:",
    "    1-2: remediate",
    "    3: clarify-same-indicator",
    "    4: probe-missing-indicator",
    "    5: evaluate-mastery-and-advance",
    "",
  ].join("\n");
}

function prerequisiteTopicSource(outputPrerequisite: boolean): string {
  const concept = (id: string, indicator: string, prerequisites: string) => [
    `  - id: ${id}`,
    `    title: ${id}`,
    "    objective: Konzept erklären.",
    `    prerequisites: ${prerequisites}`,
    "    difficulty:",
    "      entry: [1, 50]",
    "      transfer: [20, 80]",
    "    misconceptions: []",
    "    indicators:",
    `      - id: ${indicator}`,
    "        description: Indikator.",
    "    mastery:",
    "      minimumSuccessfulProbes: 1",
    "      successRatingAtLeast: 3",
    `      requiredIndicators: [${indicator}]`,
    "      minimumDistinctQuestionKinds: 1",
    "      recentWeakAnswersAllowed: 0",
  ];
  const questionLines = (id: string, conceptId: string, indicator: string, kind: string, fact: string, value: string) => [
    `  - id: ${id}`,
    `    concept: ${conceptId}`,
    `    indicator: ${indicator}`,
    `    kind: ${kind}`,
    "    difficulty: [1, 80]",
    "    requires:",
    `      - fact: ${fact}`,
    `        values: [${value}]`,
    `    text: Was prüft ${id}?`,
  ];
  return [
    "schemaVersion: 1",
    "id: variables-and-serial",
    "title: Variablen",
    "locale: de-DE",
    "activation:",
    "  any:",
    "    - fact: serial-call",
    "      values: [print]",
    "concepts:",
    ...concept("values", "value-use", "[]"),
    ...concept("output", "output-use", outputPrerequisite ? "[values]" : "[]"),
    "questions:",
    ...questionLines("values-recall", "values", "value-use", "recall", "type-used", "int"),
    ...questionLines("values-application", "values", "value-use", "application", "type-used", "int"),
    ...questionLines("output-concept", "output", "output-use", "concept", "serial-call", "print"),
    ...questionLines("output-transfer", "output", "output-use", "transfer", "serial-call", "print"),
    ...questionLines("output-prediction", "output", "output-use", "prediction", "serial-call", "print"),
    "scaffolds: []",
    "progression:",
    "  entryConcepts: [values]",
    "  preferredOrder: [values, output]",
    "  onRating:",
    "    1-2: remediate",
    "    3: clarify-same-indicator",
    "    4: probe-missing-indicator",
    "    5: evaluate-mastery-and-advance",
    "",
  ].join("\n");
}
