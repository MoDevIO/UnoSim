import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import {
  ensureExternalExamplesCatalog,
  normalizeSelection,
  refreshExternalExamplesCatalog,
  setActiveExternalExampleContext,
  setExternalExamplesOverride,
} from "@/lib/external-examples";

const SKETCH = "void setup() {} void loop() {}";
const REVISION = "a".repeat(40);
const catalog = {
  schemaVersion: 1,
  source: { selection: "default", mode: "repository-ref", repository: "owner/repo", ref: "main", revision: REVISION, status: "remote", stale: false },
  examples: [],
};
const question = (text: string, id?: string) => ({
  question: text,
  ...(id ? { questionId: id, topicId: "inline-beispiel", conceptId: "bereich", indicatorId: "versteht" } : {}),
  provider: "kiconnect",
  model: "fake",
});

function mockTutor(routes: Record<string, () => unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input).split("?")[0] ?? "";
    if (url === "/api/config") return new Response("{}");
    const route = routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    return new Response(JSON.stringify(route()));
  });
}

async function startDialog() {
  const view = renderHook(() => useTutor());
  act(() => view.result.current.setCredential("key"));
  await act(async () => view.result.current.generateQuestion(SKETCH));
  return view.result;
}

const tutorBodies = (fetchMock: ReturnType<typeof mockTutor>) => fetchMock.mock.calls
  .filter(([input]) => String(input) === "/api/tutor/question")
  .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setExternalExamplesOverride(null);
});

describe("Tutor dialog and learning situation", () => {
  it("records the answered question with its own identity and the next one with its own", async () => {
    mockTutor({
      "/api/tutor/question": () => question("Frage A?", "frage-a"),
      "/api/tutor/dialog": () => ({ ...question("Frage B?", "frage-b"), answerRating: 5, feedback: "Gut.", responseStyle: "normal" }),
    });
    const result = await startDialog();
    act(() => result.current.setAnswer("Antwort"));
    await act(async () => result.current.submitAnswer(SKETCH));

    expect(result.current.history[0]).toMatchObject({ question: "Frage A?", questionId: "frage-a", answerRating: 5, feedback: "Gut." });
    // The answered question stays shown until the learner goes on.
    expect(result.current.question?.questionId).toBe("frage-a");
    act(() => result.current.continueToNextQuestion());
    expect(result.current.question?.questionId).toBe("frage-b");
  });

  it("uses the selected course for the first question, before any menu was opened", async () => {
    setExternalExamplesOverride(normalizeSelection("owner/repo", "main"));
    const fetchMock = mockTutor({ "/api/examples": () => catalog, "/api/tutor/question": () => question("Frage?") });
    ensureExternalExamplesCatalog();
    await startDialog();

    expect(tutorBodies(fetchMock)[0]).toMatchObject({ courseContent: { repository: "owner/repo", ref: "main", revision: REVISION } });
  });

  it("keeps question, draft and dialog context when a catalog arrives", async () => {
    const fetchMock = mockTutor({
      "/api/examples": () => catalog,
      "/api/tutor/question": () => question("Meine Frage?"),
      "/api/tutor/dialog": () => ({ ...question("Nächste?"), answerRating: 4, responseStyle: "normal" }),
    });
    const result = await startDialog();
    act(() => result.current.setAnswer("Mein Entwurf"));
    await act(async () => { await refreshExternalExamplesCatalog(); });

    expect(result.current.answer).toBe("Mein Entwurf");
    expect(result.current.question?.question).toBe("Meine Frage?");
    await act(async () => result.current.submitAnswer(SKETCH));
    const dialog = fetchMock.mock.calls.find(([input]) => String(input) === "/api/tutor/dialog");
    expect(JSON.parse(String(dialog?.[1]?.body))).not.toHaveProperty("courseContent");
  });

  it.each([
    ["a built-in or library example", null],
    ["a remote example", { repository: "owner/repo", ref: "main", revision: REVISION, exampleId: "beispiel" }],
  ])("starts over when %s is taken over, also when the context stays the same", async (_name, context) => {
    setActiveExternalExampleContext(context);
    mockTutor({ "/api/examples": () => catalog, "/api/tutor/question": () => question("Alte Frage?") });
    const result = await startDialog();
    act(() => result.current.setAnswer("Alter Entwurf"));

    act(() => setActiveExternalExampleContext(context));

    await waitFor(() => expect(result.current.question).toBeNull());
    expect(result.current.answer).toBe("");
    expect(result.current.credential).toBe("key");
  });

  it("does not bring a question back when its response arrives after a reset", async () => {
    let release: (response: Response) => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => String(input) === "/api/config"
      ? Promise.resolve(new Response("{}"))
      : new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("key"));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.generateQuestion(SKETCH); });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.resetDialog());
    await act(async () => {
      release(new Response(JSON.stringify(question("Alte Frage?"))));
      await pending;
    });

    expect(result.current.question).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("ends the loading state at a project change while the shared catalog still loads, and a late end leaves the new request alone", async () => {
    let releaseCatalog: (response: Response) => void = () => undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("/api/examples")) return new Promise((resolve) => { releaseCatalog = resolve; });
      return Promise.resolve(new Response(url === "/api/config" ? "{}" : JSON.stringify(question("Neue Frage?"))));
    });
    ensureExternalExamplesCatalog();
    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("key"));
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.generateQuestion(SKETCH); });
    expect(result.current.isLoading).toBe(true);

    act(() => setActiveExternalExampleContext(null));
    expect(result.current.isLoading).toBe(false);
    await act(async () => { await first; });

    let held: Promise<void> = Promise.resolve();
    act(() => { held = result.current.generateQuestion(SKETCH); });
    expect(result.current.isLoading).toBe(true);
    act(() => setActiveExternalExampleContext(null));
    await act(async () => {
      releaseCatalog(new Response(JSON.stringify(catalog)));
      await held;
    });
    expect(result.current.question).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("shows where the learner stands in the focus and keeps it through an off-topic answer", async () => {
    const focusProgress = { state: "active", understoodAreas: 1, totalAreas: 2, openAreas: ["Index"] };
    mockTutor({
      "/api/tutor/question": () => ({ ...question("Frage?"), focusProgress }),
      "/api/tutor/dialog": () => ({ ...question("Zurück zum Sketch: Frage?"), responseStyle: "philosophical" }),
    });
    const result = await startDialog();
    expect(result.current.focusProgress).toEqual(focusProgress);
    act(() => result.current.setAnswer("Pizza"));
    await act(async () => result.current.submitAnswer(SKETCH));
    expect(result.current.focusProgress).toEqual(focusProgress);
  });
});
