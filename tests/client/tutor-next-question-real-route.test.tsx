/**
 * The Weiter step against the real support route and store (review of 2356be848, R1): only the Tutor's
 * generation is simulated. Changed code binds the open question anew under another handle; a weak answer to it
 * must stay editable. The server says whether an answer closed its question (`questionStatus`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useTutor } from "@/hooks/use-tutor";
import { TutorWorkspacePlaceholder } from "@/components/simulator/ExperimentalWorkspace";
import { handleSupportedDialog, openSupportSession } from "../../server/routes/tutor-support.routes";
import { TutorSupportStore } from "../../server/services/tutor/learning-support-store";
import { setActiveExternalExampleContext } from "@/lib/external-examples";

const CODE = "int a = 37; void setup() { Serial.begin(9600); Serial.println(a); } void loop() {}";
const EDITED = CODE.replace("37", "200");
const QUESTION = "Welche Zahl gibt der Sketch aus?";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { cleanup(); vi.restoreAllMocks(); setActiveExternalExampleContext(null); });

function realSupportServer({ failFirst = false, strong = false, modelsFail = false } = {}) {
  const store = new TutorSupportStore();
  let fail = failFirst;
  const bodies: { url: string; body: any; response?: any }[] = [];
  const service = {
    generateDialogResponse: vi.fn(async () => ({ model: "m", retained: !strong, result: { question: strong ? "Was macht Serial.begin?" : QUESTION, feedback: strong ? "Richtig." : "Noch nicht.", answerRating: strong ? 4 : 2, responseStyle: "normal" } })),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const call = { url, body, response: undefined as any };
    bodies.push(call);
    if (url === "/api/config") return json({});
    if (url === "/api/tutor/models") return modelsFail ? json({ error: { code: "PROVIDER_TIMEOUT" } }, 504) : json({ models: ["m"] });
    const res = { locals: { unosimIdentity: { subject: "test.local" } }, headersSent: false } as any;
    if (url === "/api/tutor/question") {
      const support = openSupportSession(res, store, QUESTION, body, undefined, undefined);
      return json({ question: QUESTION, provider: "kiconnect", model: "m", support });
    }
    if (url !== "/api/tutor/dialog") throw new Error(`Unexpected mocked request ${url}`);
    if (fail) { fail = false; return json({ error: { code: "PROVIDER_TIMEOUT" } }, 504); }
    let responseBody: any;
    let status = 200;
    res.json = (value: any) => { responseBody = value; res.headersSent = true; return res; };
    res.status = (value: number) => { status = value; return res; };
    await handleSupportedDialog({} as never, res, body, init?.signal as AbortSignal, { supportStore: store, sessionStore: {} as never, service: service as never, logger: { warn: vi.fn(), error: vi.fn() } });
    call.response = responseBody;
    return json(responseBody, status);
  });
  return { bodies, dialogs: () => bodies.filter((call) => call.url === "/api/tutor/dialog") };
}

async function start() {
  const hook = renderHook(() => useTutor());
  act(() => hook.result.current.setCredential("test-key"));
  await act(async () => hook.result.current.generateQuestion(CODE));
  return hook;
}

describe("Weiter after an answer, with the real support route (R1)", () => {
  it("control: a weak answer to unchanged code keeps the question editable", async () => {
    realSupportServer();
    const { result } = await start();
    act(() => result.current.setAnswer("12"));
    await act(async () => result.current.submitAnswer(CODE));
    expect(result.current.history.at(-1)?.answerRating).toBe(2);
    expect(result.current.awaitingNext).toBe(false);
  });

  it("regression: weak answer after code edit must stay editable even when the real server resets its handle", async () => {
    const server = realSupportServer({ failFirst: true });
    const { result } = await start();
    act(() => result.current.setAnswer("12"));
    await act(async () => result.current.submitAnswer(CODE));
    const oldHandle = result.current.support?.questionHandle;
    act(() => result.current.setAnswer("13"));
    expect(result.current.retryFor(EDITED)).toBeNull();
    await act(async () => result.current.submitAnswer(EDITED));
    const [, sent] = server.dialogs();
    expect(sent.body.actionId).not.toBe(server.dialogs()[0].body.actionId);
    expect(sent.body).toMatchObject({ code: EDITED, answer: "13" });
    expect(sent.response).toMatchObject({ question: QUESTION, answerRating: 2, support: { answerAttempts: 1 } });
    expect(sent.response.support.questionHandle).not.toBe(oldHandle);
    expect(result.current.history.at(-1)?.answerRating).toBe(2);
    expect(result.current.awaitingNext).toBe(false);
  });

  it("regression in panel: new weak answer to edited code must expose an answer field, not Continue", async () => {
    realSupportServer();
    let tutor!: ReturnType<typeof useTutor>;
    function Harness({ code }: { code: string }) { tutor = useTutor(); return <TutorWorkspacePlaceholder tutor={tutor} code={code} />; }
    const view = render(<Harness code={CODE} />);
    act(() => tutor.setCredential("test-key"));
    await act(async () => tutor.generateQuestion(CODE));
    await screen.findByLabelText("Deine Antwort oder Rückfrage");
    view.rerender(<Harness code={EDITED} />);
    fireEvent.change(screen.getByLabelText("Deine Antwort oder Rückfrage"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("tutor-send-answer"));
    await waitFor(() => expect(tutor.history).toHaveLength(1));
    expect(screen.queryByTestId("tutor-continue")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Deine Antwort oder Rückfrage")).toBeEnabled();
  });

  it("control: unchanged retry preserves all payload fields and actionId", async () => {
    const server = realSupportServer({ failFirst: true });
    const { result } = await start();
    act(() => result.current.setAnswer("12"));
    await act(async () => result.current.submitAnswer(CODE));
    await act(async () => { result.current.retryFor(CODE)!(); });
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(server.dialogs()[1].body).toEqual(server.dialogs()[0].body);
    expect(result.current.awaitingNext).toBe(false);
  });

  it("control: Continue makes no request and books the successful answer once", async () => {
    const server = realSupportServer({ strong: true });
    const { result } = await start();
    act(() => result.current.setAnswer("37"));
    await act(async () => result.current.submitAnswer(CODE));
    expect(result.current.awaitingNext).toBe(true);
    const difficulty = result.current.effectiveDifficulty;
    const before = server.bodies.length;
    act(() => result.current.continueToNextQuestion());
    expect(result.current.question?.question).toBe("Was macht Serial.begin?");
    expect(result.current.history).toHaveLength(1);
    expect(result.current.ratedAnswerCount).toBe(1);
    expect(result.current.effectiveDifficulty).toBe(difficulty);
    expect(server.bodies).toHaveLength(before);
  });

  it("reports the question status: open for a weak answer, closed for a strong one", async () => {
    const weak = realSupportServer();
    const first = await start();
    act(() => first.result.current.setAnswer("12"));
    await act(async () => first.result.current.submitAnswer(CODE));
    expect(weak.dialogs()[0]?.response).toMatchObject({ questionStatus: "open" });
    first.unmount();
    vi.restoreAllMocks();

    const strong = realSupportServer({ strong: true });
    const second = await start();
    act(() => second.result.current.setAnswer("37"));
    await act(async () => second.result.current.submitAnswer(CODE));
    expect(strong.dialogs()[0]?.response).toMatchObject({ questionStatus: "closed" });
  });
});
