import { describe, expect, it } from "vitest";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { curriculumTopicSchema, validateCurriculumTopic, type CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { createTutorProgressionState, type TutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { BUILT_IN_TUTOR_STRATEGY, type EffectiveTutorStrategy } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";
import type { LLMProvider } from "../../../../server/services/tutor/llm-provider";
import type { TutorAnswerRating, TutorDialogTurn } from "../../../../shared/tutor";

// TutorQuality SSOT §3: strict repetition never reuses a previously used Question ID. The browser
// sends at most the last INPUT_LIMITS.tutor.maxHistoryEntries dialog turns, while the progression
// state keeps the whole session's evidence. A question that has left the dialog window is still used,
// and a Concept mastered earlier in the session is still mastered.

const REVISION = "b".repeat(40);
const SKETCH = "int x = 3;\nvoid setup() { Serial.begin(9600); Serial.println(x); }\nvoid loop() {}";

function question(id: string, concept: string, kind: string, indicator = `${concept}-indicator`) {
  return {
    id,
    concept,
    indicator,
    kind,
    difficulty: [1, 90],
    requires: [{ fact: "serial-call", values: ["print"] }],
    text: `Welche Beobachtung prüft ${id} am Sketch?`,
  };
}

function concept(id: string) {
  return {
    id,
    title: id,
    objective: `${id} erklären.`,
    prerequisites: [],
    difficulty: { entry: [1, 50], transfer: [20, 80] },
    misconceptions: [],
    indicators: [{ id: `${id}-indicator`, description: `${id} erklären.` }],
    mastery: {
      minimumSuccessfulProbes: 1,
      successRatingAtLeast: 3,
      requiredIndicators: [`${id}-indicator`],
      minimumDistinctQuestionKinds: 1,
      recentWeakAnswersAllowed: 0,
    },
  };
}

const PROGRESSION = {
  entryConcepts: ["values"],
  preferredOrder: ["values", "output"],
  onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" },
};

/** Two LEARN Concepts plus post-mastery questions; schema v2 with one extension. */
function sessionTopic(): CurriculumTopic {
  return validateCurriculumTopic(curriculumTopicSchema.parse({
    schemaVersion: 2,
    id: "session-topic",
    title: "Session",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [concept("values"), concept("output")],
    questions: [
      question("values-concept", "values", "concept"),
      question("values-application", "values", "application"),
      question("values-prediction", "values", "prediction"),
      question("output-concept", "output", "concept"),
      question("output-application", "output", "application"),
      question("output-transfer", "output", "transfer"),
    ],
    scaffolds: [],
    progression: PROGRESSION,
    deepening: { minimumSuccessfulProbes: 2, successRatingAtLeast: 4, requiredQuestionKinds: ["transfer"], recentWeakAnswersAllowed: 0 },
    extensions: [{ topic: "extension-target", objective: "Eine weitere Beobachtung am Sketch ableiten." }],
  }));
}

function extensionTarget(): CurriculumTopic {
  return validateCurriculumTopic(curriculumTopicSchema.parse({
    schemaVersion: 1,
    id: "extension-target",
    title: "Ziel",
    locale: "de-DE",
    activation: { any: [{ fact: "type-used", values: ["float"] }] },
    concepts: [concept("target")],
    questions: [{ ...question("target-concept", "target", "concept"), requires: [{ fact: "type-used", values: ["float"] }] }],
    scaffolds: [],
    progression: { ...PROGRESSION, entryConcepts: ["target"], preferredOrder: ["target"] },
  }));
}

function content(strategy: EffectiveTutorStrategy = BUILT_IN_TUTOR_STRATEGY): TutorPlanningContentContext & { progressionState: TutorProgressionState } {
  return {
    revision: REVISION,
    tutor: {
      status: "valid",
      manifest: { schemaVersion: 1, defaultStrategy: strategy.id, topics: [], strategies: [] },
      topics: [sessionTopic(), extensionTarget()],
      strategies: [strategy],
    },
    progressionState: createTutorProgressionState(REVISION),
  };
}

type Step = { readonly questionId?: string; readonly phase?: string; readonly blocked?: string };

/**
 * One Tutor session through the real TutorService and CurriculumTutorAdapter. The provider only
 * rates; the browser window keeps the last `window` dialog turns, as use-tutor.ts does.
 */
async function runSession(options: {
  readonly turns: number;
  readonly window: number;
  readonly rating: (turn: number) => TutorAnswerRating;
  readonly strategy?: EffectiveTutorStrategy;
}): Promise<{ readonly served: Step[]; readonly state: TutorProgressionState }> {
  let turn = 0;
  const provider: LLMProvider = {
    async listModels() { return ["m"]; },
    async generateLearningQuestion() {
      return { model: "m", result: { responseStyle: "normal" as const, answerRating: options.rating(turn), feedback: "Kurz.", question: "Welche weitere Beobachtung machst du?" } };
    },
  };
  const courseContent = content(options.strategy);
  const service = new TutorService(provider, new CurriculumTutorAdapter());
  const dialog: TutorDialogTurn[] = [];
  let current = (await service.generateQuestion(SKETCH, "key", "m", 40, courseContent)).result;
  const served: Step[] = [{ questionId: current.questionId, phase: current.learningPhase, blocked: current.progressionBlockedReason }];
  for (turn = 1; turn <= options.turns; turn += 1) {
    const window = options.window === 0 ? [] : dialog.slice(-options.window);
    const next = (await service.generateDialogResponse(SKETCH, window, current.question, "Antwort", "key", "m", 40, courseContent)).result;
    dialog.push({
      question: current.question,
      answer: "Antwort",
      responseStyle: "normal",
      answerRating: options.rating(turn),
      ...(current.questionId ? { questionId: current.questionId } : {}),
    });
    served.push({ questionId: next.questionId, phase: next.learningPhase, blocked: next.progressionBlockedReason });
    current = next;
  }
  return { served, state: courseContent.progressionState };
}

function plannedIds(served: readonly Step[]): string[] {
  return served.flatMap(({ questionId }) => questionId ? [questionId] : []);
}

function duplicates(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

describe("session-wide question repetition (strict)", () => {
  for (const window of [8, 2, 1, 0]) {
    it(`never serves a planned Question ID twice from LEARN through DEEPEN to EXPAND (dialog window ${window})`, async () => {
      const { served } = await runSession({ turns: 9, window, rating: () => 5 });

      expect(served.map(({ phase }) => phase)).toEqual(expect.arrayContaining(["LEARN", "DEEPEN", "EXPAND"]));
      expect(duplicates(plannedIds(served))).toEqual([]);
    });
  }

  it("offers the unused extension when a continuous dialog reaches EXPAND (R-EXP-2)", async () => {
    // The full window: before, EXPAND reached through the dialog only advanced through Topic
    // questions, so a generated extension was offered only at a session start already in EXPAND.
    const { served } = await runSession({ turns: 9, window: 8, rating: () => 5 });
    const expand = served.filter(({ phase }) => phase === "EXPAND");

    expect(expand.map(({ questionId }) => questionId)).toContain("expand-extension-target");
    expect(expand.findIndex(({ questionId }) => questionId === "expand-extension-target"))
      .toBeLessThan(expand.findIndex(({ blocked }) => blocked === "content-exhausted"));
  });

  it("does not re-serve a LEARN question in DEEPEN after it has left the dialog window", async () => {
    const { served } = await runSession({ turns: 4, window: 0, rating: () => 5 });
    const learn = served.filter(({ phase }) => phase === "LEARN").flatMap(({ questionId }) => questionId ? [questionId] : []);
    const deepen = served.filter(({ phase }) => phase === "DEEPEN").flatMap(({ questionId }) => questionId ? [questionId] : []);

    expect(deepen.length).toBeGreaterThan(0);
    expect(deepen.filter((id) => learn.includes(id))).toEqual([]);
  });

  it("does not probe a Concept again once it was mastered earlier in the session", async () => {
    // The first answer masters "values"; with an empty window the next plan must still know that.
    const { served } = await runSession({ turns: 2, window: 0, rating: () => 5 });

    expect(served[0]?.questionId?.startsWith("values-")).toBe(true);
    expect(served[1]?.questionId?.startsWith("output-")).toBe(true);
  });

  it("keeps the progression state shape and records each answered planned question once", async () => {
    const { served, state } = await runSession({ turns: 9, window: 0, rating: () => 5 });
    const answered = plannedIds(served.slice(0, -1));
    const recorded = [
      ...(state.masteryEvidence["session-topic"] ?? []),
      ...(state.postMasteryEvidence["session-topic"] ?? []),
    ].map(({ questionId }) => questionId);

    // No new state: the session's evidence is the record of used questions.
    const stateFields = ["revision", "activeTopicId", "phase", "masteredTopicIds", "masteryEvidence", "postMasteryEvidence", "retainedPhases", "usedExpansionTargetTopicIds", "progressionBlockedReason"];
    expect(Object.keys(state).filter((key) => !stateFields.includes(key))).toEqual([]);
    expect(duplicates(recorded)).toEqual([]);
    expect(recorded).toEqual(answered);
  });
});

describe("relaxed repetition keeps its normative revisit", () => {
  const relaxed: EffectiveTutorStrategy = { ...BUILT_IN_TUTOR_STRATEGY, id: "relaxed-policy", repetition: "relaxed" };

  it("revisits a used LEARN question only once no unused one is left, also outside the window", async () => {
    const { served } = await runSession({ turns: 5, window: 0, rating: () => 1, strategy: relaxed });
    const ids = plannedIds(served);
    const firstRepeat = ids.findIndex((id, index) => ids.indexOf(id) !== index);
    const valuesQuestions = sessionTopic().questions.filter(({ concept: conceptId }) => conceptId === "values").map(({ id }) => id);

    expect(firstRepeat).toBeGreaterThan(-1);
    expect(new Set(ids.slice(0, firstRepeat))).toEqual(new Set(valuesQuestions));
  });

  it("strict never revisits once the weak learner has used every question of the Concept", async () => {
    const { served } = await runSession({ turns: 5, window: 0, rating: () => 1 });
    const ids = plannedIds(served);

    expect(duplicates(ids)).toEqual([]);
    expect(new Set(ids)).toEqual(new Set(["values-application", "values-concept", "values-prediction"]));
  });
});
