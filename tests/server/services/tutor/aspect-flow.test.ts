import { describe, expect, it } from "vitest";
import type { TutorDialogTurn } from "@shared/tutor";
import { namesAssignmentSite } from "../../../../server/services/tutor/assignment-prompt";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { hasUnanchoredReference } from "../../../../server/services/tutor/question-concreteness";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";
import { aspectFixtures, fixtureText, TEMPERATURE_CONTROLLER } from "./support/aspect-fixtures";
import { curriculumTopicSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { parse as parseYaml } from "yaml";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { setFocus } from "../../../../server/services/tutor/curriculum/aspect-planner";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

const revision = "4".repeat(40);
const catalogTopic = validateCurriculumTopic(curriculumTopicSchema.parse(parseYaml(fixtureText("tutor-quality/TQ-REG-003-variables-and-serial.yaml"))));

function courseContent(withAspects = true): TutorPlanningContentContext & { progressionState: NonNullable<TutorPlanningContentContext["progressionState"]> } {
  return {
    revision,
    tutor: {
      status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [catalogTopic], strategies: [],
      ...(withAspects ? { aspects: aspectFixtures() } : {}),
    },
    progressionState: createTutorProgressionState(revision),
  };
}

const NAMED = "Was geschieht in `loop()` mit den Anweisungen nach dem `if`, wenn `raw` den Wert 0 hat?";
const UNNAMED = "Was geschieht nach der ersten Verzweigung, wenn die Bedingung erfüllt ist?";

function initial(content: TutorPlanningContentContext, question: string, aspectPlanning = true) {
  return runTutorQualityScenario({ id: "aspect/initial", code: TEMPERATURE_CONTROLLER, action: { kind: "initial" }, provider: { kind: "result", result: { question } }, courseContent: content, aspectPlanning });
}

function answer(content: TutorPlanningContentContext, question: string, rating: number, next: string, history: readonly TutorDialogTurn[] = []) {
  return runTutorQualityScenario({
    id: "aspect/dialog", code: TEMPERATURE_CONTROLLER, courseContent: content, aspectPlanning: true,
    action: { kind: "dialog", question, answer: "Eine Antwort mit Bezug auf loop() und raw.", history },
    provider: { kind: "result", result: { question: next, feedback: "Rückmeldung.", answerRating: rating } },
  });
}

describe("aspect flow in the Tutor service", () => {
  it("names the site of an assignment by an identifier or by its code", () => {
    const site = { code: "(temperature < TEMP_MIN)", names: ["temperature", "TEMP_MIN"] };
    expect(namesAssignmentSite("Was passiert, wenn temperature kleiner ist?", site)).toBe(true);
    expect(namesAssignmentSite("Betrachte `( temperature<TEMP_MIN )`: was folgt?", { code: site.code, names: [] })).toBe(true);
    expect(namesAssignmentSite("Was passiert bei der Temperatur?", site)).toBe(false);
    expect(namesAssignmentSite("Was ist x?", { code: "x", names: [] })).toBe(false);
  });

  it("stays off without the switch and without aspect files: the Topic catalog plans", async () => {
    for (const trace of [await initial(courseContent(), NAMED, false), await initial(courseContent(false), NAMED, true)]) {
      expect(trace.error).toBeUndefined();
      expect(trace.providerRequests[0]?.userPrompt).not.toContain("Frageauftrag der Anwendung");
      expect(trace.providerRequests[0]?.userPrompt).toContain("variables-and-serial");
      expect(trace.stateAfter?.aspects).toBeUndefined();
    }
  });

  it("gives the model the assignment and keeps its question when it names the site", async () => {
    const content = courseContent();
    const trace = await initial(content, NAMED);
    const prompt = trace.providerRequests[0]?.userPrompt ?? "";

    expect(trace.error).toBeUndefined();
    expect(prompt).toContain("Frageauftrag der Anwendung");
    expect(prompt).toContain("Aspekt „Verzweigungen“, Stufe 2 von 4 (Erklären)");
    expect(prompt).toContain("`(raw == 0)`");
    expect(trace.result).toMatchObject({ question: NAMED, topicId: "aspect-branching", conceptId: "branching-level-2", indicatorId: "level-2", questionKind: "concept" });
    expect(content.progressionState.aspects?.open).toMatchObject({ aspectId: "branching", level: 2 });
    // The fallback wording is no prompt data: the model words the question itself.
    expect(prompt).not.toContain(content.progressionState.aspects?.open?.fallback ?? "?");
  });

  it("puts the fallback question in when the model's question does not name the site", async () => {
    const content = courseContent();
    const trace = await initial(content, UNNAMED);
    const fallback = content.progressionState.aspects?.open?.fallback;

    expect(trace.result?.question).toBe(fallback);
    expect(fallback).toContain("`(raw == 0)`");
    expect(hasUnanchoredReference(fallback ?? "", TEMPERATURE_CONTROLLER)).toBe(false);
  });

  it("carries the follow-up assignment per rating and takes the one of the given rating", async () => {
    const content = courseContent();
    const first = await initial(content, NAMED);
    const next = "Welcher Zweig läuft in `loop()`, wenn `temperature` genau `TEMP_MIN` ist, und warum?";
    const trace = await answer(content, first.result?.question ?? "", 5, next);
    const prompt = trace.providerRequests[0]?.userPrompt ?? "";

    expect(trace.error).toBeUndefined();
    expect(prompt).toContain("Frageauftrag der Anwendung für die Folgefrage");
    expect(prompt).toMatch(/- Bei answerRating 4 oder 5: Aspekt „Verzweigungen“, Stufe 3 von 4 \(Vorhersagen\)/);
    expect(prompt).toMatch(/- Bei answerRating 3: Aspekt „Verzweigungen“, Stufe 2 von 4 \(Erklären\)/);
    expect(prompt).toContain("Bei answerRating 1 oder 2 bleibt die aktuelle Frage offen");
    expect(trace.result).toMatchObject({ question: next, topicId: "aspect-branching", conceptId: "branching-level-3", questionKind: "prediction" });
    expect(content.progressionState.aspects?.competence.branching).toMatchObject({ level: 2, ratings: [5] });
  });

  it("does not change the session when it previews the follow-ups and the request fails", async () => {
    const content = courseContent();
    const first = await initial(content, NAMED);
    const before = JSON.stringify(content.progressionState);
    const failed = await runTutorQualityScenario({
      id: "aspect/failure", code: TEMPERATURE_CONTROLLER, courseContent: content, aspectPlanning: true,
      action: { kind: "dialog", question: first.result?.question ?? "", answer: "Eine Antwort." },
      provider: { kind: "error", error: new Error("provider down") },
    });
    expect(failed.error).toBeDefined();
    expect(JSON.stringify(content.progressionState)).toBe(before);
  });

  it("keeps the question after a weak answer and moves on after the second", async () => {
    const content = courseContent();
    const first = await initial(content, NAMED);
    const question = first.result?.question ?? "";
    const retained = await answer(content, question, 2, "Schau noch einmal auf `raw`: was geschieht nach dem `return`?");

    expect(retained.result?.questionId).toBe(first.result?.questionId);
    expect(content.progressionState.aspects?.open?.weakAttempts).toBe(1);
    const moved = await answer(content, retained.result?.question ?? "", 1, "Welche Größe vergleicht `(temperature < TEMP_MIN)` womit?");
    expect(moved.result).toMatchObject({ topicId: "aspect-branching", conceptId: "branching-level-1" });
  });

  it("delivers only questions that name a sketch element over a whole session, then hands over", async () => {
    const content = courseContent();
    let trace = await initial(content, NAMED);
    const history: TutorDialogTurn[] = [];
    const topics = new Set<string>();
    for (let turn = 0; turn < 16 && trace.result?.topicId?.startsWith("aspect-"); turn++) {
      const question = trace.result.question;
      expect(hasUnanchoredReference(question, TEMPERATURE_CONTROLLER), question).toBe(false);
      expect(question, question).toMatch(/`[^`]+`/);
      topics.add(trace.result.topicId ?? "");
      // The model ignores every assignment here, so each delivered question is the application's fallback.
      trace = await answer(content, question, 5, UNNAMED, history.slice(-8));
      expect(trace.error).toBeUndefined();
      history.push({ question, answer: "Antwort", answerRating: 5, responseStyle: "normal" });
    }
    expect([...topics].sort()).toEqual(["aspect-branching", "aspect-variables"]);
    expect(trace.result?.topicId).toBeUndefined();
    expect(trace.result?.progressionBlockedReason).toBe("content-exhausted");
  });

  describe("after the teacher's focus (F6)", () => {
    const focus = [{ id: "relais", title: "Die Relais", objective: "Die Relais einordnen.", questions: [{ kind: "concept" as const, text: "Welche Aufgabe hat `heaterRelay` in `loop()`?" }] }];
    const withFocus = (afterFocus?: "free" | "topics") => ({
      ...courseContent(),
      exampleId: "temperaturregler",
      exampleTutorAnnotation: { schemaVersion: 2 as const, focus, ...(afterFocus ? { afterFocus } : {}) },
    });

    it("asks the focus question first and the aspects after it", async () => {
      const content = withFocus();
      const first = await initial(content, NAMED);
      expect(first.result).toMatchObject({ question: focus[0]!.questions[0]!.text });
      expect(first.result?.topicId).not.toMatch(/^aspect-/);

      const second = await answer(content, first.result?.question ?? "", 5, NAMED);
      expect(second.result).toMatchObject({ question: NAMED, topicId: "aspect-branching", conceptId: "branching-level-2" });
    });

    it("stays with the free Tutor when the teacher set afterFocus to free", async () => {
      const content = withFocus("free");
      const first = await initial(content, NAMED);
      const second = await answer(content, first.result?.question ?? "", 5, NAMED);
      expect(second.result?.topicId ?? "").not.toMatch(/^aspect-/);
      expect(content.progressionState.aspects).toBeUndefined();
    });
  });

  it("names the site for the diagram only when the assignment asks for one", async () => {
    const adapter = new CurriculumTutorAdapter({ aspectPlanning: true });
    const content = courseContent();
    const plan = await adapter.planInitial({ code: TEMPERATURE_CONTROLLER, history: [], difficulty: 30, courseContent: content });
    if (!plan || "kind" in plan) throw new Error("plan expected");
    // The first question explains a branch: its diagram would show the answer.
    expect(adapter.questionGraphic({ code: TEMPERATURE_CONTROLLER, currentQuestion: plan.question, courseContent: content })).toBeUndefined();
    const next = await adapter.planFollowup({ code: TEMPERATURE_CONTROLLER, history: [], currentQuestion: plan.question, rating: 5, difficulty: 30, courseContent: content });
    if (!next || "kind" in next) throw new Error("follow-up expected");
    expect(next.assignment?.graphic).toBe("activity");
    expect(adapter.questionGraphic({ code: TEMPERATURE_CONTROLLER, currentQuestion: next.question, courseContent: content })).toEqual({ kind: "activity", siteCode: next.assignment?.site.code });
    expect(adapter.questionGraphic({ code: TEMPERATURE_CONTROLLER, currentQuestion: "Was ist ein Pin?", courseContent: content })).toBeUndefined();
  });

  it("offers the sketch's aspects for the learner to choose and names the chosen one", async () => {
    const adapter = new CurriculumTutorAdapter({ aspectPlanning: true });
    const content = courseContent();
    const plan = await adapter.planInitial({ code: TEMPERATURE_CONTROLLER, history: [], difficulty: 30, courseContent: content });
    if (!plan || "kind" in plan) throw new Error("plan expected");
    expect(plan.aspectChoices?.map(({ id, state }) => `${id}:${state}`)).toEqual(["branching:open", "variables:open"]);
    expect(plan.aspectFocus).toBeUndefined();
    const aspects = content.progressionState.aspects;
    if (!aspects) throw new Error("aspect state expected");
    setFocus(aspects, "variables");
    const next = await adapter.planFollowup({ code: TEMPERATURE_CONTROLLER, history: [], currentQuestion: plan.question, rating: 5, difficulty: 30, courseContent: content });
    if (!next || "kind" in next) throw new Error("follow-up expected");
    expect([next.topicId, next.aspectFocus]).toEqual(["aspect-variables", "variables"]);
  });

  it("asks the aspects a teacher listed for the Example first", async () => {
    const adapter = new CurriculumTutorAdapter({ aspectPlanning: true });
    const content = { ...courseContent(), exampleId: "temperaturregler", exampleTutorAnnotation: { schemaVersion: 2 as const, aspects: ["variables"] } };
    const plan = await adapter.planInitial({ code: TEMPERATURE_CONTROLLER, history: [], difficulty: 30, courseContent: content });
    if (!plan || "kind" in plan) throw new Error("plan expected");
    expect(plan.topicId).toBe("aspect-variables");
  });
});
