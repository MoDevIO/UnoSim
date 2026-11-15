import { afterEach, expect, it, vi } from "vitest";
import { KiconnectProvider } from "../../../../../server/services/tutor/kiconnect-provider";
afterEach(() => vi.unstubAllGlobals());
it.each([null, { malformed: true }, "<svg>private</svg>"])(
  "isolates an untrusted diagram proposal %j without losing valid learning text",
  async (diagram) => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            model: "model",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    question: "Welche Aufgabe hat arbeiten?",
                    responseStyle: "normal",
                    feedback: "Betrachte die Abfolge.",
                    answerRating: 4,
                    diagram,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await new KiconnectProvider().generateLearningQuestion(
      { model: "model", systemPrompt: "test", userPrompt: "test" },
      "secret",
    );
    expect(result.diagramProposal).toEqual(diagram);
    expect(result.result).toEqual({
      question: "Welche Aufgabe hat arbeiten?",
      responseStyle: "normal",
      feedback: "Betrachte die Abfolge.",
      answerRating: 4,
    });
  },
);
