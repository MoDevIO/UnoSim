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
            difficulty: 20,
          },
        ],
        expected: { topicId: "variables-and-serial" },
      },
    ],
  };
}

describe("Tutor Quality anchor corpus contract", () => {
  it("contains two judge-enabled strategy cases for each learning phase", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const strategyCases = source.scenarios.filter(({ id }) => id.startsWith("strategy-"));
    const counts = Object.fromEntries(["LEARN", "DEEPEN", "EXPAND"].map((phase) => [
      phase,
      strategyCases.filter(({ expected }) => expected?.learningPhase === phase).length,
    ]));

    expect(Object.values(counts).every((count) => count >= 2 && count <= 3)).toBe(true);
    expect(strategyCases.every(({ turns, judge, expected }) => (
      turns.some(({ kind }) => kind === "dialog")
      && expected?.learningPhase !== undefined
      && judge !== undefined
      && judge.facts.length > 0
      && judge.criteria.length > 0
    ))).toBe(true);
    expect(ANCHOR_COURSE_CONTENT_FIXTURE_IDS).toContain("progression-deepen");
  });

  it("parses the versioned anchor corpus with unique stable IDs", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const corpus = parseTutorQualityCorpus(source, {
      sketches: new Set(source.scenarios.map(({ sketch }) => sketch)),
      courseContentFixtures: new Set(["variables", "progression-learn", "progression-deepen", "progression-expand"]),
    });

    expect(corpus.corpusVersion).toBeGreaterThanOrEqual(5);
    expect(new Set(corpus.scenarios.map(({ id }) => id)).size).toBe(corpus.scenarios.length);
    expect(corpus.scenarios.map(({ id }) => id)).toEqual(expect.arrayContaining(["TQ-SEM-001", "TQ-REG-001"]));
    expect(corpus.scenarios[0]?.judge?.criteria).toHaveLength(3);
  });

  it("binds every Strategy-case dialog turn to a planner-served question and keeps Judge facts free of internal IDs", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const internalIds = new Set<string>();
    for (const fixtureId of ANCHOR_COURSE_CONTENT_FIXTURE_IDS) {
      const tutor = createAnchorCourseContent(fixtureId).tutor;
      if (tutor?.status !== "valid") continue;
      for (const topic of tutor.topics) {
        internalIds.add(topic.id);
        topic.concepts.forEach(({ id }) => internalIds.add(id));
        topic.questions.forEach(({ id }) => internalIds.add(id));
      }
    }
    const strategyCases = source.scenarios.filter(({ expected }) => expected?.learningPhase !== undefined && expected.learningPhase !== undefined);
    const planned = strategyCases.filter(({ id }) => id.startsWith("strategy-"));

    expect(planned.length).toBeGreaterThan(0);
    for (const { id, turns } of planned) {
      const dialogTurns = turns.filter((turn): turn is Extract<typeof turn, { kind: "dialog" }> => turn.kind === "dialog");
      expect(dialogTurns.every(({ continuationOf }) => continuationOf !== undefined), id).toBe(true);
    }
    for (const { id, judge } of source.scenarios) {
      for (const fact of judge?.facts ?? []) {
        for (const internalId of internalIds) expect(fact.includes(internalId), `${id}: fact mentions ${internalId}`).toBe(false);
      }
    }
  });

  it("parses stable scenario references; the question binding is question plus continuationOf", () => {
    const corpus = parseTutorQualityCorpus(validSource(), references);

    expect(corpus.corpusId).toBe("test-corpus");
    expect(corpus.scenarios[0]).toMatchObject({
      id: "variable",
      sketch: "variable.ino",
      courseContent: "variables",
      turns: [{ kind: "dialog", question: "Welchen Wert hat x?" }],
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

  describe("expected.answerRating and phaseAfter contract", () => {
    function withExpected(expected: Record<string, unknown>, turnKind: "dialog" | "initial" = "dialog") {
      const base = validSource().scenarios[0]!;
      return {
        ...validSource(),
        scenarios: [{
          ...base,
          turns: turnKind === "dialog" ? base.turns : [{ kind: "initial" as const, difficulty: 20 }],
          expected,
        }],
      } as unknown as TutorQualityCorpusSource;
    }

    it("parses a rating band as an integer tuple", () => {
      const corpus = parseTutorQualityCorpus(withExpected({ learningPhase: "LEARN", phaseAfter: "DEEPEN", answerRating: [3, 5] }), references);
      expect(corpus.scenarios[0]?.expected).toMatchObject({ answerRating: [3, 5] });
    });

    it.each([
      ["inverted band", [4, 3]],
      ["below range", [0, 2]],
      ["above range", [1, 6]],
      ["fractional", [1.5, 2]],
      ["wrong length", [3]],
      ["not an array", 3],
    ])("rejects an invalid rating band: %s", (_label, answerRating) => {
      expect(() => parseTutorQualityCorpus(withExpected({ answerRating }), references)).toThrow(/answerRating/);
    });

    it("rejects a rating band when the final turn is not a dialog turn", () => {
      expect(() => parseTutorQualityCorpus(withExpected({ answerRating: [3, 5] }, "initial"), references)).toThrow(/answerRating/);
    });

    it("requires learningPhase whenever phaseAfter is declared", () => {
      expect(() => parseTutorQualityCorpus(withExpected({ phaseAfter: "EXPAND" }), references)).toThrow(/phaseAfter.*learningPhase/);
    });

    it.each(["LEARN", "DEEPEN"])("requires a rating band for phaseAfter after a %s turn", (learningPhase) => {
      expect(() => parseTutorQualityCorpus(withExpected({ learningPhase, phaseAfter: "EXPAND" }), references)).toThrow(/phaseAfter.*answerRating/);
    });

    it("does not require a rating band for phaseAfter after an EXPAND turn", () => {
      expect(() => parseTutorQualityCorpus(withExpected({ learningPhase: "EXPAND", phaseAfter: "EXPAND" }), references)).not.toThrow();
    });

    it("does not require a rating band for a pure Judge case without a progression claim", () => {
      expect(() => parseTutorQualityCorpus(withExpected({ learningPhase: "LEARN" }), references)).not.toThrow();
    });
  });

  it("rejects unknown expected keys instead of silently accepting typos", () => {
    const source = {
      ...validSource(),
      scenarios: [{ ...validSource().scenarios[0]!, expected: { learningphase: "LEARN" } }],
    };

    expect(() => parseTutorQualityCorpus(source, references)).toThrow(/expected\.learningphase is unknown/i);
  });

  it("keeps historical version comparison outside current-corpus parsing", () => {
    const previous = parseTutorQualityCorpus(validSource(), references);
    const changed = parseTutorQualityCorpus({
      ...validSource(),
      scenarios: [{ ...validSource().scenarios[0]!, turns: [{
        ...validSource().scenarios[0]!.turns[0]!,
        answer: "x ist vier.",
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
    const expansionTutor = createAnchorCourseContent("progression-expand").tutor;
    expect(expansionTutor?.status).toBe("valid");
    if (expansionTutor?.status === "valid") {
      expect(expansionTutor.topics.flatMap(({ questions }) => questions.map(({ id }) => id)).filter((id) => id.startsWith("expand-"))).toEqual([]);
    }
  });

  it("provides a mastered same-topic DEEPEN fixture", () => {
    expect(ANCHOR_COURSE_CONTENT_FIXTURE_IDS).toContain("progression-deepen");
    const content = createAnchorCourseContent("progression-deepen");

    expect(content.progressionState).toMatchObject({
      activeTopicId: "variables-and-serial",
      phase: "DEEPEN",
      masteredTopicIds: ["variables-and-serial"],
      retainedPhases: { "variables-and-serial": "DEEPEN" },
    });
    expect(content.tutor).toMatchObject({ status: "valid", topics: [{ schemaVersion: 2 }] });
  });
});
