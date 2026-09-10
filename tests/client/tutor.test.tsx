import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import {
  TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY,
  TUTOR_DEFAULT_DIFFICULTY,
} from "@shared/tutor";

describe("useTutor", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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

  it("does not call Tutor endpoints while the server keeps the feature disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      tutor: { mode: "disabled", provider: "kiconnect" },
    }), { status: 200 }));
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("disabled"));
    await act(async () => {
      await result.current.loadModels();
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain("disabled");
  });

  it("keeps the personal key in memory and sends it only with the tutor request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") {
        return new Response(JSON.stringify({
          tutor: { mode: "user-key", provider: "kiconnect" },
        }), { status: 200 });
      }
      if (url === "/api/tutor/models") {
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        question: "Welche Ausgabe erwartest du?",
        provider: "kiconnect",
        mode: "user-key",
        model: "pilot-model",
      }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("user-key"));
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

  it("does not call the backend without a personal key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      tutor: { mode: "user-key", provider: "kiconnect" },
    }), { status: 200 }));
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("user-key"));
    await act(async () => {
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain("personal Tutor API key");
  });

  it("clamps configured client difficulty changes to 1..100", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      tutor: { mode: "disabled", provider: "kiconnect" },
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
          tutor: { mode: "user-key", provider: "kiconnect" },
        }), { status: 200 });
      }
      if (url === "/api/tutor/models") {
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was beobachtest du an Pin 13?",
          provider: "kiconnect",
          mode: "user-key",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        feedback: "Gute Beobachtung.",
        answerRating: 4,
        question: "Woran würdest du das als Nächstes prüfen?",
        provider: "kiconnect",
        mode: "user-key",
        model: "pilot-model",
      }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("user-key"));
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
        mode: "user-key",
        model: "pilot-model",
      },
      {
        feedback: "Ein philosophischer Seitenblick.",
        responseStyle: "philosophical",
        question: "Zurück zum Sketch?",
        provider: "kiconnect",
        mode: "user-key",
        model: "fallback",
      },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") return new Response(JSON.stringify({ tutor: { mode: "user-key", provider: "kiconnect" } }), { status: 200 });
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was passiert an Pin 13?",
          provider: "kiconnect",
          mode: "user-key",
          model: "pilot-model",
        }), { status: 200 });
      }
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("user-key"));
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

  it("keeps answer and history unchanged when a dialog request fails", async () => {
    let dialogRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") {
        return new Response(JSON.stringify({ tutor: { mode: "user-key", provider: "kiconnect" } }), { status: 200 });
      }
      if (url === "/api/tutor/question") {
        return new Response(JSON.stringify({
          question: "Was passiert?",
          provider: "kiconnect",
          mode: "user-key",
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
            mode: "user-key",
            model: "pilot-model",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "temporär nicht verfügbar" } }), { status: 503 });
      }
      return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
    });
    const { result } = renderHook(() => useTutor());

    await waitFor(() => expect(result.current.config.mode).toBe("user-key"));
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
