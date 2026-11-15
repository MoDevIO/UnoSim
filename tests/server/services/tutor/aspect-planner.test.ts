import { describe, expect, it } from "vitest";
import { detectAspects } from "../../../../server/services/tutor/curriculum/aspect-detector";
import {
  leaveOpen, MAX_QUESTIONS_PER_ASPECT, planNext, recordAnswer, syncSketch, type AspectStep,
} from "../../../../server/services/tutor/curriculum/aspect-planner";
import { aspectDefinitionSchema, fillFallback, validateAspectDefinition } from "../../../../server/services/tutor/curriculum/aspect-schema";
import { createAspectSessionState, type AspectSessionState } from "../../../../server/services/tutor/curriculum/competence-state";
import { hasUnanchoredReference } from "../../../../server/services/tutor/question-concreteness";
import { aspectFixtures, TEMPERATURE_CONTROLLER } from "./support/aspect-fixtures";

const definitions = aspectFixtures();
const LOOP_SKETCH = "int values[3] = {1, 2, 3};\nvoid setup() { Serial.begin(9600); }\nvoid loop() {\n  for (int i = 0; i < 3; i++) { Serial.println(values[i]); }\n  delay(500);\n}\n";

function session(code = TEMPERATURE_CONTROLLER) {
  const state = createAspectSessionState();
  const aspects = detectAspects(code);
  syncSketch(state, aspects);
  return { state, aspects };
}

/** Plans a question, rates its answer, and returns the step that was asked. */
function ask(state: AspectSessionState, aspects: ReturnType<typeof detectAspects>, rating?: number): AspectStep | null {
  const step = planNext(state, aspects, definitions);
  if (step && rating !== undefined) recordAnswer(state, rating, { closeAfterWeak: true });
  return step;
}

describe("aspect files", () => {
  it("ship at least two assignments on each of the four levels", () => {
    for (const aspect of definitions) {
      for (const level of [1, 2, 3, 4]) expect(aspect.assignments.filter((assignment) => assignment.level === level).length, `${aspect.id} level ${level}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("have fallback questions that name their site and are one question", () => {
    for (const assignment of definitions.flatMap(({ assignments }) => assignments)) {
      const question = fillFallback(assignment.fallback, { code: "temperature < TEMP_MIN", function: "loop", name: "temperature" });
      expect(question, assignment.id).toMatch(/`temperature( < TEMP_MIN)?`/);
      expect(question.match(/\?/g), assignment.id).toHaveLength(1);
      expect(hasUnanchoredReference(question), assignment.id).toBe(false);
    }
  });

  it.each([
    ["a level without two assignments", (aspect: Record<string, unknown>) => ({ ...aspect, assignments: (aspect.assignments as { level: number }[]).filter(({ level }) => level !== 4) }), /level 4/],
    ["a fallback without a site", (aspect: Record<string, unknown>) => ({ ...aspect, assignments: (aspect.assignments as object[]).map((assignment, index) => (index === 0 ? { ...assignment, fallback: "Was tut der Sketch?" } : assignment)) }), /must name its site/],
    ["an unknown slot", (aspect: Record<string, unknown>) => ({ ...aspect, assignments: (aspect.assignments as object[]).map((assignment, index) => (index === 0 ? { ...assignment, fallback: "Was tut {code} in {zeile}?" } : assignment)) }), /Unknown slot/],
    ["two questions in one fallback", (aspect: Record<string, unknown>) => ({ ...aspect, assignments: (aspect.assignments as object[]).map((assignment, index) => (index === 0 ? { ...assignment, fallback: "Was tut {code}? Und warum?" } : assignment)) }), /exactly one question/],
  ])("reject %s", (_name, change, message) => {
    const raw = JSON.parse(JSON.stringify(definitions[0])) as Record<string, unknown>;
    expect(() => validateAspectDefinition(aspectDefinitionSchema.parse(change(raw)))).toThrow(message);
  });

  it("reject an aspect the detector does not know and a feature a site cannot offer", () => {
    const raw = JSON.parse(JSON.stringify(definitions[0])) as { id: string; assignments: { needs?: string[] }[] };
    expect(aspectDefinitionSchema.safeParse({ ...raw, id: "pointers" }).success).toBe(false);
    raw.assignments[0]!.needs = ["recursion"];
    expect(aspectDefinitionSchema.safeParse(raw).success).toBe(false);
  });
});

describe("aspect planner", () => {
  it("starts with the heaviest aspect on level 2", () => {
    const { state, aspects } = session();
    const step = ask(state, aspects);
    expect(step).toMatchObject({ aspect: { id: "branching" }, level: 2 });
    expect(step?.fallbackQuestion).toContain(`\`${step?.site.code}\``);
  });

  it("is deterministic: the same ratings give the same sequence", () => {
    const run = () => {
      const { state, aspects } = session();
      return [5, 3, 4, 2, 2, 5, 4, 3].map((rating) => {
        const step = ask(state, aspects, rating);
        return step ? `${step.aspect.id}/${step.level}/${step.assignment.id}/${step.site.id}` : "end";
      });
    };
    expect(run()).toEqual(run());
  });

  it("rises one level after a rating of 4 or 5 and shows the aspect on level 3", () => {
    const { state, aspects } = session();
    expect(ask(state, aspects, 5)?.level).toBe(2);
    expect(ask(state, aspects, 4)?.level).toBe(3);
    expect(state.competence.branching).toMatchObject({ level: 3, shown: true });
  });

  it("asks exactly one level 4 question after the aspect was shown, then moves on", () => {
    const { state, aspects } = session();
    ask(state, aspects, 5);
    ask(state, aspects, 5);
    expect(ask(state, aspects, 5)).toMatchObject({ aspect: { id: "branching" }, level: 4 });
    expect(ask(state, aspects)?.aspect.id).toBe("variables");
    expect(state.progress.branching).toMatchObject({ asked: 3, done: true });
  });

  it("stays on the level after a rating of 3 and takes another site", () => {
    const { state, aspects } = session();
    const first = ask(state, aspects, 3);
    const second = ask(state, aspects);
    expect(second).toMatchObject({ aspect: { id: "branching" }, level: 2 });
    expect(second?.site.id).not.toBe(first?.site.id);
  });

  it("takes another assignment on the same site when the aspect has only one site", () => {
    const { state, aspects } = session(LOOP_SKETCH);
    const first = ask(state, aspects, 3);
    const second = ask(state, aspects);
    expect(first?.aspect.id).toBe("loops");
    expect(second?.site.id).toBe(first?.site.id);
    expect(second?.assignment.id).not.toBe(first?.assignment.id);
    expect(second?.level).toBe(first?.level);
  });

  it("keeps the question after one weak answer and steps one level down after the second", () => {
    const { state, aspects } = session();
    const first = ask(state, aspects, 2);
    const again = ask(state, aspects, 1);
    expect(again?.assignment.id).toBe(first?.assignment.id);
    expect(state.progress.branching?.asked).toBe(1);
    expect(ask(state, aspects)).toMatchObject({ aspect: { id: "branching" }, level: 1 });
  });

  it("leaves an aspect after three questions without potential", () => {
    const { state, aspects } = session();
    for (const rating of [3, 3, 3]) expect(ask(state, aspects, rating)?.aspect.id).toBe("branching");
    expect(ask(state, aspects)?.aspect.id).toBe("variables");
  });

  it("grants a fourth and fifth question while the learner improves, and never a sixth", () => {
    const { state, aspects } = session();
    const asked: string[] = [];
    // Improving from 3 to 4 is potential; a 3 after it is not, so each pair buys one more question.
    for (const rating of [3, 3, 4, 3, 4, 4, 4]) {
      const step = ask(state, aspects, rating);
      if (step) asked.push(step.aspect.id);
    }
    expect(asked.filter((id) => id === "branching").length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ASPECT);
    expect(asked.filter((id) => id === "branching").length).toBeGreaterThan(3);
    expect(state.progress.branching?.asked).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ASPECT);
  });

  it("enters the next aspect by the mean of the last three ratings", () => {
    const strong = session();
    for (const rating of [5, 5, 5]) ask(strong.state, strong.aspects, rating);
    expect(ask(strong.state, strong.aspects)).toMatchObject({ aspect: { id: "variables" }, level: 3 });

    const weak = session();
    // Six weak answers: three questions, each closed one level down after its second attempt.
    for (const rating of [2, 2, 1, 1, 2, 2]) ask(weak.state, weak.aspects, rating);
    expect(ask(weak.state, weak.aspects)).toMatchObject({ aspect: { id: "variables" }, level: 1 });
  });

  it("counts a skipped question for the cap without a rating", () => {
    const { state, aspects } = session();
    ask(state, aspects);
    leaveOpen(state);
    expect(state.open).toBeUndefined();
    expect(state.progress.branching).toMatchObject({ asked: 1, ratings: [] });
    expect(state.competence.branching).toMatchObject({ level: 0, shown: false, ratings: [] });
  });

  it("ends when every aspect with assignments is handled, and skips aspects without", () => {
    const { state, aspects } = session();
    const seen = new Set<string>();
    for (let turn = 0; turn < 40; turn++) {
      const step = ask(state, aspects, 5);
      if (!step) break;
      seen.add(step.aspect.id);
    }
    expect([...seen].sort()).toEqual(["branching", "variables"]);
    expect(planNext(state, aspects, definitions)).toBeNull();
  });

  it("keeps the competence on another sketch and asks one confirming question on level 3", () => {
    const { state } = session(LOOP_SKETCH);
    const loops = detectAspects(LOOP_SKETCH);
    ask(state, loops, 5);
    ask(state, loops, 5);
    expect(state.competence.loops?.shown).toBe(true);

    const other = "void setup() {}\nvoid loop() {\n  int n = 0;\n  while (n < 4) { n++; }\n  delay(10);\n}\n";
    const aspects = detectAspects(other);
    syncSketch(state, aspects);
    expect(state.progress).toEqual({});
    const confirming = ask(state, aspects, 5);
    expect(confirming).toMatchObject({ aspect: { id: "loops" }, level: 3 });
    expect(ask(state, aspects)?.aspect.id).not.toBe("loops");
  });

  it("keeps a level 3 question over an edit and drops a level 2 question whose site is gone, uncounted", () => {
    const edited = TEMPERATURE_CONTROLLER.replace("temperature < TEMP_MIN", "temperature <= TEMP_MIN");
    const low = session();
    const lowStep = ask(low.state, low.aspects, 5);
    const second = ask(low.state, low.aspects);
    expect(second?.level).toBe(3);
    syncSketch(low.state, detectAspects(edited));
    expect(low.state.open?.assignmentId).toBe(second?.assignment.id);
    expect(lowStep).not.toBeNull();

    const dropped = session();
    const open = ask(dropped.state, dropped.aspects);
    const withoutSite = TEMPERATURE_CONTROLLER.replace(open?.site.code ?? "", "(false)");
    syncSketch(dropped.state, detectAspects(withoutSite));
    expect(dropped.state.open).toBeUndefined();
    expect(dropped.state.progress.branching?.asked).toBe(0);
  });
});
