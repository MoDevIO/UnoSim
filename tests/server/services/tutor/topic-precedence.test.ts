import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { createTutorProgressionState, markTopicMastered } from "../../../../server/services/tutor/curriculum/progression-state";
import { isTutorPlan, type TutorPlanningResult } from "../../../../server/services/tutor/tutor-planning";
import type { TutorDialogTurn } from "../../../../shared/tutor";
import { plannerWithCourseContent } from "./support/course-content-planner";

const revision = "a".repeat(40);

async function pilotTopic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

function adapter(topics: Awaited<ReturnType<typeof pilotTopic>>[], annotation?: {
  readonly topics?: string[];
  readonly primaryTopic?: string;
}) {
  return plannerWithCourseContent(async () => ({
        revision,
        tutor: {
          status: "valid" as const,
          manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
          topics,
          strategies: [],
        },
        ...(annotation ? { exampleTutorAnnotation: { schemaVersion: 1 as const, ...annotation } } : {}),
      }));
}

function plannedTopicId(result: TutorPlanningResult | null): string | undefined {
  expect(isTutorPlan(result)).toBe(true);
  return isTutorPlan(result) ? result.topicId : undefined;
}

describe("Tutor topic precedence", () => {
  it("chooses an applicable active-example primary topic first", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const result = await adapter([memory, arrays], {
      topics: ["arrays", "memory-and-data-types"],
      primaryTopic: "memory-and-data-types",
    }).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, exampleId: "example" });
    expect(plannedTopicId(result)).toBe("memory-and-data-types");
  });

  it("uses other bound topics before fact-matched repository topics", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const result = await adapter([memory, arrays], { topics: ["memory-and-data-types", "arrays"] })
      .planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30, exampleId: "example" });
    expect(plannedTopicId(result)).toBe("memory-and-data-types");
  });

  it("falls back to fact matching and then to free Tutor when no bound topic applies", async () => {
    const memory = await pilotTopic();
    const arrays = { ...memory, id: "arrays" };
    const factMatch = await adapter([memory, arrays]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(plannedTopicId(factMatch)).toBe("arrays");

    const noMatch = await adapter([memory]).planInitial({ code: "void setup(){} void loop(){}", history: [], difficulty: 30 });
    expect(noMatch).toBeNull();
  });

  it("skips a mastered Topic and keeps the next applicable Topic in LEARN", async () => {
    const primary = await pilotTopic();
    const secondary = { ...primary, id: "arrays" };
    const state = createTutorProgressionState(revision);
    state.activeTopicId = primary.id;
    markTopicMastered(state, primary.id);
    const result = await plannerWithCourseContent(async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
            topics: [primary, secondary],
            strategies: [],
          },
          exampleTutorAnnotation: { schemaVersion: 1 as const, topics: [primary.id, secondary.id], primaryTopic: primary.id },
        })).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(result).toMatchObject({ topicId: "arrays", learningPhase: "LEARN" });
  });

  it("reports content exhaustion instead of treating an unresolved Topic as mastered", async () => {
    const memory = await pilotTopic();
    const history: TutorDialogTurn[] = memory.questions.map((question) => ({
      question: question.text ?? question.template ?? question.id,
      questionId: question.id,
      answer: "Antwort",
      responseStyle: "normal",
      answerRating: 3,
    }));
    const result = await adapter([memory]).planInitial({ code: "int values[] = {1, 2};", history, difficulty: 30 });
    expect(result).toMatchObject({ kind: "blocked", progressionBlockedReason: "content-exhausted", learningPhase: "LEARN" });
  });

  it("uses an extension only as guidance after normal fact matching activates its target", async () => {
    const source = await pilotTopic();
    const primary = { ...source, schemaVersion: 2 as const, id: "memory", extensions: [{ topic: "arrays", objective: "Ein Array-Beispiel vergleichen." }] };
    const target = { ...source, schemaVersion: 2 as const, id: "arrays" };
    const state = createTutorProgressionState(revision);
    state.activeTopicId = primary.id;
    state.phase = "EXPAND";
    state.retainedPhases[primary.id] = "EXPAND";
    markTopicMastered(state, primary.id);
    const result = await plannerWithCourseContent(async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 2 as const, topics: [], strategies: [] },
            topics: [primary, target],
            strategies: [],
          },
        })).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(result).toMatchObject({ topicId: "arrays", learningPhase: "LEARN", extensionTargetTopicId: "arrays" });
  });

  it("guides EXPAND with an extension objective without activating its target", async () => {
    const source = await pilotTopic();
    const primary = {
      ...source,
      schemaVersion: 2 as const,
      id: "memory",
      extensions: [{ topic: "arrays", objective: "Ein Array-Beispiel vergleichen." }],
    };
    const target = {
      ...source,
      schemaVersion: 2 as const,
      id: "arrays",
      activation: { any: [{ fact: "serial-call" as const, values: ["write"] }] },
    };
    const state = createTutorProgressionState(revision);
    state.activeTopicId = primary.id;
    state.phase = "EXPAND";
    state.retainedPhases[primary.id] = "EXPAND";
    markTopicMastered(state, primary.id);
    const adapter = plannerWithCourseContent(async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 2 as const, topics: [], strategies: [] },
            topics: [primary, target],
            strategies: [],
          },
        }));

    const expansion = await adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 });
    expect(expansion).toMatchObject({ topicId: primary.id, learningPhase: "EXPAND", activeTopicId: primary.id });
    expect(expansion).toMatchObject({ expansionBrief: { sourceTopicId: primary.id, targetTopicId: target.id, objective: "Ein Array-Beispiel vergleichen." } });
    expect(expansion).not.toMatchObject({ activeTopicId: target.id, extensionTargetTopicId: target.id });

    const activated = await adapter.planInitial({ code: "int values[] = {1, 2}; void setup(){ Serial.write('A'); }", history: [], difficulty: 30 });
    expect(activated).toMatchObject({ topicId: target.id, learningPhase: "LEARN", activeTopicId: target.id, extensionTargetTopicId: target.id });
  });
});
