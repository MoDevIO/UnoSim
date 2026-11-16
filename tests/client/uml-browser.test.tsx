import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useTutor } from "@/hooks/use-tutor";
import { TutorLearningStep } from "@/components/simulator/tutor-learning-step";
import { activity } from "../server/services/tutor/uml/contract-fixtures";

const CODE = "void setup(){} void loop(){}";
const support = { session: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222", answerAttempts: 0, clarifications: 0, canRevealReference: false, canSkip: false, referenceAvailable: false, referenceShown: false, outcome: "open" };
const question = { provider: "kiconnect", model: "m", question: "Wie verzweigt run?", support };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900" viewBox="0 0 800 900"><text x="10" y="20" font-size="14">on();</text></svg>';
function diagram(source = svg) { return { version: 1, profile: "uml1-classic-v1", kind: "activity", purpose: activity.purpose, proposal: activity, image: { svg: source, width: 800, height: 900, bytes: new TextEncoder().encode(source).length, rendererRevision: "test-1" } }; }
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("sends the profile only to an advertised server (%s)", async (advertised) => {
  const bodies: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" }, ...(advertised ? { tutorGraphics: { profiles: ["uml1-classic-v1"], available: true } } : {}) }));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(question));
  });
  const { result } = renderHook(() => useTutor());
  await act(async () => {});
  act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  expect(bodies[0].graphicsProfile).toBe(advertised ? "uml1-classic-v1" : undefined);
});

it.each(["question", "dialog", "support"])("retries %s with its original profile, mode and action fingerprint", async (endpoint) => {
  const bodies: Record<string, unknown>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" }, tutorGraphics: { profiles: ["uml1-classic-v1"], available: true } }));
    if (String(url) === `/api/tutor/${endpoint}`) {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) { await gate; return new Response("{}", { status: 503 }); }
    }
    return new Response(JSON.stringify(endpoint === "support" && String(url).endsWith("support") ? { action: "hint", explanation: "Betrachte run.", ...question } : question));
  });
  localStorage.setItem("unoTutorGraphicsMode", "always");
  const { result } = renderHook(() => useTutor());
  await act(async () => {});
  act(() => result.current.setCredential("key"));
  if (endpoint !== "question") await act(() => result.current.generateQuestion(CODE));
  act(() => result.current.setAnswer("Antwort"));
  let pending!: Promise<void>;
  act(() => { pending = endpoint === "question" ? result.current.generateQuestion(CODE) : endpoint === "dialog" ? result.current.submitAnswer(CODE) : result.current.requestSupport("hint", CODE); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  localStorage.setItem("unoTutorGraphicsMode", "auto");
  release(); await act(() => pending);
  act(() => result.current.retryFor(CODE)!());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[0].graphicsProfile).toBe("uml1-classic-v1");
  expect(bodies[1]).toEqual(bodies[0]);
});

it.each(["provided", "unavailable", "not-useful"])("holds a next %s graphic with its question until Weiter", async (status) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url) === "/api/config" ? { tutor: { provider: "kiconnect" } } : String(url).endsWith("dialog") ? { ...question, question: "Nächste Frage?", questionStatus: "closed", feedback: "Richtig", answerRating: 5, graphicStatus: status, ...(status === "provided" ? { diagram: diagram() } : {}) } : question)));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  const { result } = renderHook(() => useTutor());
  act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  act(() => result.current.setAnswer("Antwort"));
  await act(() => result.current.submitAnswer(CODE));
  const actions = { continueToNextQuestion: result.current.continueToNextQuestion } as Parameters<typeof TutorLearningStep>[0]["actions"];
  const view = render(<TutorLearningStep tutor={result.current} actions={actions} />);
  expect(screen.queryByTestId("tutor-uml")).toBeNull();
  expect(screen.queryByText("Grafik konnte nicht bereitgestellt werden.")).toBeNull();
  expect(screen.queryByText("Zu dieser Frage ist keine hilfreiche zusätzliche UML-Grafik verfügbar.")).toBeNull();
  act(() => result.current.continueToNextQuestion());
  view.rerender(<TutorLearningStep tutor={result.current} actions={actions} />);
  if (status === "provided") expect(await screen.findByTestId("tutor-uml")).toBeInTheDocument();
  // A question without a graphic says nothing about it; only a failed one is reported.
  else if (status === "unavailable") expect(screen.getByText("Grafik konnte nicht bereitgestellt werden.")).toBeInTheDocument();
  else expect(screen.queryByText(/UML-Grafik/)).toBeNull();
  expect(JSON.stringify(result.current.transcript)).not.toContain("<svg");
});

it("keeps text usable if an optional image fails its transport bounds", async () => {
  const image = diagram(); image.image.width = 2401;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ ...question, diagram: image, graphicStatus: "provided" })));
  const { result } = renderHook(() => useTutor());
  act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  expect(result.current.question?.question).toBe(question.question);
  expect(result.current.question?.diagram?.image).toBeUndefined();
  expect(result.current.error).toBeNull();
});

it("keeps a legacy snapshot on retry when capability discovery finishes after the action started", async () => {
  let discover!: () => void;
  const configGate = new Promise<void>((resolve) => { discover = resolve; });
  const bodies: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/config") { await configGate; return new Response(JSON.stringify({ tutor: { provider: "kiconnect" }, tutorGraphics: { profiles: ["uml1-classic-v1"], available: true } })); }
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(bodies.length === 1 ? {} : question), { status: bodies.length === 1 ? 503 : 200 });
  });
  const { result } = renderHook(() => useTutor()); act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  discover(); await act(async () => {});
  act(() => result.current.retryFor(CODE)!()); await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[0].graphicsProfile).toBeUndefined(); expect(bodies[1].graphicsProfile).toBeUndefined();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(() => result.current.generateQuestion(CODE));
  expect(bodies[2].graphicsProfile).toBe("uml1-classic-v1");
});

it("keeps a skipped question usable when its optional image is invalid", async () => {
  const broken = diagram(); broken.image.height = 4001;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url) === "/api/config" ? { tutor: { provider: "kiconnect" } } : String(url).endsWith("support") ? { provider: "kiconnect", model: "m", action: "skip", support, next: { question: "Neue Frage?", responseStyle: "normal", graphicStatus: "provided", diagram: broken } } : question)));
  const { result } = renderHook(() => useTutor()); act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  await act(() => result.current.requestSupport("skip", CODE));
  expect(result.current.error).toBeNull(); expect(result.current.question?.question).toBe("Neue Frage?");
  expect(result.current.question?.diagram?.image).toBeUndefined(); expect(JSON.stringify(result.current.transcript)).not.toContain("<svg");
});

it("never sends a negotiated response through the legacy Mermaid renderer", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url) === "/api/config" ? { tutor: { provider: "kiconnect" }, tutorGraphics: { profiles: ["uml1-classic-v1"], available: true } } : { ...question, mermaid: "flowchart LR\nA --> B", graphicStatus: "provided" })));
  const { result } = renderHook(() => useTutor()); await act(async () => {}); act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  expect(result.current.question?.mermaid).toBeUndefined(); expect(result.current.question?.graphicStatus).toBe("unavailable");
});
