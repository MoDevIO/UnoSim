import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import { getServerCapabilities } from "@/lib/server-capabilities";
import {
  TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY,
  TUTOR_DEFAULT_DIFFICULTY,
} from "@shared/tutor";
import { setActiveExternalExampleContext } from "@/lib/external-examples";

describe("useTutor", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    setActiveExternalExampleContext(null);
    vi.restoreAllMocks();
  });

  it("blocks Tutor requests offline and restores them after reconnect without an automatic request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/tutor/models") {
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      if (String(input) === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "What should happen?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      if (String(input) === "/api/tutor/dialog") {
        return new Response(JSON.stringify({
          question: "What would you check next?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
    });
    const { result, rerender } = renderHook(
      ({ capabilities }) => useTutor(capabilities),
      { initialProps: { capabilities: getServerCapabilities(false) } },
    );

    act(() => result.current.setCredential("personal-key"));
    act(() => result.current.setAnswer("an answer"));
    await act(async () => {
      await result.current.loadModels();
      await result.current.generateQuestion("void setup() {} void loop() {}");
      await result.current.submitAnswer("void setup() {} void loop() {}");
    });
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ capabilities: getServerCapabilities(true) });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.loadModels();
      await result.current.generateQuestion("void setup() {} void loop() {}");
    });
    act(() => result.current.setAnswer("next answer"));
    await act(async () => {
      await result.current.submitAnswer("void setup() {} void loop() {}");
    });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/tutor/models",
      "/api/tutor/question",
      "/api/tutor/dialog",
    ]);
  });

  it("loads a valid persisted configured difficulty before starting a tutor session", () => {
    localStorage.setItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY, "72");
    const { result } = renderHook(() => useTutor());

    expect(result.current.configuredDifficulty).toBe(72);
    expect(result.current.effectiveDifficulty).toBe(72);
  });

  it("uses the default when no configured difficulty is persisted", () => {
    const { result } = renderHook(() => useTutor());

    expect(result.current.configuredDifficulty).toBe(TUTOR_DEFAULT_DIFFICULTY);
    expect(result.current.effectiveDifficulty).toBe(TUTOR_DEFAULT_DIFFICULTY);
  });

  it("uses the default when the persisted configured difficulty is invalid", () => {
    localStorage.setItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY, "101");
    const { result } = renderHook(() => useTutor());

    expect(result.current.configuredDifficulty).toBe(TUTOR_DEFAULT_DIFFICULTY);
    expect(result.current.effectiveDifficulty).toBe(TUTOR_DEFAULT_DIFFICULTY);
  });

  it("keeps the personal key in memory and sends it only with the tutor request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") {
        return new Response(JSON.stringify({
          tutor: { provider: "kiconnect" },
        }), { status: 200 });
      }
      if (url === "/api/tutor/models") {
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        question: "Welche Ausgabe erwartest du?",
        provider: "kiconnect",
        model: "pilot-model",
      }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    act(() => result.current.setCredential("volatile-key"));
    await act(async () => {
      await result.current.loadModels();
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });

    const tutorCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/tutor/question");
    expect(tutorCall).toBeDefined();
    expect(JSON.parse(String(tutorCall?.[1]?.body))).toMatchObject({
      code: "void setup(){} void loop(){}",
      credential: "volatile-key",
      difficulty: 30,
    });
    expect(result.current.question?.question).toBe("Welche Ausgabe erwartest du?");
    expect(localStorage.length).toBe(0);
  });

  it("resets a pinned dialog when the active Course Content revision changes", async () => {
    setActiveExternalExampleContext({ repository: "owner/repo", ref: "main", revision: "a".repeat(40), exampleId: "arrays" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (String(input) === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Frage",
          provider: "kiconnect",
          model: "pilot-model",
          courseContentSession: "11111111-1111-4111-8111-111111111111",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ question: "Antwortfrage", provider: "kiconnect", model: "pilot-model" }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("volatile-key"));
    await act(async () => result.current.generateQuestion("void setup(){} void loop(){}"));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([input]) => String(input) === "/api/tutor/question")?.[1]?.body))).toMatchObject({
      courseContent: { revision: "a".repeat(40), exampleId: "arrays" },
    });

    act(() => setActiveExternalExampleContext({ repository: "owner/repo", ref: "main", revision: "b".repeat(40), exampleId: "arrays" }));
    await waitFor(() => expect(result.current.question).toBeNull());
    expect(result.current.history).toEqual([]);
    await act(async () => result.current.generateQuestion("void setup(){} void loop(){}"));
    const questionBodies = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/tutor/question")
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(questionBodies.at(-1)).toMatchObject({ courseContent: { revision: "b".repeat(40), exampleId: "arrays" } });
    expect(questionBodies.at(-1)).not.toHaveProperty("courseContentSession");
  });

  it("does not call the backend without a personal key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      tutor: { provider: "kiconnect" },
    }), { status: 200 }));
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    await act(async () => {
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain("personal Tutor API key");
  });

  it("clamps configured client difficulty changes to 1..100", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      tutor: { provider: "kiconnect" },
    }), { status: 200 }));
    const { result } = renderHook(() => useTutor());

    act(() => result.current.setConfiguredDifficulty(101));
    expect(result.current.configuredDifficulty).toBe(100);
    expect(result.current.effectiveDifficulty).toBe(100);
    expect(localStorage.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY)).toBe("100");
    act(() => result.current.setConfiguredDifficulty(0));
    expect(result.current.configuredDifficulty).toBe(1);
    expect(result.current.effectiveDifficulty).toBe(1);
    expect(localStorage.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY)).toBe("1");
  });

  it("sends an answer, keeps a bounded dialog turn, and resets only dialog state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") {
        return new Response(JSON.stringify({
          tutor: { provider: "kiconnect" },
        }), { status: 200 });
      }
      if (url === "/api/tutor/models") {
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was beobachtest du an Pin 13?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        feedback: "Gute Beobachtung.",
        answerRating: 4,
        question: "Woran würdest du das als Nächstes prüfen?",
        provider: "kiconnect",
        model: "pilot-model",
      }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    act(() => result.current.setCredential("volatile-key"));
    act(() => result.current.setConfiguredDifficulty(70));
    await act(async () => {
      await result.current.loadModels();
      result.current.setSelectedModel("pilot-model");
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });
    act(() => result.current.setAnswer("Der Pin wird HIGH gesetzt."));
    await act(async () => {
      await result.current.submitAnswer("void setup(){} void loop(){}");
    });

    const dialogCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/tutor/dialog");
    expect(dialogCall).toBeDefined();
    expect(JSON.parse(String(dialogCall?.[1]?.body))).toMatchObject({
      answer: "Der Pin wird HIGH gesetzt.",
      credential: "volatile-key",
      model: "pilot-model",
      question: "Was beobachtest du an Pin 13?",
      history: [],
      difficulty: 70,
    });
    expect(result.current.question?.feedback).toBe("Gute Beobachtung.");
    expect(result.current.history).toEqual([{
      question: "Was beobachtest du an Pin 13?",
      answer: "Der Pin wird HIGH gesetzt.",
      feedback: "Gute Beobachtung.",
      answerRating: 4,
      responseStyle: "normal",
    }]);

    expect(result.current.sessionRating).toBe(4);
    expect(result.current.ratedAnswerCount).toBe(1);

    act(() => result.current.resetDialog());
    expect(result.current.question).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.answer).toBe("");
    expect(result.current.credential).toBe("volatile-key");
    expect(result.current.selectedModel).toBe("pilot-model");
    expect(result.current.configuredDifficulty).toBe(70);
    expect(result.current.effectiveDifficulty).toBe(70);
    expect(result.current.sessionRating).toBeNull();
  });

  it("adapts effective difficulty for rated normal answers but not philosophical fallbacks", async () => {
    const responses = [
      {
        feedback: "Sehr gut.",
        answerRating: 5,
        responseStyle: "normal",
        question: "Nächste normale Frage?",
        provider: "kiconnect",
        model: "pilot-model",
      },
      {
        feedback: "Ein philosophischer Seitenblick.",
        responseStyle: "philosophical",
        question: "Zurück zum Sketch?",
        provider: "kiconnect",
        model: "fallback",
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was passiert an Pin 13?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    act(() => result.current.setCredential("volatile-key"));
    act(() => result.current.setConfiguredDifficulty(50));
    await act(async () => result.current.generateQuestion("void setup(){} void loop(){}"));
    act(() => result.current.setAnswer("Der Pin wird HIGH gesetzt."));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));
    expect(result.current.effectiveDifficulty).toBe(54);
    expect(result.current.sessionRating).toBe(5);

    act(() => result.current.setAnswer("Pizza mit Einhorn"));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));
    expect(result.current.effectiveDifficulty).toBe(54);
    expect(result.current.sessionRating).toBe(5);
    expect(localStorage.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY)).toBe("50");
    expect(result.current.history.at(-1)).toMatchObject({ responseStyle: "philosophical" });
    expect(result.current.lastUsedModel).toBe("pilot-model");
  });

  it("lowers effective difficulty for consecutive weak answers without changing the configured start value", async () => {
    const dialogDifficulties: number[] = [];
    let questionNumber = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was passiert im Sketch?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      if (url === "/api/tutor/dialog") {
        const request = JSON.parse(String(init?.body)) as { difficulty: number };
        dialogDifficulties.push(request.difficulty);
        questionNumber += 1;
        return new Response(JSON.stringify({
          feedback: "Wir gehen einen kleineren Schritt.",
          answerRating: 2,
          question: `Kleiner Schritt ${questionNumber}?`,
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    act(() => result.current.setCredential("volatile-key"));
    act(() => result.current.setConfiguredDifficulty(50));
    await act(async () => result.current.generateQuestion("void setup(){} void loop(){}"));
    act(() => result.current.setAnswer("Keine Ahnung"));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));
    act(() => result.current.setAnswer("Immer noch unklar"));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));

    expect(dialogDifficulties).toEqual([50, 47]);
    expect(result.current.effectiveDifficulty).toBe(44);
    expect(result.current.configuredDifficulty).toBe(50);
    expect(localStorage.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY)).toBe("50");
  });

  it("keeps answer and history unchanged when a dialog request fails", async () => {
    let dialogRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") {
        return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
      }
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was passiert?",
          provider: "kiconnect",
          model: "pilot-model",
        }), { status: 200 });
      }
      if (url === "/api/tutor/dialog") {
        dialogRequests += 1;
        if (dialogRequests === 1) {
          return new Response(JSON.stringify({
            feedback: "Erster Schritt.",
            question: "Und jetzt?",
            provider: "kiconnect",
            model: "pilot-model",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "temporär nicht verfügbar" } }), { status: 503 });
      }
      return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.provider).toBe("kiconnect"));
    act(() => result.current.setCredential("volatile-key"));
    await act(async () => result.current.generateQuestion("void setup(){} void loop(){}"));
    act(() => result.current.setAnswer("Erste Überlegung"));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));
    act(() => result.current.setAnswer("Meine Überlegung"));
    await act(async () => result.current.submitAnswer("void setup(){} void loop(){}"));

    expect(dialogRequests).toBe(2);
    expect(result.current.answer).toBe("Meine Überlegung");
    expect(result.current.history).toEqual([{
      question: "Was passiert?",
      answer: "Erste Überlegung",
      feedback: "Erster Schritt.",
      responseStyle: "normal",
    }]);
    expect(result.current.question?.question).toBe("Und jetzt?");
  });
});
