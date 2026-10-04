import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import type { TutorPlanningContentContext } from "../../../../server/services/tutor/tutor-planning";
import type { LLMProvider, LLMProviderRequest, ProviderQuestionResult } from "../../../../server/services/tutor/llm-provider";

const CODE = "int values[] = {1, 2};";

async function pinnedSession(): Promise<{ context: TutorPlanningContentContext; questions: Record<string, string> }> {
  const topic = parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
  const revision = "e".repeat(40);
  const questions = Object.fromEntries(topic.questions.map((question) => [question.id, question.text ?? ""]));
  return {
    context: {
      revision,
      tutor: { status: "valid", manifest: { schemaVersion: 1, topics: [], strategies: [] }, topics: [topic], strategies: [] },
      progressionState: createTutorProgressionState(revision),
    },
    questions,
  };
}

/** Provider whose answer to each question arrives after the given delay. */
function delayedProvider(delayByQuestion: Record<string, number>): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn(async ({ userPrompt }: LLMProviderRequest): Promise<ProviderQuestionResult> => {
      const answered = Object.keys(delayByQuestion).find((question) => userPrompt.includes(`Aktuelle Tutorfrage:\n${question}`));
      await new Promise((resolve) => setTimeout(resolve, answered ? delayByQuestion[answered] : 0));
      return { model: "pilot-model", result: { responseStyle: "normal", answerRating: 3, question: "Welche Folgefrage passt?" } };
    }),
  };
}

describe("Tutor session concurrency", () => {
  it("keeps the evidence of two answers that overlap on the same session", async () => {
    const { context, questions } = await pinnedSession();
    const first = questions["int-width-direct"]!;
    const second = questions["serial-write-prediction"]!;
    const service = new TutorService(delayedProvider({ [first]: 60, [second]: 5 }), new CurriculumTutorAdapter());

    await Promise.all([
      service.generateDialogResponse(CODE, [], first, "Zwei Bytes.", "key", undefined, 30, context),
      service.generateDialogResponse(CODE, [], second, "Als Zeichen.", "key", undefined, 30, context),
    ]);

    const evidence = context.progressionState!.masteryEvidence["memory-and-data-types"] ?? [];
    expect(evidence.map(({ questionId }) => questionId).sort()).toEqual(["int-width-direct", "serial-write-prediction"]);
  });

  it("does not hold up requests of different sessions", async () => {
    const a = await pinnedSession();
    const b = await pinnedSession();
    const order: string[] = [];
    const provider = delayedProvider({ [a.questions["int-width-direct"]!]: 60, [b.questions["serial-write-prediction"]!]: 5 });
    const service = new TutorService(provider, new CurriculumTutorAdapter());

    await Promise.all([
      service.generateDialogResponse(CODE, [], a.questions["int-width-direct"]!, "x", "key", undefined, 30, a.context).then(() => order.push("a")),
      service.generateDialogResponse(CODE, [], b.questions["serial-write-prediction"]!, "y", "key", undefined, 30, b.context).then(() => order.push("b")),
    ]);

    expect(order).toEqual(["b", "a"]);
  });
});
