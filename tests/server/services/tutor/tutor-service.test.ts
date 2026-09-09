import { describe, expect, it, vi } from "vitest";
import {
  buildTutorContext,
  buildDialogPrompt,
  buildUserPrompt,
  sanitizeMermaid,
  validateLearningQuestion,
  TUTOR_SYSTEM_PROMPT,
  TutorService,
} from "../../../../server/services/tutor/tutor-service";
import { TutorProviderError, type LLMProvider } from "../../../../server/services/tutor/llm-provider";

const sketch = `
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
}
`;

describe("TutorService", () => {
  it("does not call a provider in managed mode without an explicit server key", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn(),
      generateLearningQuestion: vi.fn(),
    };
    const service = new TutorService(provider, "managed");

    await expect(service.generateQuestion(sketch, undefined, undefined)).rejects.toMatchObject({
      kind: "provider-unavailable",
    });
    expect(provider.listModels).not.toHaveBeenCalled();
    expect(provider.generateLearningQuestion).not.toHaveBeenCalled();
  });

  it("builds the prompt from the sketch and deterministic static I/O context", () => {
    const context = buildTutorContext(sketch);
    const prompt = buildUserPrompt(sketch, context);

    expect(context.staticIO.pins).toEqual(expect.arrayContaining([
      expect.objectContaining({ pinId: 13 }),
    ]));
    expect(prompt).toContain(sketch);
    expect(prompt).toContain("Deterministischer UnoSim-Kontext:");
    expect(TUTOR_SYSTEM_PROMPT).toContain("genau eine kurze Lern");
  });

  it("accepts one question and drops unsafe Mermaid instead of the text answer", () => {
    expect(validateLearningQuestion({
      question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
      topic: "Digitalausgabe",
      difficulty: "basic",
      mermaid: "flowchart LR\nA --> B\nclick A href \"https://example.invalid\"",
    })).toEqual({
      question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
      topic: "Digitalausgabe",
      difficulty: "basic",
    });
    expect(sanitizeMermaid("flowchart LR\nA --> B")).toBe("flowchart LR\nA --> B");
    expect(sanitizeMermaid("graph LR\nA --> <b>B</b>")).toBeUndefined();
  });

  it("rejects an answer that contains a complete sketch solution", () => {
    expect(() => validateLearningQuestion({
      question: "```cpp\nvoid setup() {}\nvoid loop() {}\n```",
    })).toThrow(TutorProviderError);
  });

  it("passes only the request-scoped credential to the provider", async () => {
    const calls: Array<{ credential: string; prompt: string }> = [];
    const provider: LLMProvider = {
      async listModels() {
        return ["pilot-model"];
      },
      async generateLearningQuestion(request, credential) {
        calls.push({ credential, prompt: request.userPrompt });
        return {
          model: "pilot-model",
          result: { question: "Was bewirkt die Ausgabe an Pin 13?" },
        };
      },
    };
    const service = new TutorService(provider, "user-key");

    const result = await service.generateQuestion(sketch, "volatile-key", undefined);

    expect(result.model).toBe("pilot-model");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.credential).toBe("volatile-key");
    expect(calls[0]?.prompt).toContain(sketch);
    expect(calls[0]?.prompt).not.toContain("volatile-key");
  });

  it("falls back to automatic selection when a previously selected model is stale", async () => {
    const requests: string[] = [];
    const provider: LLMProvider = {
      async listModels() {
        return ["current-model"];
      },
      async generateLearningQuestion(request) {
        requests.push(request.model);
        return { model: "current-model", result: { question: "Welche Ausgabe erwartest du?" } };
      },
    };

    await new TutorService(provider, "user-key").generateQuestion(sketch, "volatile-key", "old-model");

    expect(requests).toEqual(["auto"]);
  });

  it("continues a bounded dialog without putting the credential in the prompt", async () => {
    const prompts: string[] = [];
    const provider: LLMProvider = {
      async listModels() {
        return ["pilot-model"];
      },
      async generateLearningQuestion(request) {
        prompts.push(request.userPrompt);
        return {
          model: "pilot-model",
          result: {
            feedback: "Der Bezug zum Pin ist nachvollziehbar.",
            question: "Woran würdest du die Änderung im Serial Output erkennen?",
          },
        };
      },
    };
    const history = [{
      question: "Was passiert an Pin 13?",
      answer: "Der Pin wird HIGH gesetzt.",
    }] as const;

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      history,
      "Was passiert an Pin 13?",
      "Dann leuchtet die angeschlossene LED.",
      "volatile-key",
      undefined,
    );

    expect(result.result.feedback).toContain("nachvollziehbar");
    expect(result.result.question).toContain("Serial Output");
    expect(prompts[0]).toContain(JSON.stringify(history));
    expect(prompts[0]).toContain("Dann leuchtet die angeschlossene LED.");
    expect(prompts[0]).not.toContain("volatile-key");
    expect(buildDialogPrompt(sketch, buildTutorContext(sketch), history, "Aktuelle Frage", "Antwort")).toContain("Antwort");
  });

  it("rejects complete solutions in optional feedback as well", () => {
    expect(() => validateLearningQuestion({
      feedback: "```cpp\nvoid setup() {}\nvoid loop() {}\n```",
      question: "Was beobachtest du?",
    })).toThrow(TutorProviderError);
  });
});
