import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import { TutorWorkspacePlaceholder } from "@/components/simulator/ExperimentalWorkspace";
import { TutorSettingsView } from "@/components/simulator/tutor-settings-view";
import { setActiveExternalExampleContext } from "@/lib/external-examples";
import type { TutorSupportState } from "@shared/tutor";
import type { TutorTranscriptEntry } from "@/hooks/use-tutor";

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
      { id: expect.any(String), kind: "clarification", question: QUESTION, text: "Gemeint ist der Durchlauf mit i = 7.", learnerText: "Was ist gemeint?" },
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

  it("tells the learner to choose a model manually when Automatic has no approved model", async () => {
    mockServer({ "/api/tutor/question": () => json({ error: { code: "AUTO_MODEL_UNAVAILABLE", message: "x" } }, 503) });
    const { result } = await startDialog();
    expect(result.current.error).toBe("Für „Automatisch“ ist kein freigegebenes Modell verfügbar. Wähle in den Einstellungen unter „Modell“ ein Modell.");
    expect(result.current.errorCode).toBe("AUTO_MODEL_UNAVAILABLE");
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
    expect(result.current.error).toBe("Der Tutor-Dienst hat zu lange nicht geantwortet.");
    expect(result.current.errorCode).toBe("PROVIDER_TIMEOUT");
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

describe("useTutor: a new learning question after a dialog completed by skipping (review R8)", () => {
  it("starts with an empty transcript and no completion", async () => {
    mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: support({ clarifications: 2, canSkip: true }) }),
      "/api/tutor/support": () => json({ action: "skip", completed: true, provider: "kiconnect", model: "m" }),
    });
    const { result } = await startDialog();
    await act(async () => { await result.current.requestSupport("skip", SKETCH); });
    expect(result.current).toMatchObject({ completed: true, question: null, history: [] });
    expect(result.current.transcript).toHaveLength(1);

    await act(async () => { await result.current.generateQuestion(SKETCH); });
    expect(result.current.transcript).toEqual([]);
    expect(result.current.completed).toBe(false);
    expect(result.current.question?.question).toBe(QUESTION);
  });
});

describe("Tutor panel learning-support actions (LearningQuestions 10.7)", () => {
  type PanelOverrides = Partial<{ transcript: TutorTranscriptEntry[]; error: string; errorCode: string; isLoading: boolean; answer: string; retry: () => void }>;

  function tutorState(state: TutorSupportState, requestSupport = vi.fn(), overrides: PanelOverrides = {}) {
    return {
      capabilities: { canUseTutor: true, canConfigureTutor: true },
      config: { provider: "kiconnect" },
      credential: "key", setCredential: vi.fn(), clearCredential: vi.fn(),
      selectedModel: "auto", setSelectedModel: vi.fn(), lastUsedModel: null,
      configuredDifficulty: 30, effectiveDifficulty: 30, setConfiguredDifficulty: vi.fn(),
      sessionRating: null, ratedAnswerCount: 0, availableModels: [], modelsLoading: false, loadModels: vi.fn(),
      question: { question: QUESTION, provider: "kiconnect", model: "m", responseStyle: "normal" },
      focusProgress: null, history: [], transcript: [], support: state, completed: false, requestSupport,
      answer: "", setAnswer: vi.fn(), submitAnswer: vi.fn(), resetDialog: vi.fn(), isLoading: false, error: null, errorCode: null,
      retry: null, pendingRequest: "answer", generateQuestion: vi.fn(),
      ...overrides,
    };
  }

  /** Renders the panel once its learning step, which loads on demand, is there. */
  async function panel(state: TutorSupportState, requestSupport = vi.fn(), overrides: PanelOverrides = {}) {
    const tutor = tutorState(state, requestSupport, overrides);
    const view = render(<TutorWorkspacePlaceholder code={SKETCH} tutor={tutor as never} />);
    await screen.findByTestId("tutor-question");
    return { requestSupport, tutor, view };
  }

  function openHelp() {
    const toggle = screen.getByTestId("tutor-help-toggle");
    expect(toggle).toHaveAttribute("aria-label", "Hilfe zur aktuellen Frage");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg.lucide-circle-help")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    return toggle;
  }

  it("opens the help on demand without a request and offers only explain and hint before any unlock", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { requestSupport } = await panel(support({ answerAttempts: 1, clarifications: 1 }));
    expect(screen.queryByTestId("tutor-support-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-support-status")).not.toBeInTheDocument();
    const toggle = openHelp();
    expect(await screen.findByTestId("tutor-support-actions")).toBeInTheDocument();
    expect(toggle.getAttribute("aria-controls")).toBe(screen.getByTestId("tutor-support-actions").id);
    expect(screen.getByTestId("tutor-action-clarify")).toHaveTextContent("Frage erklären");
    expect(screen.getByTestId("tutor-action-hint")).toHaveTextContent("Hinweis geben");
    // Locked help is not offered as a disabled button; its rule is one click away.
    expect(screen.queryByTestId("tutor-action-reveal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-action-skip")).not.toBeInTheDocument();
    expect(screen.getByTestId("tutor-reveal-reason")).toHaveTextContent("Musterantwort: nach 3 eigenen Antworten auf diese Frage (noch 2).");
    expect(screen.getByTestId("tutor-skip-reason")).toHaveTextContent("Überspringen: nach 2 Erklärungen der Frage (noch 1). Hinweise zählen nicht dazu.");
    expect(screen.getByTestId("tutor-support-status")).toHaveTextContent("Bisher: 1 eigene Antwort, 1 Erklärung der Frage.");
    fireEvent.click(screen.getByText("Wann gibt es weitere Hilfen?"));
    fireEvent.click(toggle);
    expect(screen.queryByTestId("tutor-support-actions")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(requestSupport).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId("tutor-action-clarify"));
    fireEvent.click(screen.getByTestId("tutor-action-hint"));
    expect(requestSupport.mock.calls).toEqual([["clarify", SKETCH], ["hint", SKETCH]]);
  });

  it("adds skipping and the reference answer once the server unlocked them", async () => {
    const { requestSupport } = await panel(support({ answerAttempts: 3, clarifications: 2, canRevealReference: true, canSkip: true }));
    openHelp();
    fireEvent.click(await screen.findByTestId("tutor-action-reveal"));
    expect(screen.getByTestId("tutor-action-reveal")).toHaveTextContent("Musterantwort ansehen");
    fireEvent.click(screen.getByTestId("tutor-action-skip"));
    expect(screen.getByTestId("tutor-action-skip")).toHaveTextContent("Frage überspringen");
    expect(requestSupport.mock.calls.map(([action]) => action)).toEqual(["reveal", "skip"]);
  });

  it.each([0, 1, 2, 3])("says from the start that no reviewed reference exists, also after %i own answers (review R2)", async (answerAttempts) => {
    await panel(support({ answerAttempts, canRevealReference: answerAttempts >= 3, referenceAvailable: false }));
    openHelp();
    const reason = await screen.findByTestId("tutor-reveal-reason");
    expect(reason).toHaveTextContent("Musterantwort: Für diese Frage und deinen aktuellen Code liegt keine geprüfte Musterantwort vor, auch nicht nach weiteren Antworten.");
    expect(reason).not.toHaveTextContent("nach 3 eigenen Antworten");
    expect(screen.queryByTestId("tutor-action-reveal")).not.toBeInTheDocument();
  });

  it("names the missing answers only while a reviewed reference exists, and offers it once unlocked", async () => {
    const { view, tutor } = await panel(support({ answerAttempts: 1, referenceAvailable: true }));
    openHelp();
    expect(await screen.findByTestId("tutor-reveal-reason")).toHaveTextContent("Musterantwort: nach 3 eigenen Antworten auf diese Frage (noch 2).");
    expect(screen.queryByTestId("tutor-action-reveal")).not.toBeInTheDocument();
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, support: support({ answerAttempts: 3, canRevealReference: true }) } as never} />);
    expect(screen.getByTestId("tutor-reveal-reason")).toHaveTextContent("Musterantwort: freigeschaltet.");
    expect(screen.getByTestId("tutor-action-reveal")).toBeInTheDocument();
  });

  it("points to a help the latest step unlocked, once, and only for the same question", async () => {
    const before = support({ answerAttempts: 2 });
    const { view, tutor } = await panel(before);
    expect(screen.queryByTestId("tutor-unlock-notice")).not.toBeInTheDocument();
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, support: support({ answerAttempts: 3, canRevealReference: true }) } as never} />);
    expect(screen.getByTestId("tutor-unlock-notice")).toHaveTextContent("Neu in der Hilfe zur aktuellen Frage: „Musterantwort ansehen“. Du entscheidest selbst, ob du es nutzt.");
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, support: support({ answerAttempts: 4, canRevealReference: true }) } as never} />);
    expect(screen.queryByTestId("tutor-unlock-notice")).not.toBeInTheDocument();
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, support: support({ questionHandle: "33333333-3333-4333-8333-333333333333", clarifications: 2, canSkip: true }) } as never} />);
    expect(screen.queryByTestId("tutor-unlock-notice")).not.toBeInTheDocument();
  });

  it("shows the latest step of the current question below it, without a rating", async () => {
    const turn = { question: QUESTION, answer: "0", feedback: "Noch nicht ganz.", answerRating: 2 as const, responseStyle: "normal" as const };
    await panel(support({ answerAttempts: 1 }), vi.fn(), {
      transcript: [
        { id: "a", kind: "clarification", question: QUESTION, text: "Gemeint ist i = 7." },
        { id: "b", kind: "turn", turn },
      ],
    });
    const step = screen.getByTestId("tutor-current-step");
    expect(await screen.findByText("Noch nicht ganz.")).toBeInTheDocument();
    expect(step).toHaveTextContent("Deine Antwort0");
    expect(step).not.toHaveTextContent("Gemeint ist i = 7.");
    expect(screen.queryByTestId("tutor-previous-feedback")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-answer-rating")).not.toBeInTheDocument();
    expect(screen.getByTestId("tutor-question").compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the way out that fits a failure and keeps the draft", async () => {
    const { tutor, view } = await panel(support(), vi.fn(), { answer: "Mein Entwurf" });
    const retry = vi.fn();
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, error: "Der Tutor-Dienst hat zu lange nicht geantwortet.", errorCode: "PROVIDER_TIMEOUT", retry } as never} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Der Tutor-Dienst hat zu lange nicht geantwortet.");
    expect(screen.getByLabelText("Deine Antwort oder Rückfrage")).toHaveValue("Mein Entwurf");
    expect(screen.getByTestId("tutor-error-action")).toHaveTextContent("Erneut versuchen");
    fireEvent.click(screen.getByTestId("tutor-error-action"));
    expect(retry).toHaveBeenCalledOnce();
    expect(tutor.submitAnswer).not.toHaveBeenCalled();
    // Without a request to repeat, there is no retry to offer.
    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, error: "x", errorCode: "PROVIDER_TIMEOUT", retry: null } as never} />);
    expect(screen.queryByTestId("tutor-error-action")).not.toBeInTheDocument();

    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, error: "x", errorCode: "AUTO_MODEL_UNAVAILABLE" } as never} />);
    expect(screen.getByTestId("tutor-error-action")).toHaveTextContent("Modell wählen");
    fireEvent.click(screen.getByTestId("tutor-error-action"));
    expect(await screen.findByTestId("tutor-api-key-view")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tutor-apply-key"));

    view.rerender(<TutorWorkspacePlaceholder code={SKETCH} tutor={{ ...tutor, error: "x", errorCode: "SUPPORT_CONFLICT" } as never} />);
    expect(screen.queryByTestId("tutor-error-action")).not.toBeInTheDocument();
  });
});

describe("Tutor model transparency (LearningQuestions 7.3, 10.9)", () => {
  function settings(selectedModel: string, lastUsedModel: string | null) {
    const tutor = {
      capabilities: { canUseTutor: true, canConfigureTutor: true }, config: { provider: "kiconnect" },
      credential: "key", setCredential: vi.fn(), clearCredential: vi.fn(), selectedModel, setSelectedModel: vi.fn(), lastUsedModel,
      configuredDifficulty: 30, effectiveDifficulty: 30, setConfiguredDifficulty: vi.fn(), availableModels: ["openai-gpt5.5", "mistralai-mistral-small-4-119b-2603"], modelsLoading: false,
      error: null,
    };
    render(<TutorSettingsView tutor={tutor as never} onApply={vi.fn()} />);
    return tutor;
  }

  it("names the model that answered last, and says when Automatic chose it", () => {
    settings("auto", "mistralai-mistral-small-4-119b-2603");
    expect(screen.getByTestId("tutor-model-in-use")).toHaveTextContent("Letzte Antwort von mistralai-mistral-small-4-119b-2603 (von „Automatisch“ gewählt)");
  });

  it("names a manually chosen model without the Automatic note", () => {
    settings("openai-gpt5.5", "openai-gpt5.5");
    expect(screen.getByTestId("tutor-model-in-use")).toHaveTextContent(/^Letzte Antwort von openai-gpt5\.5$/);
  });

  it("shows no model before the first response", () => {
    settings("auto", null);
    expect(screen.queryByTestId("tutor-model-in-use")).not.toBeInTheDocument();
  });

  it("forgets the key on request", () => {
    const tutor = settings("auto", null);
    fireEvent.click(screen.getByTestId("tutor-clear-key"));
    expect(tutor.clearCredential).toHaveBeenCalledOnce();
  });
});

describe("Tutor retry repeats exactly the request that failed (review R1)", () => {
  const DRAFT = "Mein wichtiger Entwurf";

  /** A server whose model list times out on the `failingCall`-th request only. */
  function server(failingCall = 1) {
    let models = 0;
    const bodies = mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: support() }),
      "/api/tutor/models": () => {
        models += 1;
        return models === failingCall
          ? json({ error: { code: "PROVIDER_TIMEOUT", message: "late" } }, 504)
          : json({ models: ["pilot-model"] });
      },
    });
    const count = (url: string) => bodies.filter((entry) => entry.url === url).length;
    return { count };
  }

  it("repeats a failed model list, not the earlier question, and keeps question and draft", async () => {
    const { count } = server();
    const { result } = await startDialog();
    act(() => result.current.setAnswer(DRAFT));
    await act(async () => { await result.current.loadModels(); });
    expect(result.current.errorCode).toBe("PROVIDER_TIMEOUT");
    expect(result.current.retry).not.toBeNull();

    await act(async () => { result.current.retry!(); });
    await waitFor(() => expect(count("/api/tutor/models")).toBe(2));
    expect(count("/api/tutor/question")).toBe(1);
    expect(count("/api/tutor/dialog")).toBe(0);
    expect(count("/api/tutor/support")).toBe(0);
    expect(result.current.question?.question).toBe(QUESTION);
    expect(result.current.answer).toBe(DRAFT);
    expect(result.current.availableModels).toEqual(["pilot-model"]);
    expect(result.current.error).toBeNull();
    expect(result.current.retry).toBeNull();
  });

  it("keeps the matching retry when the Tutor column is hidden and shown again", async () => {
    const { count } = server(2);
    function Harness() {
      const tutor = useTutor();
      const [visible, setVisible] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setVisible((value) => !value)}>toggle</button>
          {visible && <TutorWorkspacePlaceholder code={SKETCH} tutor={tutor} />}
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(await screen.findByTestId("tutor-setup-action"));
    fireEvent.change(await screen.findByLabelText("API-Key", { selector: "input" }), { target: { value: "personal-key" } });
    await waitFor(() => expect(count("/api/tutor/models")).toBe(1));
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    fireEvent.click(await screen.findByTestId("tutor-start-question"));
    const field = await screen.findByLabelText("Deine Antwort oder Rückfrage");
    fireEvent.change(field, { target: { value: DRAFT } });
    // Opening the settings loads the model list again; this time it times out.
    fireEvent.keyDown(screen.getByTestId("tutor-menu"), { key: "Enter" });
    fireEvent.click(await screen.findByTestId("tutor-api-key-action"));
    await waitFor(() => expect(count("/api/tutor/models")).toBe(2));
    fireEvent.click(await screen.findByTestId("tutor-settings-back"));
    expect(await screen.findByTestId("tutor-error-action")).toHaveTextContent("Erneut versuchen");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.queryByTestId("tutor-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(await screen.findByTestId("tutor-error-action"));

    await waitFor(() => expect(count("/api/tutor/models")).toBe(3));
    expect(count("/api/tutor/question")).toBe(1);
    expect(screen.getByLabelText("Deine Antwort oder Rückfrage")).toHaveValue(DRAFT);
    expect(screen.getByTestId("tutor-question")).toHaveTextContent("ersten Durchlauf");
    await waitFor(() => expect(screen.queryByTestId("tutor-error-action")).not.toBeInTheDocument());
  });

  it("repeats a failed help with the same action id", async () => {
    let fail = true;
    const bodies = mockServer({
      "/api/tutor/question": () => json({ question: QUESTION, provider: "kiconnect", model: "m", support: support() }),
      "/api/tutor/support": () => {
        if (fail) {
          fail = false;
          return json({ error: { code: "PROVIDER_UNAVAILABLE", message: "down" } }, 503);
        }
        return json({ action: "hint", explanation: "Schau auf i.", provider: "kiconnect", model: "m", support: support() });
      },
    });
    const { result } = await startDialog();
    await act(async () => { await result.current.requestSupport("hint", SKETCH); });
    await act(async () => { result.current.retry!(); });
    await waitFor(() => expect(result.current.transcript.at(-1)).toMatchObject({ kind: "hint" }));
    const sent = bodies.filter(({ url }) => url === "/api/tutor/support").map(({ body }) => [body.action, body.actionId]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });
});
