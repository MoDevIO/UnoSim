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
  it("contains at least two judge-enabled strategy cases for each learning phase", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const strategyCases = source.scenarios.filter(({ id }) => id.startsWith("strategy-"));
    const counts = Object.fromEntries(["LEARN", "DEEPEN", "EXPAND"].map((phase) => [
      phase,
      strategyCases.filter(({ expected }) => expected?.learningPhase === phase).length,
    ]));

    // R-AUT-1: a lower bound for coverage, never a case count; new cases are corpus data only.
    expect(Object.values(counts).every((count) => count >= 2)).toBe(true);
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
    expect(corpus.scenarios[0]?.judge?.criteria).toHaveLength(4);
  });

  it("binds every dialog turn of a Strategy case (expected.learningPhase) to a planner-served question and keeps Judge facts free of internal IDs", () => {
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
    // R-TURN-3: a Strategy case is any case that declares expected.learningPhase.
    const planned = source.scenarios.filter(({ expected }) => expected?.learningPhase !== undefined);

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

  it("encodes the Freetutor findings of the human baseline (R-RAT-7, R-REV-1, R-CRT-5)", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const corpus = parseTutorQualityCorpus(source, {
      sketches: new Set(source.scenarios.map(({ sketch }) => sketch)),
      courseContentFixtures: new Set(ANCHOR_COURSE_CONTENT_FIXTURE_IDS),
    });
    const byId = new Map(corpus.scenarios.map((scenario) => [scenario.id, scenario]));
    const criterionIds = (id: string) => byId.get(id)?.judge?.criteria.map((criterion) => criterion.id);

    expect(byId.get("TQ-SEM-001")?.expected?.answerRating).toEqual([4, 5]);
    expect(criterionIds("TQ-SEM-001")).toContain("no-unneeded-qualification");
    expect(byId.get("incorrect-answer-remediation")?.expected?.mustNotReveal).toEqual(["counter = 3"]);
    expect(criterionIds("incorrect-answer-remediation")).toEqual(["no-solution-revealed"]);
    expect(criterionIds("partial-answer-follow-up")).toEqual(["no-solution-revealed"]);
    expect(byId.get("partial-answer-follow-up")?.expected?.mustNotReveal).toEqual(["counter += 1"]);
    expect(criterionIds("strong-answer-progression")).toEqual(["no-solution-revealed", "no-unneeded-qualification"]);
    expect(byId.get("strong-answer-progression")?.expected?.mustNotReveal).toEqual(["counter = 3"]);
    expect(byId.get("off-topic-answer")?.judge).toBeUndefined();
  });

  it("bumps corpusVersion whenever the parsed corpus digest changes (R-COR-1)", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const current = parseTutorQualityCorpus(source, {
      sketches: new Set(source.scenarios.map(({ sketch }) => sketch)),
      courseContentFixtures: new Set(ANCHOR_COURSE_CONTENT_FIXTURE_IDS),
    });
    // Last released corpus (v5, the PR E baseline). A content change must come with a higher version.
    const released = { ...current, corpusVersion: 5, digest: "e25167402c95450f63c2f5683cc5fc0874fb8619b9848fcba7deef8fc0a0918d" };

    expect(compareTutorQualityCorpusVersions(released, current)).toEqual({ valid: true });
    expect({ corpusVersion: current.corpusVersion, digest: current.digest }).toEqual({ corpusVersion: 11, digest: "f83ea637e2d93febcd2355b322cdaaaa4025cc0e7db7f9bde1daa5dc776dd547" });
  });

  it("grounds the strong LEARN answer in the actual output without demanding unprinted behaviour", () => {
    const source = parseYaml(readFileSync(fileURLToPath(new URL("../../../../../evals/tutor-quality/anchor-corpus.yaml", import.meta.url)), "utf8")) as TutorQualityCorpusSource;
    const criterion = source.scenarios.find(({ id }) => id === "strategy-learn-strong-answer")?.judge?.criteria
      .find(({ id }) => id === "learn-feedback-grounds-sketch");

    // F3 of the 2026-10-03 baseline: the question asks for the serial output (3 from setup); the increment in loop is never printed.
    expect(criterion?.text).toMatch(/Serial\.println\(counter\)/);
    expect(criterion?.text).toMatch(/\b3\b/);
    expect(criterion?.text).not.toMatch(/Erhöhung|erhöht/);
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

  describe("R-TURN-3: Strategy cases bind their dialog turns to a planner-served question", () => {
    function strategySource(turns: unknown[], expected: Record<string, unknown> = { learningPhase: "LEARN" }) {
      return {
        ...validSource(),
        scenarios: [{ ...validSource().scenarios[0]!, turns, expected }],
      } as unknown as TutorQualityCorpusSource;
    }
    const dialog = validSource().scenarios[0]!.turns[0]!;

    it("rejects a dialog turn without continuationOf in a case that declares expected.learningPhase", () => {
      expect(() => parseTutorQualityCorpus(strategySource([dialog]), references)).toThrow(/turns\[0\].*continuationOf.*R-TURN-3/);
    });

    it("rejects an unbound dialog turn even when another dialog turn of the case is bound", () => {
      const source = strategySource([{ kind: "initial", difficulty: 20 }, { ...dialog, continuationOf: 0 }, dialog]);
      expect(() => parseTutorQualityCorpus(source, references)).toThrow(/turns\[2\].*continuationOf/);
    });

    it("accepts a bound dialog turn and an initial-only case", () => {
      expect(() => parseTutorQualityCorpus(strategySource([{ kind: "initial", difficulty: 20 }, { ...dialog, continuationOf: 0 }]), references)).not.toThrow();
      expect(() => parseTutorQualityCorpus(strategySource([{ kind: "initial", difficulty: 20 }], { learningPhase: "EXPAND" }), references)).not.toThrow();
    });

    it("keeps scripted dialog turns valid in cases without expected.learningPhase (R-TURN-2)", () => {
      expect(() => parseTutorQualityCorpus(strategySource([dialog], { topicId: "variables-and-serial" }), references)).not.toThrow();
    });
  });

  describe("expected.answerRating and phaseAfter contract", () => {
    function withExpected(expected: Record<string, unknown>, turnKind: "dialog" | "initial" = "dialog") {
      const base = validSource().scenarios[0]!;
      return {
        ...validSource(),
        scenarios: [{
          ...base,
          turns: turnKind === "dialog"
            ? [{ kind: "initial" as const, difficulty: 20 }, { ...base.turns[0]!, continuationOf: 0 }]
            : [{ kind: "initial" as const, difficulty: 20 }],
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

  describe("expected.mustNotReveal contract (R-REV-1)", () => {
    function withReveal(mustNotReveal: unknown) {
      const base = validSource().scenarios[0]!;
      return { ...validSource(), scenarios: [{ ...base, expected: { mustNotReveal } }] } as unknown as TutorQualityCorpusSource;
    }

    it("parses a list of specific literals", () => {
      const corpus = parseTutorQualityCorpus(withReveal(["counter = 3", "startwert drei"]), references);
      expect(corpus.scenarios[0]?.expected).toEqual({ mustNotReveal: ["counter = 3", "startwert drei"] });
    });

    it.each([
      ["empty list", []],
      ["more than five literals", ["aaa1", "aaa2", "aaa3", "aaa4", "aaa5", "aaa6"]],
      ["not an array", "counter = 3"],
      ["non-string entry", ["counter = 3", 3]],
      ["bare value", ["3"]],
      ["single plain word", ["drei"]],
      ["blank literal", ["   "]],
      ["duplicate after normalization", ["counter = 3", "Counter=3"]],
    ])("rejects an invalid list: %s", (_label, mustNotReveal) => {
      expect(() => parseTutorQualityCorpus(withReveal(mustNotReveal), references)).toThrow(/mustNotReveal/);
    });

    it("requires a dialog turn", () => {
      const base = validSource().scenarios[0]!;
      const source = {
        ...validSource(),
        scenarios: [{ ...base, turns: [{ kind: "initial", difficulty: 20 }], expected: { mustNotReveal: ["counter = 3"] } }],
      } as unknown as TutorQualityCorpusSource;
      expect(() => parseTutorQualityCorpus(source, references)).toThrow(/mustNotReveal/);
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
