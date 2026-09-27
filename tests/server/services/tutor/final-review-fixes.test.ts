import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TutorCourseContentSessionStore } from "../../../../server/services/course-content/course-content-session";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState, markTopicMastered, type TutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { TutorProviderError, type LLMProvider } from "../../../../server/services/tutor/llm-provider";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { BUILT_IN_TUTOR_STRATEGY, type EffectiveTutorStrategy } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";

const revision = "a".repeat(40) as `${string}`;

async function sourceTopic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

function strategy(id: string, overrides: Partial<EffectiveTutorStrategy> = {}): EffectiveTutorStrategy {
  return { ...BUILT_IN_TUTOR_STRATEGY, id, ...overrides };
}

function tutorContext(
  state: TutorProgressionState,
  topics: readonly Awaited<ReturnType<typeof sourceTopic>>[],
  strategies: readonly EffectiveTutorStrategy[],
  defaultStrategy: string,
) {
  return {
    repository: "owner/repo" as const,
    ref: "main" as const,
    revision,
    progressionState: state,
    tutor: {
      status: "valid" as const,
      manifest: {
        schemaVersion: 2 as const,
        defaultStrategy,
        phaseStrategies: { deepen: "exploration-policy", expand: "exploration-policy" },
        topics: [],
        strategies: [],
      },
      topics,
      strategies,
    },
  };
}

function successfulProvider(question = "Providerfrage"): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn().mockResolvedValue({
      model: "pilot-model",
      result: { question },
    }),
  };
}

function sessionContent(content: ReturnType<typeof tutorContext>) {
  const sessions = new TutorCourseContentSessionStore();
  const handle = sessions.create("identity", content);
  const pinned = sessions.get("identity", handle);
  if (!pinned) throw new Error("Expected a pinned Tutor session");
  return { sessions, handle, pinned };
}

async function expansionContext(objective: string) {
  const source = await sourceTopic();
  const target = { ...source, schemaVersion: 2 as const, id: "target-topic", activation: { any: [{ fact: "serial-call" as const, values: ["write"] }] } };
  const sourceWithExtension = {
    ...source,
    schemaVersion: 2 as const,
    id: "source-topic",
    extensions: [{ topic: target.id, objective }],
  };
  const state = createTutorProgressionState(revision);
  state.activeTopicId = sourceWithExtension.id;
  state.phase = "EXPAND";
  state.retainedPhases[sourceWithExtension.id] = "EXPAND";
  markTopicMastered(state, sourceWithExtension.id);
  const precision = strategy("precision-policy");
  const exploration = strategy("exploration-policy", { feedbackVerbosity: "detailed", progression: "advance-immediately", hintFirst: true });
  return {
    content: tutorContext(state, [sourceWithExtension, target], [precision, exploration], precision.id),
    state,
    sourceId: sourceWithExtension.id,
    targetId: target.id,
  };
}

describe("Tutor final review conformance", () => {
  it("does not persist an EXPAND target when the provider times out, then commits it on retry", async () => {
    const setup = await expansionContext("Wiederholte Verarbeitung in eine Funktion auslagern.");
    const { pinned } = sessionContent(setup.content);
    const provider = successfulProvider();
    vi.mocked(provider.generateLearningQuestion)
      .mockRejectedValueOnce(new TutorProviderError("provider-timeout"));
    const service = new TutorService(provider, new CurriculumTutorAdapter());
    const before = structuredClone(pinned.progressionState);

    await expect(service.generateQuestion("int value = 1;", "key", undefined, 30, pinned)).rejects.toMatchObject({ kind: "provider-timeout" });
    expect(pinned.progressionState).toEqual(before);
    expect(pinned.progressionState?.usedExpansionTargetTopicIds).toEqual({});

    await expect(service.generateQuestion("int value = 1;", "key", undefined, 30, pinned)).resolves.toMatchObject({ result: { activeTopicId: setup.sourceId } });
    expect(pinned.progressionState?.usedExpansionTargetTopicIds).toEqual({ [setup.sourceId]: [setup.targetId] });
    expect(pinned.progressionState?.phase).toBe("EXPAND");
  });

  it("does not persist dialog planning mutations when the provider times out", async () => {
    const setup = await expansionContext("Eine Dialog-Expansion darf erst nach erfolgreicher Antwort festgeschrieben werden.");
    const { pinned } = sessionContent(setup.content);
    const provider = successfulProvider();
    vi.mocked(provider.generateLearningQuestion).mockRejectedValueOnce(new TutorProviderError("provider-timeout"));
    const before = structuredClone(pinned.progressionState);

    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateDialogResponse(
      "int value = 1;",
      [],
      "Welche Erweiterung ist sinnvoll?",
      "Ich prüfe zunächst den aktuellen Wert.",
      "key",
      undefined,
      30,
      pinned,
    )).rejects.toMatchObject({ kind: "provider-timeout" });
    expect(pinned.progressionState).toEqual(before);
  });

  it("does not persist progression changes for an invalid provider payload", async () => {
    const source = await sourceTopic();
    const state = createTutorProgressionState(revision);
    const content = tutorContext(state, [source], [strategy("precision-policy")], "precision-policy");
    const { pinned } = sessionContent(content);
    const provider = successfulProvider();
    vi.mocked(provider.generateLearningQuestion).mockResolvedValueOnce({
      model: "pilot-model",
      result: { question: "```cpp\nvoid setup() {}\nvoid loop() {}\n```" },
    });
    const before = structuredClone(pinned.progressionState);

    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
      "int value = 1;",
      "key",
      undefined,
      30,
      pinned,
    )).rejects.toMatchObject({ kind: "invalid-response" });
    expect(pinned.progressionState).toEqual(before);
  });

  it.each(["provider-unavailable", "rate-limited"] as const)(
    "does not persist progression changes for a provider %s failure",
    async (kind) => {
      const setup = await expansionContext("Eine fehlgeschlagene Anfrage darf keinen Lernfortschritt verbrauchen.");
      const { pinned } = sessionContent(setup.content);
      const provider = successfulProvider();
      vi.mocked(provider.generateLearningQuestion).mockRejectedValueOnce(new TutorProviderError(kind));
      const before = structuredClone(pinned.progressionState);

      await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
        "int value = 1;",
        "key",
        undefined,
        30,
        pinned,
      )).rejects.toMatchObject({ kind });
      expect(pinned.progressionState).toEqual(before);
    },
  );

  it("does not persist a failed LEARN-to-DEEPEN planning transition", async () => {
    const source = await sourceTopic();
    const concept = {
      ...source.concepts[0]!,
      mastery: {
        ...source.concepts[0]!.mastery,
        minimumSuccessfulProbes: 1,
        minimumDistinctQuestionKinds: 1,
        requiredIndicators: [source.questions[0]!.indicator],
      },
    };
    const topic = {
      ...source,
      id: "learn-to-deepen-topic",
      concepts: [concept],
      questions: source.questions.slice(0, 2).map((question, index) => ({ ...question, id: `learn-to-deepen-${index}`, concept: concept.id })),
      scaffolds: [],
      progression: { ...source.progression, entryConcepts: [concept.id], preferredOrder: [concept.id] },
    };
    const state = createTutorProgressionState(revision);
    state.masteryEvidence[topic.id] = [{
      questionId: topic.questions[0]!.id,
      conceptId: concept.id,
      indicatorId: topic.questions[0]!.indicator,
      kind: topic.questions[0]!.kind,
      rating: 4,
    }];
    const content = tutorContext(state, [topic], [strategy("precision-policy")], "precision-policy");
    const { pinned } = sessionContent(content);
    const provider = successfulProvider();
    vi.mocked(provider.generateLearningQuestion).mockResolvedValueOnce({
      model: "pilot-model",
      result: { question: "```cpp\nvoid setup() {}\nvoid loop() {}\n```" },
    });
    const before = structuredClone(pinned.progressionState);

    await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
      "int value = 1;",
      "key",
      undefined,
      30,
      pinned,
    )).rejects.toMatchObject({ kind: "invalid-response" });
    expect(pinned.progressionState).toEqual(before);
  });

  it.each(["LEARN", "DEEPEN"] as const)(
    "uses the new LEARN strategy after a %s context reveals an unmastered Topic",
    async (phase) => {
      const source = await sourceTopic();
      const topicA = { ...source, schemaVersion: 2 as const, id: "topic-a" };
      const topicB = { ...source, schemaVersion: 2 as const, id: "topic-b", activation: { any: [{ fact: "serial-call" as const, values: ["write"] }] } };
      const state = createTutorProgressionState(revision);
      state.activeTopicId = topicA.id;
      state.phase = phase;
      state.retainedPhases[topicA.id] = phase;
      markTopicMastered(state, topicA.id);
      const precision = strategy("precision-policy", { feedbackVerbosity: "short", progression: "mastery-then-advance", hintFirst: false });
      const exploration = strategy("exploration-policy", { feedbackVerbosity: "detailed", progression: "advance-immediately", hintFirst: true });
      const content = tutorContext(state, [topicA, topicB], [precision, exploration], precision.id);
      const { pinned } = sessionContent(content);
      const prompts: string[] = [];
      const provider: LLMProvider = {
        listModels: vi.fn().mockResolvedValue(["pilot-model"]),
        generateLearningQuestion: vi.fn().mockImplementation(async (request) => {
          prompts.push(request.userPrompt);
          return { model: "pilot-model", result: { question: "Providerfrage" } };
        }),
      };

      const result = await new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(
        "int value = 1; Serial.write('A');",
        "key",
        undefined,
        30,
        pinned,
      );

      expect(result.result).toMatchObject({ activeTopicId: topicB.id, learningPhase: "LEARN", strategyId: precision.id });
      expect(prompts[0]).toContain("Feedback: short");
      expect(prompts[0]).not.toContain("Feedback: detailed");
      expect(prompts[0]).toContain("Progression: mastery-then-advance");
    },
  );

  it("realizes different extension objectives in the final TutorService question without activating the target", async () => {
    const first = await expansionContext("Wiederholte Verarbeitung in eine Funktion auslagern.");
    const second = await expansionContext("Eine serielle Ausgabe als klaren Diagnosewert verwenden.");
    const firstSession = sessionContent(first.content).pinned;
    const secondSession = sessionContent(second.content).pinned;
    const service = new TutorService(successfulProvider(), new CurriculumTutorAdapter());

    const firstResult = await service.generateQuestion("int value = 1;", "key", undefined, 30, firstSession);
    const secondResult = await service.generateQuestion("int value = 1;", "key", undefined, 30, secondSession);

    expect(firstResult.result.question).toContain("Wiederholte Verarbeitung in eine Funktion auslagern.");
    expect(secondResult.result.question).toContain("Eine serielle Ausgabe als klaren Diagnosewert verwenden.");
    expect(firstResult.result.question).not.toBe(secondResult.result.question);
    expect(firstResult.result).toMatchObject({ activeTopicId: first.sourceId, learningPhase: "EXPAND" });
    expect(firstResult.result.activeTopicId).not.toBe(first.targetId);
    expect(firstSession.progressionState?.activeTopicId).toBe(first.sourceId);
  });
});
