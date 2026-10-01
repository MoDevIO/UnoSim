import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  compareTutorQualityCorpusVersions,
  parseTutorQualityCorpus,
  tutorQualityCorpusDigest,
  type TutorQualityCorpusSource,
} from "../../../../../server/services/tutor/evaluation/anchor-corpus";
import { canonicalDigest } from "../../../../../server/services/tutor/evaluation/canonical";
import {
  ANCHOR_COURSE_CONTENT_FIXTURE_IDS,
  createAnchorCourseContent,
} from "../../../../../server/services/tutor/evaluation/anchor-course-content";

const references = {
  sketches: new Set(["variable.ino"]),
  courseContentFixtures: new Set(["variables"]),
};

function validSource(): TutorQualityCorpusSource {
  return {
    corpusId: "test-corpus",
    corpusVersion: 1,
    scenarios: [
      {
        id: "variable",
        sketch: "variable.ino",
        courseContent: "variables",
        turns: [
          {
            kind: "dialog",
            question: "Welchen Wert hat x?",
            answer: "x ist drei.",
            bindsToQuestion: "Welchen Wert hat x?",
            difficulty: 20,
          },
        ],
        expected: { topicId: "variables-and-serial" },
      },
    ],
  };
}

describe("Tutor Quality anchor corpus contract", () => {
  it("contains the reviewed version-1 anchor set", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const corpus = parseTutorQualityCorpus(source, {
      sketches: new Set(source.scenarios.map(({ sketch }) => sketch)),
      courseContentFixtures: new Set(["variables", "progression-learn", "progression-expand"]),
    });

    expect(corpus.corpusVersion).toBe(2);
    expect(corpus.scenarios.map(({ id }) => id)).toEqual([
      "TQ-SEM-001",
      "TQ-REG-001",
      "simple-variable",
      "serial-output-prediction",
      "incorrect-answer-remediation",
      "partial-answer-follow-up",
      "strong-answer-progression",
      "unmatched-topic-free-tutor",
      "learn-to-deepen",
      "expand",
      "off-topic-answer",
    ]);
    expect(corpus.scenarios[0]?.judge?.criteria).toHaveLength(3);
  });

  it("parses stable scenario references and explicit question bindings", () => {
    const corpus = parseTutorQualityCorpus(validSource(), references);

    expect(corpus.corpusId).toBe("test-corpus");
    expect(corpus.scenarios[0]).toMatchObject({
      id: "variable",
      sketch: "variable.ino",
      courseContent: "variables",
      turns: [{ bindsToQuestion: "Welchen Wert hat x?" }],
    });
  });

  it("parses an optional minimal Judge contract", () => {
    const source = {
      ...validSource(),
      scenarios: [{
        ...validSource().scenarios[0]!,
        judge: {
          facts: ["int x = 3; sets x to three."],
          criteria: [{ id: "correct", text: "Recognizes the correct value." }],
        },
      }],
    };

    expect(parseTutorQualityCorpus(source, references).scenarios[0]?.judge).toEqual({
      facts: ["int x = 3; sets x to three."],
      criteria: [{ id: "correct", text: "Recognizes the correct value." }],
    });
  });

  it.each([
    ["empty facts", { facts: [], criteria: [{ id: "correct", text: "Check correctness." }] }],
    ["empty criteria", { facts: ["x is three"], criteria: [] }],
    ["duplicate criterion ids", { facts: ["x is three"], criteria: [{ id: "correct", text: "A" }, { id: "correct", text: "B" }] }],
    ["invalid criterion id", { facts: ["x is three"], criteria: [{ id: "bad id", text: "Check correctness." }] }],
  ])("rejects Judge contract with %s", (_label, judge) => {
    const source = { ...validSource(), scenarios: [{ ...validSource().scenarios[0]!, judge }] };
    expect(() => parseTutorQualityCorpus(source, references)).toThrow();
  });

  it("uses the shared canonical digest for optional undefined fields", () => {
    const source = {
      ...validSource(),
      scenarios: [{ ...validSource().scenarios[0]!, model: undefined }],
    } as unknown as TutorQualityCorpusSource;

    expect(tutorQualityCorpusDigest(source)).toBe(canonicalDigest(source));
  });

  it.each([
    ["duplicate scenario id", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [...source.scenarios, source.scenarios[0]!],
    })],
    ["missing sketch reference", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [{ ...source.scenarios[0]!, sketch: "missing.ino" }],
    })],
    ["auto model", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [{ ...source.scenarios[0]!, model: "auto" }],
    })],
    ["rated philosophical history", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [{
        ...source.scenarios[0]!,
        turns: [{
          ...source.scenarios[0]!.turns[0]!,
          history: [{ question: "Was ist x?", responseStyle: "philosophical", answerRating: 3 }],
        }],
      }],
    })],
    ["unbound continuation", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [{
        ...source.scenarios[0]!,
        turns: [{ ...source.scenarios[0]!.turns[0]!, bindsToQuestion: undefined }],
      }],
    })],
    ["self-referencing continuation", (source: TutorQualityCorpusSource) => ({
      ...source,
      scenarios: [{
        ...source.scenarios[0]!,
        turns: [{ ...source.scenarios[0]!.turns[0]!, continuationOf: 0 }],
      }],
    })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => parseTutorQualityCorpus(mutate(validSource()), references)).toThrow();
  });

  it("keeps historical version comparison outside current-corpus parsing", () => {
    const previous = parseTutorQualityCorpus(validSource(), references);
    const changed = parseTutorQualityCorpus({
      ...validSource(),
      scenarios: [{ ...validSource().scenarios[0]!, turns: [{
        ...validSource().scenarios[0]!.turns[0]!,
        answer: "x ist vier.",
        bindsToQuestion: "Welchen Wert hat x?",
      }] }],
    }, references);
    const bumped = { ...changed, corpusVersion: previous.corpusVersion + 1 };

    expect(compareTutorQualityCorpusVersions(previous, changed).valid).toBe(false);
    expect(compareTutorQualityCorpusVersions(previous, bumped).valid).toBe(true);
    expect(compareTutorQualityCorpusVersions(previous, previous).valid).toBe(true);
  });

  it("provides valid typed Course Content fixtures for progression anchors", () => {
    for (const fixtureId of ANCHOR_COURSE_CONTENT_FIXTURE_IDS) {
      const content = createAnchorCourseContent(fixtureId);
      expect(content.tutor?.status).toBe("valid");
      expect(content.revision).toHaveLength(40);
    }
    expect(createAnchorCourseContent("progression-expand").progressionState).toMatchObject({
      activeTopicId: "variables-and-serial",
      phase: "EXPAND",
      masteredTopicIds: ["variables-and-serial"],
    });
  });
});
