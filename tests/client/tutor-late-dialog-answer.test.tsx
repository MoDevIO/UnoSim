import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import { setActiveExternalExampleContext, setExternalExamplesOverride } from "@/lib/external-examples";

/**
 * LC-02 in the hook, below the browser (Nachbesserung 2026-11-12, Befund C). In the real browser a context switch aborts
 * the running answer request, so the late result never reaches the page. Here the controlled transport ignores the
 * abort signal and fulfills the old request late with a complete, valid answer. The old promise is really fulfilled and
 * its body is really read; the hook must still leave the current question of the new context as it is.
 */

const SKETCH = "void setup() {} void loop() {}";
const tutorQuestion = (text: string) => ({ question: text, provider: "kiconnect", model: "fake" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setExternalExamplesOverride(null);
});

describe("a late answer result after a context switch", () => {
  it("is fulfilled and read, and still changes nothing in the new context", async () => {
    let releaseAnswer: (response: Response) => void = () => undefined;
    let answerSignal: AbortSignal | undefined;
    const questions = ["Alte Frage?", "Neue Frage?"];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input).split("?")[0] ?? "";
      if (url === "/api/config") return Promise.resolve(new Response("{}"));
      if (url === "/api/tutor/question") return Promise.resolve(new Response(JSON.stringify(tutorQuestion(questions.shift()!))));
      if (url === "/api/tutor/dialog") {
        answerSignal = init?.signal ?? undefined;
        // The transport ignores the signal: the promise neither rejects at the abort nor settles before the release.
        return new Promise((resolve) => { releaseAnswer = resolve; });
      }
      return Promise.reject(new Error(`unexpected request ${url}`));
    });

    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("key"));
    await act(async () => result.current.generateQuestion(SKETCH));
    expect(result.current.question?.question).toBe("Alte Frage?");

    act(() => result.current.setAnswer("SPÄTE ANTWORT"));
    let pendingAnswer: Promise<void> = Promise.resolve();
    act(() => { pendingAnswer = result.current.submitAnswer(SKETCH); });
    await waitFor(() => expect(answerSignal).toBeDefined());
    expect(result.current.isLoading).toBe(true);

    // The context switch: the dialog is reset and the request's signal aborted.
    act(() => setActiveExternalExampleContext(null));
    expect(answerSignal!.aborted).toBe(true);
    expect(result.current.question).toBeNull();
    await act(async () => result.current.generateQuestion(SKETCH));
    expect(result.current.question?.question).toBe("Neue Frage?");

    // The old request is fulfilled late with a complete, valid answer result.
    const late = new Response(JSON.stringify({
      ...tutorQuestion("Späte Folgefrage?"), responseStyle: "normal", answerRating: 5, feedback: "SPÄTES FEEDBACK",
    }));
    const readBody = vi.spyOn(late, "json");
    await act(async () => {
      releaseAnswer(late);
      await pendingAnswer;
    });

    // The old promise was fulfilled and processed: its body was read and the submit ended.
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/tutor/dialog")).toHaveLength(1);
    // The current state is the new context's.
    expect(result.current.question?.question).toBe("Neue Frage?");
    expect(result.current.history).toEqual([]);
    expect(result.current.transcript).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(JSON.stringify(result.current.transcript)).not.toContain("SPÄTES FEEDBACK");
  });
});
