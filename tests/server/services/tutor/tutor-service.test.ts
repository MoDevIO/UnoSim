import { describe, expect, it, vi } from "vitest";
import {
  buildTutorContext,
  buildDialogPrompt,
  buildUserPrompt,
  isClearlyNonLearningAnswer,
  isSemanticallyRepeatedQuestion,
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
    expect(buildUserPrompt(sketch, context, 2)).toContain("1–10 = elementare Wiedererkennung");
    expect(buildUserPrompt(sketch, context, 80)).toContain("71–90 = anspruchsvolle Herleitung");
  });

  it("accepts one question and drops unsafe Mermaid instead of the text answer", () => {
    expect(validateLearningQuestion({
      question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
      topic: "Digitalausgabe",
      difficulty: 30,
      mermaid: "flowchart LR\nA --> B\nclick A href \"https://example.invalid\"",
    })).toEqual({
      question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
      topic: "Digitalausgabe",
      difficulty: 30,
      responseStyle: "normal",
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
          result: { question: "Was bewirkt die Ausgabe an Pin 13?", answerRating: 5 },
        };
      },
    };
    const service = new TutorService(provider, "user-key");

    const result = await service.generateQuestion(sketch, "volatile-key", undefined);

    expect(result.model).toBe("pilot-model");
    expect(result.result).not.toHaveProperty("answerRating");
    expect(result.result.responseStyle).toBe("normal");
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
            answerRating: 4,
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
    expect(prompts[0]).toContain(JSON.stringify([{ ...history[0], responseStyle: "normal" }]));
    expect(prompts[0]).toContain("Dann leuchtet die angeschlossene LED.");
    expect(prompts[0]).not.toContain("volatile-key");
    expect(buildDialogPrompt(sketch, buildTutorContext(sketch), history, "Aktuelle Frage", "Antwort")).toContain("Antwort");
  });

  it("passes relative difficulty to the dialog prompt and preserves answer ratings", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          feedback: "Der Zusammenhang ist klar erklärt.",
          answerRating: 5,
          question: "Welche Folge erwartest du bei einer Änderung?",
        },
      }),
    };

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      [],
      "Was passiert an Pin 13?",
      "Der Pin wird HIGH gesetzt.",
      "volatile-key",
      undefined,
      80,
    );

    expect(result.result).toMatchObject({ answerRating: 5, difficulty: 80, responseStyle: "normal" });
    expect(provider.generateLearningQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ userPrompt: expect.stringContaining("80/100") }),
      "volatile-key",
    );
  });

  it("accepts a fully correct short answer as a five-star understanding rating", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          feedback: "Genau.",
          answerRating: 5,
          question: "Welche Variable wird im Sketch anschließend verwendet?",
        },
      }),
    };

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      "void setup(){} void loop(){}",
      [],
      "Wie viele Bytes hat ein int auf dem Arduino Uno?",
      "2",
      "volatile-key",
      undefined,
      20,
    );

    expect(result.result.answerRating).toBe(5);
  });

  it("requests a strategy change after repeated weak answers", async () => {
    const prompts: string[] = [];
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      async generateLearningQuestion(request) {
        prompts.push(request.userPrompt);
        return {
          model: "pilot-model",
          result: {
            feedback: "Wir zerlegen das in einen kleineren Schritt.",
            answerRating: 2,
            question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
          },
        };
      },
    };
    const history = [
      {
        question: "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
        answer: "Ich weiß es nicht.",
        responseStyle: "normal" as const,
        answerRating: 2 as const,
      },
      {
        question: "Welche Codezeile setzt den Ausgang an Pin 13?",
        answer: "Keine Ahnung.",
        responseStyle: "normal" as const,
        answerRating: 2 as const,
      },
    ];

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      history,
      "Welche Wirkung hat der HIGH-Pegel an Pin 13?",
      "Das ist ein analoger Messwert.",
      "volatile-key",
      undefined,
      30,
    );

    expect(prompts[0]).toContain("Zwei schwache Antworten");
    expect(prompts[0]).toContain("nicht wiederholen");
    expect(result.result.answerRating).toBe(2);
    expect(result.result.question).not.toBe("Welche Wirkung hat der HIGH-Pegel an Pin 13?");
  });

  it("replaces a repeated ASCII question with a smaller conceptual step", async () => {
    const serialSketch = `uint8_t values[] = {65, 66, 67};
void setup() { Serial.write(values, 3); }
void loop() {}`;
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          feedback: "Schauen wir auf einen einzelnen Wert.",
          answerRating: 2,
          question: "Welche Zeichen ergeben die Werte 65, 66 und 67 im Serial-Output?",
        },
      }),
    };

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      serialSketch,
      [],
      "Welche Zeichen ergeben die Werte 65, 66 und 67 im Serial-Output?",
      "Das sind Zahlen.",
      "volatile-key",
      undefined,
      30,
    );

    expect(result.result.question).toBe("Welche Zeichen ordnet die ASCII-Tabelle den Werten 65, 66 und 67 im aktuellen Sketch zu?");
    expect(isSemanticallyRepeatedQuestion(result.result.question, ["Welche Zeichen ergeben die Werte 65, 66 und 67 im Serial-Output?"])).toBe(false);
  });

  it("moves to the next concept after a fully understood short-answer concept", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          feedback: "Ja, das Teilkonzept ist vollständig verstanden.",
          answerRating: 5,
          question: "Welche Wirkung hat der HIGH-Pegel an Pin 13 im Ablauf des Sketches?",
        },
      }),
    };

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      [],
      "Welche Wirkung hat HIGH an Pin 13?",
      "Der Ausgang ist aktiv.",
      "volatile-key",
      undefined,
      30,
    );

    expect(result.result.answerRating).toBe(5);
    expect(result.result.question).toBe("Wie hängen die Pin-Konfiguration und die spätere Ansteuerung im Ablauf des Sketches zusammen?");
  });

  it("keeps normal false answers in normal tutor mode with a rating", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          responseStyle: "normal",
          feedback: "Das passt fachlich noch nicht zum HIGH-Pegel.",
          answerRating: 1,
          question: "Welche Codezeile setzt den Ausgang tatsächlich?",
        },
      }),
    };

    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      [],
      "Was passiert an Pin 13?",
      "Der Pin liest einen analogen Sensorwert.",
      "volatile-key",
      undefined,
      30,
    );

    expect(result.result).toMatchObject({ responseStyle: "normal", answerRating: 1, difficulty: 30 });
    expect(provider.generateLearningQuestion).toHaveBeenCalledOnce();
  });

  it("uses a philosophical fallback for absurd or off-topic answers without provider calls or ratings", async () => {
    const provider: LLMProvider = {
      listModels: vi.fn(),
      generateLearningQuestion: vi.fn(),
    };

    expect(isClearlyNonLearningAnswer("Pizza mit Einhorn")).toBe(true);
    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      [],
      "Was passiert an Pin 13?",
      "Pizza mit Einhorn",
      "volatile-key",
      undefined,
      30,
    );

    expect(result.result).toMatchObject({ responseStyle: "philosophical", difficulty: 30 });
    expect(result.result).not.toHaveProperty("answerRating");
    expect(result.result.question).toContain("Sketch");
    expect(provider.generateLearningQuestion).not.toHaveBeenCalled();
  });

  it("asks more directly after repeated nonsense", async () => {
    const provider: LLMProvider = { listModels: vi.fn(), generateLearningQuestion: vi.fn() };
    const result = await new TutorService(provider, "user-key").generateDialogResponse(
      sketch,
      [{
        question: "Was passiert?",
        answer: "Pizza",
        feedback: "Seitenblick.",
        responseStyle: "philosophical",
      }],
      "Was passiert an Pin 13?",
      "lalala",
      "volatile-key",
      undefined,
      30,
    );

    expect(result.result.responseStyle).toBe("philosophical");
    expect(result.result.feedback).toContain("wirklich");
    expect(result.result.question).toContain("wirklich");
  });

  it("does not classify short technical answers as philosophical fallback", () => {
    expect(isClearlyNonLearningAnswer("13")).toBe(false);
    expect(isClearlyNonLearningAnswer("HIGH")).toBe(false);
    expect(isClearlyNonLearningAnswer("A0")).toBe(false);
    expect(isClearlyNonLearningAnswer("Der Wetter-Sensor liefert einen falschen Wert am Eingang.")).toBe(false);
    expect(isClearlyNonLearningAnswer("Die Katze ist eine Variable im Sketch und wird nie gelesen.")).toBe(false);
    expect(isClearlyNonLearningAnswer("Pizza")).toBe(false);
  });

  it("rejects complete solutions in optional feedback as well", () => {
    expect(() => validateLearningQuestion({
      feedback: "```cpp\nvoid setup() {}\nvoid loop() {}\n```",
      question: "Was beobachtest du?",
    })).toThrow(TutorProviderError);
  });

  it("rejects philosophical provider responses that contain an answer rating", () => {
    expect(() => validateLearningQuestion({
      responseStyle: "philosophical",
      question: "Welche konkrete Stelle möchtest du untersuchen?",
      answerRating: 1,
    })).toThrow(TutorProviderError);
  });
});
