import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";

describe("useTutor", () => {
  afterEach(() => vi.restoreAllMocks());

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
        question: "Woran würdest du das als Nächstes prüfen?",
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
    });
    expect(result.current.question?.feedback).toBe("Gute Beobachtung.");
    expect(result.current.history).toEqual([{
      question: "Was beobachtest du an Pin 13?",
      answer: "Der Pin wird HIGH gesetzt.",
      feedback: "Gute Beobachtung.",
    }]);

    act(() => result.current.resetDialog());
    expect(result.current.question).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.answer).toBe("");
    expect(result.current.credential).toBe("volatile-key");
    expect(result.current.selectedModel).toBe("pilot-model");
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
    }]);
    expect(result.current.question?.question).toBe("Und jetzt?");
  });
});
