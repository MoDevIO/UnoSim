import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";
import type { ExampleTutorAnnotation } from "../../../../server/services/course-content/embedded-tutor-annotation";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import {
  BUILT_IN_TUTOR_STRATEGY,
  type EffectiveTutorStrategy,
} from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { DefaultLearningPlanner } from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import type { CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import type { TutorDialogTurn } from "../../../../shared/tutor";

const revision = "a".repeat(40);

function makeStrategy(overrides: Partial<EffectiveTutorStrategy> = {}): EffectiveTutorStrategy {
  return {
    ...BUILT_IN_TUTOR_STRATEGY,
    ...overrides,
    questionKindWeights: {
      ...BUILT_IN_TUTOR_STRATEGY.questionKindWeights,
      ...(overrides.questionKindWeights ?? {}),
    },
  };
}

function makeContext(
  strategies: readonly EffectiveTutorStrategy[],
  options: {
    readonly topics?: readonly CurriculumTopic[];
    readonly exampleId?: string;
    readonly annotation?: ExampleTutorAnnotation;
    readonly status?: "valid" | "invalid";
  } = {},
): TutorPlanningContentContext {
  const defaultStrategy = strategies[0]?.id;
  return {
    revision,
    ...(options.exampleId ? { exampleId: options.exampleId } : {}),
    tutor: options.status === "invalid"
      ? { status: "invalid", reason: "invalid tutor capability" }
      : {
        status: "valid",
        manifest: {
          schemaVersion: 1,
          defaultStrategy,
          topics: [],
          strategies: [],
        },
        topics: options.topics ?? [],
        strategies,
      },
    ...(options.annotation ? { exampleTutorAnnotation: options.annotation } : {}),
  };
}

function createProvider() {
  const prompts: string[] = [];
  const provider = {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn().mockImplementation(async (request) => {
      prompts.push(request.userPrompt);
      return {
        model: "pilot-model",
        result: {
          responseStyle: "normal",
          feedback: "Kurzes Feedback.",
          question: "Providerfrage",
          answerRating: 4,
        },
      };
    }),
  };
  return { provider, prompts };
}

async function loadTopic(): Promise<CurriculumTopic> {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

async function initialPrompt(
  strategy: EffectiveTutorStrategy,
  context: TutorPlanningContentContext | null = makeContext([strategy]),
  code = "void setup(){} void loop(){}",
): Promise<{ prompt: string; result: Awaited<ReturnType<TutorService["generateQuestion"]>>["result"] }> {
  const { provider, prompts } = createProvider();
  const service = new TutorService(provider, new CurriculumTutorAdapter());
  const result = context
    ? await service.generateQuestion(code, "key", undefined, 30, context)
    : await service.generateQuestion(code, "key", undefined, 30);
  return { prompt: prompts[0] ?? "", result: result.result };
}

async function dialogPrompt(strategy: EffectiveTutorStrategy): Promise<string> {
  const { provider, prompts } = createProvider();
  await new TutorService(provider, new CurriculumTutorAdapter()).generateDialogResponse(
    "void setup(){} void loop(){}",
    [],
    "Welche Beobachtung ist belegt?",
    "Die Schleife läuft.",
    "key",
    undefined,
    30,
    makeContext([strategy]),
  );
  return prompts[0] ?? "";
}

describe("Tutor strategy behavioral conformance", () => {
  it("uses repository default strategy guidance for an arbitrary sketch without a Topic", async () => {
    const strategy = makeStrategy({
      questionKindWeights: { recall: 5, concept: 5, application: 35, prediction: 15, transfer: 40 },
      sketchSpecificity: "strict",
    });
    const { prompt, result } = await initialPrompt(strategy);

    expect(result.strategyId).toBe(strategy.id);
    expect(result.strategySource).toBe("repository");
    expect(prompt).toContain("EffectiveTutorStrategy");
    expect(prompt).toContain("strict");
    expect(prompt).toContain("transfer");
  });

  it("retains the repository strategy when Topics are absent or do not match", async () => {
    const strategy = makeStrategy({ sketchSpecificity: "strict" });
    const noTopics = await initialPrompt(strategy);
    const topic = await loadTopic();
    const noMatch = await initialPrompt(strategy, makeContext([strategy], { topics: [topic] }));

    expect(noTopics.result.strategyId).toBe(strategy.id);
    expect(noMatch.result.strategyId).toBe(strategy.id);
    expect(noTopics.prompt).toContain("strict");
    expect(noMatch.prompt).toContain("strict");
  });

  it("uses built-in strategy guidance for no repository and invalid Tutor capability", async () => {
    const { prompt: noRepositoryPrompt } = await initialPrompt(BUILT_IN_TUTOR_STRATEGY, null);
    const { prompt: invalidPrompt, result } = await initialPrompt(
      makeStrategy({ id: "repository-default", sketchSpecificity: "strict" }),
      makeContext([makeStrategy({ id: "repository-default", sketchSpecificity: "strict" })], { status: "invalid" }),
    );

    expect(noRepositoryPrompt).toContain("EffectiveTutorStrategy");
    expect(result.strategyId).toBe("built-in-default");
    expect(result.strategySource).toBe("built-in");
    expect(invalidPrompt).toContain("Skizzenbezug: prefer");
  });

  it("lets a valid embedded Example strategy control the free path when no Topic matches", async () => {
    const repositoryDefault = makeStrategy({ id: "repository-default", sketchSpecificity: "prefer" });
    const exampleStrategy = makeStrategy({ id: "example-policy", sketchSpecificity: "strict" });
    const context = makeContext([repositoryDefault, exampleStrategy], {
      exampleId: "example-1",
      annotation: { schemaVersion: 1, strategy: exampleStrategy.id },
    });
    const { prompt, result } = await initialPrompt(repositoryDefault, context);

    expect(result.strategyId).toBe(exampleStrategy.id);
    expect(result.strategySource).toBe("repository");
    expect(prompt).toContain("strict");
  });

  it("keeps Example learning objectives on the planned path", async () => {
    const topic = await loadTopic();
    const strategy = makeStrategy({ id: "repository-default" });
    const objectives = ["Den Unterschied zwischen Wert und Speicherung verstehen."];
    const { prompt, result } = await initialPrompt(
      strategy,
      makeContext([strategy], {
        topics: [topic],
        exampleId: "example-1",
        annotation: { schemaVersion: 1, learningObjectives: objectives },
      }),
      "int values[] = {1, 2};",
    );

    expect(result.topicId).toBe("memory-and-data-types");
    expect(prompt).toContain(JSON.stringify(objectives));
  });

  it("keeps Example learning objectives when an embedded Topic does not match", async () => {
    const strategy = makeStrategy({ id: "repository-default" });
    const topic = await loadTopic();
    const objectives = ["Den Ablauf des freien Sketches reflektieren."];
    const { prompt, result } = await initialPrompt(
      strategy,
      makeContext([strategy], {
        topics: [topic],
        annotation: {
          schemaVersion: 1,
          topics: [topic.id],
          learningObjectives: objectives,
        },
      }),
      "void setup(){} void loop(){}",
    );

    expect(result.strategyId).toBe("repository-default");
    expect(result.topicId).toBeUndefined();
    expect(prompt).toContain(JSON.stringify(objectives));
  });

  const promptFieldVariants: readonly [string, Partial<EffectiveTutorStrategy>][] = [
    ["questionKindWeights", { questionKindWeights: { recall: 5, concept: 5, application: 35, prediction: 15, transfer: 40 } }],
    ["sketchSpecificity", { sketchSpecificity: "strict" }],
    ["repetition", { repetition: "relaxed" }],
    ["remediation", { remediation: "question-first" }],
    ["clarification", { clarification: "new-indicator" }],
    ["progression", { progression: "advance-immediately" }],
    ["scaffolding", { scaffolding: "prefer-generated" }],
    ["feedbackVerbosity", { feedbackVerbosity: "detailed" }],
    ["hintFirst", { hintFirst: false }],
  ];

  for (const [field, override] of promptFieldVariants) {
    it(`changes trusted initial guidance when ${field} changes`, async () => {
      const baseline = await initialPrompt(makeStrategy());
      const variant = await initialPrompt(makeStrategy(override));
      expect(variant.prompt).not.toBe(baseline.prompt);
    });
  }

  for (const [field, override] of promptFieldVariants.filter(([name]) => name !== "questionKindWeights")) {
    it(`changes trusted dialog guidance when ${field} changes`, async () => {
      const baseline = await dialogPrompt(makeStrategy());
      const variant = await dialogPrompt(makeStrategy(override));
      expect(variant).not.toBe(baseline);
    });
  }

  it("uses relaxed repetition only as a controlled revisit when no unused question remains", async () => {
    const topic = await loadTopic();
    const concept = topic.concepts[0]!;
    const question = topic.questions.find(({ concept: conceptId }) => conceptId === concept.id)!;
    const singleQuestionTopic: CurriculumTopic = {
      ...topic,
      concepts: [concept],
      questions: [question],
      scaffolds: [],
      progression: { ...topic.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
    };
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const history: TutorDialogTurn[] = [{
      question: question.text!,
      answer: "Antwort",
      responseStyle: "normal",
      answerRating: 3,
      questionId: question.id,
    }];
    const planner = new DefaultLearningPlanner();

    expect(planner.start(singleQuestionTopic, revision, facts, history, 30, makeStrategy({ repetition: "strict" }))).toBeNull();
    expect(planner.start(singleQuestionTopic, revision, facts, history, 30, makeStrategy({ repetition: "relaxed" }))).toMatchObject({
      brief: { questionId: question.id },
    });
  });

  it("uses question-first remediation and generated scaffolding when configured", async () => {
    const topic = await loadTopic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const current = topic.questions.find(({ id }) => id === "int-width-direct")!;
    const planner = new DefaultLearningPlanner();
    const plan = planner.advance(topic, revision, facts, [], current.text!, 1, {
      difficulty: 30,
      strategy: makeStrategy({ remediation: "question-first", scaffolding: "prefer-generated" }),
    });

    expect(plan).not.toBeNull();
    expect(plan?.brief.scaffold).toBeUndefined();
  });

  it("selects a new indicator for new-indicator clarification", async () => {
    const topic = await loadTopic();
    const concept = topic.concepts.find(({ id }) => id === "value-vs-storage")!;
    const current = topic.questions.find(({ id }) => id === "value-storage-observation")!;
    const sameIndicator = { ...current, id: "value-storage-observation-followup", text: "Welche weitere Beobachtung belegt die Darstellung des Werts?" };
    const neighboringIndicator = { ...current, id: "value-storage-neighbor", indicator: "neighboring-aspect", kind: "application" as const, text: "Welche benachbarte Codewirkung kannst du am Wert prüfen?" };
    const customTopic: CurriculumTopic = {
      ...topic,
      concepts: topic.concepts.map((candidate) => candidate.id === concept.id
        ? { ...candidate, indicators: [...candidate.indicators, { id: "neighboring-aspect", description: "Benachbarter Aspekt" }] }
        : candidate),
      questions: [...topic.questions, sameIndicator, neighboringIndicator],
    };
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const planner = new DefaultLearningPlanner();
    const plan = planner.advance(customTopic, revision, facts, [], current.text!, 3, {
      difficulty: 30,
      strategy: makeStrategy({ clarification: "new-indicator" }),
    });

    expect(plan?.brief.indicatorId).toBe("neighboring-aspect");
  });

  it("advances directly to a new concept when progression is advance-immediately", async () => {
    const topic = await loadTopic();
    const current = topic.questions.find(({ id }) => id === "value-storage-observation")!;
    const customTopic: CurriculumTopic = {
      ...topic,
      concepts: topic.concepts.map((concept) => concept.id === "integer-width"
        ? { ...concept, prerequisites: [] }
        : concept),
      progression: { ...topic.progression, entryConcepts: ["value-vs-storage"], preferredOrder: ["value-vs-storage", "integer-width", "char-numeric-representation"] },
    };
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const planner = new DefaultLearningPlanner();
    const plan = planner.advance(customTopic, revision, facts, [], current.text!, 5, {
      difficulty: 30,
      strategy: makeStrategy({ progression: "advance-immediately" }),
    });

    expect(plan?.brief.conceptId).toBe("integer-width");
  });
});
