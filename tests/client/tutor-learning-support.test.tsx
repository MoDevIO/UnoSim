import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import { TutorWorkspacePlaceholder } from "@/components/simulator/ExperimentalWorkspace";
import { setActiveExternalExampleContext } from "@/lib/external-examples";
import type { TutorSupportState } from "@shared/tutor";

/** Learning support in the browser (LearningQuestions 3.10, 10.7): the hook follows the server's state. */

const SKETCH = "void setup() { Serial.begin(9600); } void loop() {}";
const QUESTION = "Was wird im ersten Durchlauf ausgegeben, wenn `a` den Wert 200 hat?";

function support(overrides: Partial<TutorSupportState> = {}): TutorSupportState {
  return {
    session: "11111111-1111-4111-8111-111111111111",
    questionHandle: "22222222-2222-4222-8222-222222222222",
    answerAttempts: 0,
    clarifications: 0,
    canRevealReference: false,
    canSkip: false,
    referenceAvailable: true,
    referenceShown: false,
    outcome: "open",
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  setActiveExternalExampleContext(null);
  vi.restoreAllMocks();
});

function mockServer(handlers: Record<string, (body: Record<string, any>) => Response>) {
  const bodies: { url: string; body: Record<string, any> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : {};
    bodies.push({ url, body });
    if (url === "/api/config") return json({ tutor: { provider: "kiconnect" } });
    const handler = handlers[url];
    if (!handler) throw new Error(`Unexpected request ${url}`);
    return handler(body);
  });
  return bodies;
}

async function startDialog() {
  const hook = renderHook(() => useTutor());
  act(() => hook.result.current.setCredential("personal-key"));
  await act(async () => { await hook.result.current.generateQuestion(SKETCH); });
  return hook;
}

describe("useTutor learning support", () => {
  it("opts in, binds every answer and keeps a typed clarification out of the rated history", async () => {
    const bodies = mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: support() }),
      "/api/tutor/dialog": (body) => body.answer === "Was ist gemeint?"
        ? json({ responseStyle: "normal", question: QUESTION, feedback: "Gemeint ist der Durchlauf mit i = 7.", learnerInput: "clarification", provider: "kiconnect", model: "m", support: support({ clarifications: 1 }) })
        : json({ responseStyle: "normal", question: QUESTION, feedback: "Noch nicht.", answerRating: 2, learnerInput: "answer", provider: "kiconnect", model: "m", support: support({ answerAttempts: 1 }) }),
    });
    const { result } = await startDialog();
    expect(bodies.find(({ url }) => url === "/api/tutor/question")?.body.learningSupport).toBe(true);

    act(() => result.current.setAnswer("Was ist gemeint?"));
    await act(async () => { await result.current.submitAnswer(SKETCH); });
    expect(result.current.history).toEqual([]);
    expect(result.current.transcript).toEqual([
      { kind: "clarification", question: QUESTION, text: "Gemeint ist der Durchlauf mit i = 7.", learnerText: "Was ist gemeint?" },
    ]);
    expect(result.current.support?.clarifications).toBe(1);
    expect(result.current.effectiveDifficulty).toBe(30);

    act(() => result.current.setAnswer("0"));
    await act(async () => { await result.current.submitAnswer(SKETCH); });
    const dialog = bodies.filter(({ url }) => url === "/api/tutor/dialog");
    expect(dialog[1]?.body).toMatchObject({ supportSession: support().session, questionHandle: support().questionHandle });
    expect(dialog[1]?.body.actionId).not.toBe(dialog[0]?.body.actionId);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.question?.question).toBe(QUESTION);
    expect(result.current.support?.answerAttempts).toBe(1);
  });

  it("repeats a failed action with the same action id, so the server counts it once", async () => {
    let fail = true;
    const bodies = mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: support() }),
      "/api/tutor/support": () => {
        if (fail) {
          fail = false;
          return json({ error: { code: "PROVIDER_TIMEOUT", message: "late" } }, 504);
        }
        return json({ action: "clarify", explanation: "Gemeint ist der erste Durchlauf.", provider: "kiconnect", model: "m", support: support({ clarifications: 1 }) });
      },
    });
    const { result } = await startDialog();
    await act(async () => { await result.current.requestSupport("clarify", SKETCH); });
    expect(result.current.error).toBe("The Tutor service took too long to respond.");
    expect(result.current.support?.clarifications).toBe(0);
    await act(async () => { await result.current.requestSupport("clarify", SKETCH); });
    const sent = bodies.filter(({ url }) => url === "/api/tutor/support").map(({ body }) => body.actionId);
    expect(sent[0]).toBe(sent[1]);
    expect(result.current.support?.clarifications).toBe(1);
  });

  it("shows the reference answer, marks a later answer as not rated, and skips to the next question or a completion", async () => {
    const unlocked = support({ answerAttempts: 3, clarifications: 2, canRevealReference: true, canSkip: true });
    mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: unlocked }),
      "/api/tutor/support": (body) => body.action === "reveal"
        ? json({ action: "reveal", reference: { status: "available", answer: "1", explanation: "200 & 128 = 128, also 1.", assumptions: ["a = 200"] }, provider: "kiconnect", model: "m", support: { ...unlocked, referenceShown: true } })
        : json({ action: "skip", completed: true, provider: "kiconnect", model: "m", focusProgress: { state: "open", understoodAreas: 0, totalAreas: 2, openAreas: ["Ein Bit prüfen"] } }),
      "/api/tutor/dialog": () => json({ responseStyle: "normal", question: "Warum zählt die Schleife herunter?", feedback: "Stimmt.", learnerInput: "answer", provider: "kiconnect", model: "m", support: support({ questionHandle: "33333333-3333-4333-8333-333333333333" }) }),
    });
    const { result } = await startDialog();
    await act(async () => { await result.current.requestSupport("reveal", SKETCH); });
    expect(result.current.transcript.at(-1)).toMatchObject({ kind: "reference", reference: { status: "available", answer: "1" } });

    act(() => result.current.setAnswer("1"));
    await act(async () => { await result.current.submitAnswer(SKETCH); });
    expect(result.current.transcript.at(-1)).toMatchObject({ kind: "turn", assisted: true });
    expect(result.current.sessionRating).toBeNull();

    await act(async () => { await result.current.requestSupport("skip", SKETCH); });
    expect(result.current.transcript.at(-1)).toMatchObject({ kind: "skip" });
    expect(result.current.completed).toBe(true);
    expect(result.current.question).toBeNull();
    expect(result.current.focusProgress?.openAreas).toEqual(["Ein Bit prüfen"]);
  });
});

describe("Tutor panel learning-support actions", () => {
  function panel(state: TutorSupportState, requestSupport = vi.fn()) {
    const tutor = {
      capabilities: { canUseTutor: true, canConfigureTutor: true },
      config: { provider: "kiconnect" },
      credential: "key", setCredential: vi.fn(), clearCredential: vi.fn(),
      selectedModel: "auto", setSelectedModel: vi.fn(), lastUsedModel: null,
      configuredDifficulty: 30, effectiveDifficulty: 30, setConfiguredDifficulty: vi.fn(),
      sessionRating: null, ratedAnswerCount: 0, availableModels: [], modelsLoading: false, loadModels: vi.fn(),
      question: { question: QUESTION, provider: "kiconnect", model: "m", responseStyle: "normal" },
      focusProgress: null, history: [], transcript: [], support: state, completed: false, requestSupport,
      answer: "", setAnswer: vi.fn(), submitAnswer: vi.fn(), resetDialog: vi.fn(), isLoading: false, error: null, generateQuestion: vi.fn(),
    };
    render(<TutorWorkspacePlaceholder code={SKETCH} tutor={tutor as never} />);
    return requestSupport;
  }

  it("explains why the reference answer and skipping are not available yet, and offers clarify and hint at once", async () => {
    const requestSupport = panel(support({ answerAttempts: 1, clarifications: 1 }));
    expect(await screen.findByTestId("tutor-action-reveal")).toBeDisabled();
    expect(screen.getByTestId("tutor-action-skip")).toBeDisabled();
    expect(screen.getByTestId("tutor-reveal-reason")).toHaveTextContent("Reference answer after 3 own answers (2 more).");
    expect(screen.getByTestId("tutor-skip-reason")).toHaveTextContent("Skipping after 2 explanations of the question (1 more).");
    expect(screen.getByTestId("tutor-action-reveal").getAttribute("aria-describedby")).toBe(screen.getByTestId("tutor-reveal-reason").id);
    expect(screen.getByTestId("tutor-support-status")).toHaveTextContent("Own answers: 1 · Clarifications: 1");

    fireEvent.click(screen.getByTestId("tutor-action-clarify"));
    fireEvent.click(screen.getByTestId("tutor-action-hint"));
    expect(requestSupport.mock.calls.map(([action]) => action)).toEqual(["clarify", "hint"]);
  });

  it("enables both actions once the server unlocked them", async () => {
    const requestSupport = panel(support({ answerAttempts: 3, clarifications: 2, canRevealReference: true, canSkip: true }));
    fireEvent.click(await screen.findByTestId("tutor-action-reveal"));
    fireEvent.click(screen.getByTestId("tutor-action-skip"));
    expect(requestSupport.mock.calls.map(([action]) => action)).toEqual(["reveal", "skip"]);
  });
});
