import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_TUTOR_STRATEGY, type EffectiveTutorStrategy } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import type { LLMProvider } from "../../../../server/services/tutor/llm-provider";
import { createTutorProgressionState, markTopicMastered } from "../../../../server/services/tutor/curriculum/progression-state";

const revision = "a".repeat(40);

async function topic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

function strategy(id: string, overrides: Partial<EffectiveTutorStrategy> = {}) {
  return { ...BUILT_IN_TUTOR_STRATEGY, id, ...overrides };
}

function strategyEntry({ id }: { readonly id: string }) {
  return { id, path: `tutor/strategies/${id}.yaml`, sha256: "0".repeat(64) };
}

describe("Tutor strategy precedence", () => {
  it("chooses per-example strategy over repository default", async () => {
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, defaultStrategy: "repository-default", topics: [], strategies: [] },
            topics: [await topic()],
            strategies: [strategy("repository-default"), strategy("example-policy")],
          },
          exampleTutorAnnotation: { schemaVersion: 1, strategy: "example-policy" },
        }),
      },
    });

    await expect(adapter.planInitial({
      code: "int values[] = {1, 2};",
      history: [],
      difficulty: 30,
      exampleId: "arrays-example",
    })).resolves.toMatchObject({ strategyId: "example-policy", strategySource: "repository" });
  });

  it("uses repository default for unbound sketches and built-in for no strategy", async () => {
    const tutor = await topic();
    const repositoryDefault = strategy("repository-default");
    const makeAdapter = (strategies: typeof repositoryDefault[]) => new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          tutor: {
            status: "valid" as const,
            manifest: { schemaVersion: 1 as const, defaultStrategy: strategies[0]?.id, topics: [], strategies: [] },
            topics: [tutor],
            strategies,
          },
        }),
      },
    });

    await expect(makeAdapter([repositoryDefault]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ strategyId: "repository-default", strategySource: "repository" });
    await expect(makeAdapter([]).planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ strategyId: "built-in-default", strategySource: "built-in" });
  });

  it("keeps strategy precedence on the free Tutor path when no topics exist", async () => {
    const repositoryDefault = strategy("repository-default");
    const provider: LLMProvider = {
      listModels: async () => ["pilot-model"],
      generateLearningQuestion: async () => ({ model: "pilot-model", result: { question: "Was passiert?", responseStyle: "normal" } }),
    };
    const context = {
      revision,
      tutor: {
        status: "valid" as const,
        manifest: { schemaVersion: 1 as const, defaultStrategy: repositoryDefault.id, topics: [], strategies: [] },
        topics: [],
        strategies: [repositoryDefault],
      },
    };

    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
      "void setup(){} void loop(){}",
      "key",
      undefined,
      30,
      context,
    )).resolves.toMatchObject({ result: { strategyId: "repository-default", strategySource: "repository" } });

    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
      "void setup(){} void loop(){}",
      "key",
      undefined,
      30,
    )).resolves.toMatchObject({ result: { strategyId: "built-in-default", strategySource: "built-in" } });
  });

  it("uses a manifest v2 phase strategy after Topic mastery", async () => {
    const tutor = await topic();
    const state = createTutorProgressionState(revision);
    state.activeTopicId = tutor.id;
    state.phase = "DEEPEN";
    state.retainedPhases[tutor.id] = "DEEPEN";
    markTopicMastered(state, tutor.id);
    const repositoryDefault = strategy("repository-default");
    const exploration = strategy("exploration-policy");
    const adapter = new CurriculumTutorAdapter({
      courseContent: {
        getSnapshot: async () => ({
          revision,
          progressionState: state,
          tutor: {
            status: "valid" as const,
            manifest: {
              schemaVersion: 2 as const,
              defaultStrategy: repositoryDefault.id,
              phaseStrategies: { deepen: exploration.id, expand: exploration.id },
              topics: [],
              strategies: [],
            },
            topics: [tutor],
            strategies: [repositoryDefault, exploration],
          },
        }),
      },
    });

    await expect(adapter.planInitial({ code: "int values[] = {1, 2};", history: [], difficulty: 30 }))
      .resolves.toMatchObject({ strategyId: exploration.id, learningPhase: "DEEPEN" });
  });

  it("returns to the repository default when the retained Topic is no longer applicable", async () => {
    const tutor = await topic();
    const state = createTutorProgressionState(revision);
    state.activeTopicId = tutor.id;
    state.phase = "DEEPEN";
    state.retainedPhases[tutor.id] = "DEEPEN";
    markTopicMastered(state, tutor.id);
    const repositoryDefault = strategy("repository-default");
    const exploration = strategy("exploration-policy");
    const provider: LLMProvider = {
      listModels: async () => ["pilot-model"],
      generateLearningQuestion: async () => ({ model: "pilot-model", result: { question: "Was passiert?", responseStyle: "normal" } }),
    };
    const context = {
      revision,
      progressionState: state,
      tutor: {
        status: "valid" as const,
        manifest: { schemaVersion: 2 as const, defaultStrategy: repositoryDefault.id, phaseStrategies: { deepen: exploration.id }, topics: [], strategies: [repositoryDefault, exploration].map(strategyEntry) },
        topics: [tutor],
        strategies: [repositoryDefault, exploration],
      },
    };
    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
      "void setup(){} void loop(){}", "key", undefined, 30, context,
    )).resolves.toMatchObject({ result: { strategyId: repositoryDefault.id, strategySource: "repository" } });
  });

  it("keeps the completed LEARN turn on its strategy and uses the phase strategy on the next turn", async () => {
    const source = await topic();
    const concept = {
      ...source.concepts[0]!,
      mastery: { ...source.concepts[0]!.mastery, minimumSuccessfulProbes: 1, minimumDistinctQuestionKinds: 1, requiredIndicators: [source.questions[0]!.indicator] },
    };
    const phaseTopic = {
      ...source,
      schemaVersion: 2 as const,
      id: "boundary-topic",
      concepts: [concept],
      questions: source.questions.slice(0, 3).map((question, index) => ({ ...question, id: `boundary-question-${index + 1}`, concept: concept.id })),
      scaffolds: [],
      progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
    };
    const precision = strategy("precision-policy", { feedbackVerbosity: "short", progression: "mastery-then-advance" });
    const exploration = strategy("exploration-policy", { feedbackVerbosity: "detailed", progression: "advance-immediately", hintFirst: true });
    const state = createTutorProgressionState(revision);
    const prompts: string[] = [];
    const provider: LLMProvider = {
      listModels: async () => ["pilot-model"],
      async generateLearningQuestion(request) {
        prompts.push(request.userPrompt);
        return {
          model: "pilot-model",
          result: {
            feedback: "Weiter.",
            answerRating: 4,
            question: "Providerfrage",
            responseStyle: "normal",
          },
        };
      },
    };
    const context = {
      revision,
      progressionState: state,
      tutor: {
        status: "valid" as const,
        manifest: {
          schemaVersion: 2 as const,
          defaultStrategy: precision.id,
          phaseStrategies: { deepen: exploration.id, expand: exploration.id },
          topics: [],
          strategies: [],
        },
        topics: [phaseTopic],
        strategies: [precision, exploration],
      },
    };
    const service = new TutorService(provider, new CurriculumTutorAdapter({ courseContent: { getSnapshot: async () => context } }));
    const initial = await service.generateQuestion("int values[] = {1, 2};", "key", undefined, 30, context);
    const firstAfterMastery = await service.generateDialogResponse(
      "int values[] = {1, 2};", [], initial.result.question, "Antwort", "key", undefined, 30, context,
    );
    expect(firstAfterMastery.result).toMatchObject({ learningPhase: "LEARN", strategyId: precision.id });

    const firstDeepen = await service.generateDialogResponse(
      "int values[] = {1, 2};", [], firstAfterMastery.result.question, "Antwort", "key", undefined, 30, context,
    );
    expect(firstDeepen.result).toMatchObject({ learningPhase: "DEEPEN", strategyId: exploration.id });
    expect(prompts.at(-1)).toContain("Progression: advance-immediately");
    expect(prompts.at(-1)).toContain("Feedback: detailed");
  });

  it("applies the EXPAND strategy only from the first request in EXPAND", async () => {
    const source = await topic();
    const concept = {
      ...source.concepts[0]!,
      mastery: { ...source.concepts[0]!.mastery, minimumSuccessfulProbes: 1, minimumDistinctQuestionKinds: 1, requiredIndicators: [source.questions[0]!.indicator] },
    };
    const questions = source.questions.slice(0, 3).map((question, index) => ({
      ...question,
      id: `expand-boundary-question-${index + 1}`,
      concept: concept.id,
      kind: index === 1 ? "transfer" as const : question.kind,
    }));
    const phaseTopic = {
      ...source,
      schemaVersion: 2 as const,
      id: "expand-boundary-topic",
      concepts: [concept],
      questions,
      scaffolds: [],
      progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
      deepening: { minimumSuccessfulProbes: 2, successRatingAtLeast: 4, requiredQuestionKinds: ["transfer" as const], recentWeakAnswersAllowed: 0 },
    };
    const deepening = strategy("deepening-policy", { feedbackVerbosity: "short" });
    const expansion = strategy("expansion-policy", { feedbackVerbosity: "detailed", progression: "advance-immediately" });
    const state = createTutorProgressionState(revision);
    state.activeTopicId = phaseTopic.id;
    state.phase = "DEEPEN";
    state.retainedPhases[phaseTopic.id] = "DEEPEN";
    markTopicMastered(state, phaseTopic.id);
    state.postMasteryEvidence[phaseTopic.id] = [{
      questionId: questions[1]!.id,
      conceptId: concept.id,
      indicatorId: questions[1]!.indicator,
      kind: "transfer",
      rating: 4,
    }];
    const prompts: string[] = [];
    const provider: LLMProvider = {
      listModels: async () => ["pilot-model"],
      async generateLearningQuestion(request) {
        prompts.push(request.userPrompt);
        return { model: "pilot-model", result: { feedback: "Weiter.", answerRating: 4, question: "Providerfrage", responseStyle: "normal" } };
      },
    };
    const context = {
      revision,
      progressionState: state,
      tutor: {
        status: "valid" as const,
        manifest: {
          schemaVersion: 2 as const,
          defaultStrategy: deepening.id,
          phaseStrategies: { deepen: deepening.id, expand: expansion.id },
          topics: [],
          strategies: [],
        },
        topics: [phaseTopic],
        strategies: [deepening, expansion],
      },
    };
    const service = new TutorService(provider, new CurriculumTutorAdapter({ courseContent: { getSnapshot: async () => context } }));
    const transitioned = await service.generateDialogResponse(
      "int values[] = {1, 2};", [], questions[1]!.text!, "Antwort", "key", undefined, 30, context,
    );
    expect(transitioned.result).toMatchObject({ learningPhase: "DEEPEN", strategyId: deepening.id });

    const firstExpand = await service.generateDialogResponse(
      "int values[] = {1, 2};", [], transitioned.result.question, "Antwort", "key", undefined, 30, context,
    );
    expect(firstExpand.result).toMatchObject({ learningPhase: "EXPAND", strategyId: expansion.id });
    expect(prompts.at(-1)).toContain("Feedback: detailed");
  });
});
