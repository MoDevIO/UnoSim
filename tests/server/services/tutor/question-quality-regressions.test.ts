import { describe, expect, it, vi } from "vitest";
import { buildTutorContext, buildUserPrompt, TutorService } from "../../../../server/services/tutor/tutor-service";
import type { LLMProvider } from "../../../../server/services/tutor/llm-provider";
import type { TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";

const revision = "a".repeat(40);

function providerReturning(question: string): LLMProvider {
  return {
    listModels: vi.fn().mockResolvedValue(["pilot-model"]),
    generateLearningQuestion: vi.fn().mockResolvedValue({
      model: "pilot-model",
      result: {
        answerRating: 5,
        question,
      },
    }),
  };
}

function transitionPlanning(): TutorPlanningExtension {
  return {
    planInitial: vi.fn().mockResolvedValue(null),
    planFollowup: vi.fn().mockResolvedValue({
      kind: "transition",
      contentRevision: revision,
      learningPhase: "DEEPEN",
      activeTopicId: "pwm-output",
      masteredTopicIds: ["pwm-output"],
      strategyId: "built-in-default",
      strategySource: "built-in",
    }),
  };
}

describe("Tutor question quality regressions", () => {
  it("keeps the distinct question after applying transition metadata", async () => {
    const repeatedQuestion = "Welchen Wert verwendet der Sketch an der betrachteten Integer-Variablen?";
    const result = await new TutorService(
      providerReturning(repeatedQuestion),
      transitionPlanning(),
    ).generateDialogResponse(
      `const int ledPin = 9;
void setup() { pinMode(ledPin, OUTPUT); }
void loop() { analogWrite(ledPin, 128); }`,
      [],
      repeatedQuestion,
      "Der Wert ist 128.",
      "key",
      undefined,
      30,
    );

    expect(result.result).toMatchObject({
      answerRating: 5,
      learningPhase: "DEEPEN",
      strategyId: "built-in-default",
    });
    expect(result.result.question).not.toBe(repeatedQuestion);
    expect(result.result.question).toBe("Welches andere im Sketch sichtbare Konzept möchtest du als Nächstes mit diesem verstandenen Teilkonzept verknüpfen?");
  });

  it("guides the provider to identify concrete variables and local code context", () => {
    const code = `const int ledPin = 9;
void setup() { pinMode(ledPin, OUTPUT); }
void loop() {
  for (int brightness = 0; brightness <= 255; brightness += 5) {
    analogWrite(ledPin, brightness);
  }
}`;
    const prompt = buildUserPrompt(code, buildTutorContext(code));

    expect(prompt).toContain("konkreten Bezeichner");
    expect(prompt).toContain("lokale Code-Stelle");
    expect(prompt).toContain("ledPin");
    expect(prompt).toContain("brightness");
  });
});
