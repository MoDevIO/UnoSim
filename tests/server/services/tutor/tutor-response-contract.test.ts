import { describe, expect, it } from "vitest";
import type { TutorContentResult, TutorDialogTurn } from "@shared/tutor";
import { TutorProviderError, type LLMProvider, type LLMProviderRequest } from "../../../../server/services/tutor/llm-provider";
import { TutorService, type TutorDialogSupport } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState, type TutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { classifyTopic, type Observation } from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import type { CurriculumQuestion, CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { runTutorQualityScenario } from "./support/tutor-quality-scenario-runner";

// Tutor response contract: the provider answers freely, the application decides. Provider and the
// Course Content source are the only fakes; TutorService, CurriculumTutorAdapter, planner and the
// progression state are real. Expected values are derived from the fixture below, not from the
// algorithm under test.

const revision = "a".repeat(40);
const sketch = "int value = 3; void setup() { Serial.println(value); } void loop() {}";
const TOPIC_ID = "variables-and-serial";

const Q1: CurriculumQuestion = {
  id: "first-question",
  concept: "variable-values",
  indicator: "value-use",
  kind: "concept",
  difficulty: [1, 50],
  requires: [{ fact: "serial-call", values: ["print"] }],
  text: "Welche Rolle hat value im Sketch?",
};
const Q2: CurriculumQuestion = { ...Q1, id: "second-question", kind: "application", text: "Wie wird value bei der seriellen Ausgabe verwendet?" };

function topic(questions: readonly CurriculumQuestion[]): CurriculumTopic {
  return {
    schemaVersion: 1,
    id: TOPIC_ID,
    title: "Variablen",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "variable-values",
      title: "Variablenwerte",
      objective: "Werte erklären",
      prerequisites: [],
      difficulty: { entry: [1, 50], transfer: [20, 80] },
      misconceptions: [],
      indicators: [{ id: "value-use", description: "Wert und Verwendung" }],
      mastery: { minimumSuccessfulProbes: 1, successRatingAtLeast: 3, requiredIndicators: ["value-use"], minimumDistinctQuestionKinds: 1, recentWeakAnswersAllowed: 0 },
    }],
    questions: questions.map((question) => ({ ...question })),
    scaffolds: [],
    progression: {
      entryConcepts: ["variable-values"],
      preferredOrder: ["variable-values"],
      onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" },
    },
  };
}

function content(questions: readonly CurriculumQuestion[], state: TutorProgressionState = createTutorProgressionState(revision)) {
  return {
    revision,
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [topic(questions)], strategies: [] },
    progressionState: state,
  };
}

function history(question: CurriculumQuestion, rating: 1 | 2 | 3 | 4 | 5 = 2): TutorDialogTurn[] {
  return [{ question: question.text!, questionId: question.id, answer: "irgendetwas", answerRating: rating, responseStyle: "normal" }];
}

/** Provider fake with an exact script: an unplanned further call fails the test instead of getting a default. */
function scriptedProvider(...script: readonly (Record<string, unknown> | Error)[]) {
  const requests: LLMProviderRequest[] = [];
  const provider: LLMProvider = {
    async listModels() { return ["fake-model"]; },
    async generateLearningQuestion(request) {
      requests.push(request);
      const next = script[requests.length - 1];
      if (next === undefined) throw new Error(`unexpected provider call #${requests.length}`);
      if (next instanceof Error) throw next;
      return { model: "fake-model", result: next as TutorContentResult }; // raw provider output: the service validates it
    },
  };
  return { provider, requests };
}

async function dialog(provider: LLMProvider, args: { question: string; answer: string; history?: readonly TutorDialogTurn[]; courseContent?: ReturnType<typeof content>; support?: TutorDialogSupport; signal?: AbortSignal; planning?: CurriculumTutorAdapter }) {
  const planning = args.planning ?? (args.courseContent ? new CurriculumTutorAdapter() : undefined);
  return new TutorService(provider, planning).generateDialogResponse(
    sketch, args.history ?? [], args.question, args.answer, "fake-credential", undefined, undefined, args.courseContent, args.signal, {}, args.support,
  );
}

describe("RC-01: provider identifiers are no authority", () => {
  it("initial question: a different topic, question, concept and phase from the provider change neither result nor state", async () => {
    const course = content([Q1]);
    const trace = await runTutorQualityScenario({
      id: "RC-01-initial",
      code: sketch,
      action: { kind: "initial" },
      provider: { kind: "result", result: { question: "Providerfrage?", topicId: "other-topic", conceptId: "other-concept", questionId: Q2.id, learningPhase: "EXPAND", contentRevision: "f".repeat(40) } },
      courseContent: course,
    });
    expect(trace.error).toBeUndefined();
    expect(trace.result).toMatchObject({ question: Q1.text, topicId: TOPIC_ID, conceptId: "variable-values", questionId: Q1.id, learningPhase: "LEARN", contentRevision: revision });
    expect(trace.stateAfter?.activeTopicId).toBe(TOPIC_ID);
    expect(trace.stateAfter?.masteryEvidence).toEqual({});
  });

  it("dialog turn: the provider's own question id does not become the next question; the evidence belongs to the answered question", async () => {
    const course = content([Q1, Q2]);
    const { provider } = scriptedProvider({ answerRating: 2, question: "Providerfrage?", topicId: "other-topic", questionId: Q2.id, learningPhase: "EXPAND" });
    const response = await dialog(provider, { question: Q1.text!, answer: "keine Ahnung genau", courseContent: course });
    // Q1 was answered weakly: the plan remediates with the only unused question of the Topic, whatever the provider claimed.
    expect(response.result.questionId).toBe(Q2.id);
    expect(response.result.question).toBe(Q2.text);
    expect(response.result.topicId).toBe(TOPIC_ID);
    expect(response.result.learningPhase).toBe("LEARN");
    expect(course.progressionState.masteryEvidence[TOPIC_ID]).toEqual([
      { questionId: Q1.id, conceptId: "variable-values", indicatorId: "value-use", kind: "concept", rating: 2 },
    ]);
  });
});

describe("RC-02: a repeated question after a successful answer is replaced; an open weak question may stay", () => {
  const TRANSITION = "Welche Ausgabe oder Messgröße kannst du als Nächstes aus dem seriellen Ablauf des Sketches ableiten?";
  const current = "Welche Rolle hat value im Sketch?";

  it.each([
    ["RC-02a exact", "Welche Rolle hat value im Sketch?"],
    ["RC-02a heuristic", "Welche Rolle spielt value in diesem Sketch?"],
  ])("%s: the strong answer's repeated question becomes the application's transition question", async (_id, repeated) => {
    const { provider, requests } = scriptedProvider({ answerRating: 5, question: repeated });
    const response = await dialog(provider, { question: current, answer: "value speichert 3 und wird ausgegeben." });
    expect(response.result.question).toBe(TRANSITION);
    expect(response.followUpSource).toBe("application-fallback");
    expect(requests).toHaveLength(1);
  });

  it("control: a really new question after a strong answer is kept as the provider's", async () => {
    const fresh = "Welche Zahl gibt die serielle Schnittstelle als Baudrate vor?";
    const { provider } = scriptedProvider({ answerRating: 5, question: fresh });
    const response = await dialog(provider, { question: current, answer: "value speichert 3 und wird ausgegeben." });
    expect(response.result.question).toBe(fresh);
    expect(response.followUpSource).toBe("provider");
  });

  it("RC-02b: a weak answer in the support cycle keeps the open question unchanged, even if the provider repeats it", async () => {
    const { provider } = scriptedProvider({ answerRating: 2, question: current });
    const response = await dialog(provider, { question: current, answer: "keine Ahnung", support: { assisted: false } });
    expect(response.retained).toBe(true);
    expect(response.result.question).toBe(current);
    expect(response.followUpSource).toBe("application-fallback");
  });

  it("RC-02b control: the same weak answer with a different provider question still keeps the asked question", async () => {
    const { provider } = scriptedProvider({ answerRating: 2, question: "Etwas ganz anderes?" });
    const response = await dialog(provider, { question: current, answer: "keine Ahnung", support: { assisted: false } });
    expect(response.retained).toBe(true);
    expect(response.result.question).toBe(current);
  });
});

describe("RC-03: a real plan question replaces the provider's, transition and blocked keep the checked one", () => {
  it("RC-03a: a weak answer with an unused question left is followed by exactly that planned question", async () => {
    const course = content([Q1, Q2]);
    const { provider } = scriptedProvider({ answerRating: 2, question: "Eine Providerfrage, die niemand planen wollte?" });
    const response = await dialog(provider, { question: Q1.text!, answer: "weiß nicht genau", courseContent: course });
    expect(response.result.question).toBe(Q2.text);
    expect(response.result.questionId).toBe(Q2.id);
    expect(response.followUpSource).toBe("planner");
  });

  it("RC-03b transition: the Topic has no further LEARN question, so the provider's valid question stays (no plan question)", async () => {
    const course = content([Q1]);
    const fresh = "Welche Zahl gibt die serielle Schnittstelle als Baudrate vor?";
    const { provider } = scriptedProvider({ answerRating: 5, question: fresh });
    const response = await dialog(provider, { question: Q1.text!, answer: "value speichert 3 und wird ausgegeben.", courseContent: course });
    expect(response.result.question).toBe(fresh);
    expect(response.result).not.toHaveProperty("questionId");
    expect(response.followUpSource).toBe("provider");
    expect(response.result.contentRevision).toBe(revision);
    expect(response.result.learningPhase).toBe("LEARN");
  });

  it("RC-03b blocked: nothing is left after DEEPEN, so the provider's valid question stays and the block is reported", async () => {
    const state: TutorProgressionState = {
      ...createTutorProgressionState(revision),
      activeTopicId: TOPIC_ID,
      phase: "DEEPEN",
      masteredTopicIds: [TOPIC_ID],
      masteryEvidence: { [TOPIC_ID]: [{ questionId: Q1.id, conceptId: "variable-values", indicatorId: "value-use", kind: "concept", rating: 5 }] },
      retainedPhases: { [TOPIC_ID]: "DEEPEN" },
    };
    const course = content([Q1, Q2], state);
    const fresh = "Welche Zahl gibt die serielle Schnittstelle als Baudrate vor?";
    const { provider } = scriptedProvider({ answerRating: 5, question: fresh });
    const response = await dialog(provider, { question: Q2.text!, answer: "value wird als Argument übergeben.", courseContent: course });
    expect(response.result.question).toBe(fresh);
    expect(response.result.progressionBlockedReason).toBe("content-exhausted");
    expect(response.followUpSource).toBe("provider");
  });
});

describe("RC-04: an interrupted or failed turn leaves the progression state untouched", () => {
  const answer = "value speichert 3.";
  const weakAnswerResult = { answerRating: 2, question: "Providerfrage?" };

  async function freshCourse() {
    const course = content([Q1, Q2]);
    return { course, before: structuredClone(course.progressionState) };
  }

  it("RC-04a: an abort that arrives after the planner already worked on its copy does not change the state", async () => {
    const { course, before } = await freshCourse();
    const controller = new AbortController();
    class AbortingAdapter extends CurriculumTutorAdapter {
      override async planFollowup(input: Parameters<CurriculumTutorAdapter["planFollowup"]>[0]) {
        const plan = await super.planFollowup(input);
        controller.abort();
        return plan;
      }
    }
    const { provider } = scriptedProvider(weakAnswerResult);
    await expect(dialog(provider, { question: Q1.text!, answer, courseContent: course, signal: controller.signal, planning: new AbortingAdapter() })).rejects.toThrow();
    expect(course.progressionState).toEqual(before);
  });

  it("RC-04b: a provider failure after the planner read the state leaves it unchanged", async () => {
    const { course, before } = await freshCourse();
    const { provider, requests } = scriptedProvider(new TutorProviderError("provider-unavailable"));
    await expect(dialog(provider, { question: Q1.text!, answer, courseContent: course })).rejects.toMatchObject({ kind: "provider-unavailable" });
    expect(requests).toHaveLength(1);
    expect(course.progressionState).toEqual(before);
  });

  it("RC-04b: a planner failure inside the turn leaves the state unchanged", async () => {
    const { course, before } = await freshCourse();
    class FailingAdapter extends CurriculumTutorAdapter {
      override async planFollowup(input: Parameters<CurriculumTutorAdapter["planFollowup"]>[0]): Promise<never> {
        await super.planFollowup(input);
        throw new Error("planner crashed after recording evidence");
      }
    }
    const { provider } = scriptedProvider(weakAnswerResult);
    await expect(dialog(provider, { question: Q1.text!, answer, courseContent: course, planning: new FailingAdapter() })).rejects.toThrow("planner crashed");
    expect(course.progressionState).toEqual(before);
  });

  it("control: the successful turn adds the evidence of the answered question exactly once", async () => {
    const { course } = await freshCourse();
    const { provider } = scriptedProvider(weakAnswerResult);
    await dialog(provider, { question: Q1.text!, answer, courseContent: course });
    expect(course.progressionState.masteryEvidence[TOPIC_ID]).toHaveLength(1);
    expect(course.progressionState.masteryEvidence[TOPIC_ID]![0]).toMatchObject({ questionId: Q1.id, rating: 2 });
    expect(course.progressionState.masteredTopicIds).toEqual([]);
  });

  it("control: a retained support answer after history with the same question still counts one observation, not two", async () => {
    const { course } = await freshCourse();
    const { provider } = scriptedProvider(weakAnswerResult);
    await dialog(provider, { question: Q1.text!, answer, courseContent: course, history: history(Q1), support: { assisted: false } });
    expect(course.progressionState.masteryEvidence[TOPIC_ID]).toHaveLength(1);
  });
});

describe("RC-05: Topic mastery follows the indicators and question kinds, not the difficulty", () => {
  // Independent reference for the mini Topic: two indicators, both required; two successful probes;
  // two distinct kinds; success from rating 4. Every expectation below is read off these rules.
  const mini: CurriculumTopic = (() => {
    const base = topic([]);
    const questions: CurriculumQuestion[] = [
      { ...Q1, id: "q-a-concept", indicator: "ind-a", kind: "concept", difficulty: [1, 100] },
      { ...Q1, id: "q-b-application", indicator: "ind-b", kind: "application", difficulty: [1, 100] },
      { ...Q1, id: "q-b-concept", indicator: "ind-b", kind: "concept", difficulty: [1, 100] },
    ];
    return {
      ...base,
      questions,
      concepts: [{
        ...base.concepts[0]!,
        indicators: [{ id: "ind-a", description: "A" }, { id: "ind-b", description: "B" }],
        mastery: { minimumSuccessfulProbes: 2, successRatingAtLeast: 4, requiredIndicators: ["ind-a", "ind-b"], minimumDistinctQuestionKinds: 2, recentWeakAnswersAllowed: 0 },
      }],
    };
  })();
  const facts = new DefaultSketchFactExtractor().extract(sketch);
  const obs = (questionId: string, indicatorId: string, kind: string, rating: number): Observation =>
    ({ questionId, conceptId: "variable-values", indicatorId, kind, rating }) as Observation;
  const status = (observations: readonly Observation[], difficulty: number) =>
    classifyTopic(mini, facts, observations, new Set(observations.map((o) => o.questionId)), difficulty).status;

  it("without evidence the Topic is probeable at every allowed difficulty", () => {
    expect(status([], 5)).toBe("probeable");
    expect(status([], 95)).toBe("probeable");
  });

  it("one indicator alone is not mastery, even with the strongest rating", () => {
    expect(status([obs("q-a-concept", "ind-a", "concept", 5)], 50)).toBe("probeable");
  });

  it("both indicators, but a single question kind, is not mastery", () => {
    expect(status([obs("q-a-concept", "ind-a", "concept", 5), obs("q-b-concept", "ind-b", "concept", 5)], 50)).toBe("probeable");
  });

  it("both indicators with a rating below the success rating is not mastery", () => {
    expect(status([obs("q-a-concept", "ind-a", "concept", 5), obs("q-b-application", "ind-b", "application", 3)], 50)).toBe("probeable");
  });

  it("both indicators, two kinds, ratings at the success rating: mastered — the same at two different allowed difficulties", () => {
    const evidence = [obs("q-a-concept", "ind-a", "concept", 5), obs("q-b-application", "ind-b", "application", 4)];
    expect(status(evidence, 10)).toBe("mastered");
    expect(status(evidence, 90)).toBe("mastered");
  });

  it("a trailing weak answer after sufficient evidence withdraws mastery, although no difficulty changed", () => {
    const evidence = [obs("q-a-concept", "ind-a", "concept", 5), obs("q-b-application", "ind-b", "application", 4), obs("q-b-concept", "ind-b", "concept", 2)];
    // Not mastered (recentWeakAnswersAllowed is 0); all three questions are used, so nothing is left to probe.
    expect(status(evidence, 50)).toBe("unresolved");
  });
});
