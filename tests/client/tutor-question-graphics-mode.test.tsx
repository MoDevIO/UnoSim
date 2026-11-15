import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import SettingsDialog from "@/components/features/settings-dialog";
import { MermaidPreview } from "@/components/simulator/tutor-mermaid-preview";
import { useTutor } from "@/hooks/use-tutor";

const CODE = "void setup(){} void loop(){}";
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("defaults graphics off, stores the setting and restores it on reopening Settings", () => {
  const view = render(<SettingsDialog open onOpenChange={vi.fn()} />);
  const toggle = screen.getByRole("checkbox", { name: "Grafiken immer anfordern" });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(localStorage.getItem("unoTutorGraphicsMode")).toBe("always");
  view.unmount();
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Grafiken immer anfordern" })).toBeChecked();
});

it("shows an explicit failure for a delivered graphic the renderer cannot draw", async () => {
  render(<MermaidPreview source={"flowchart LR\nA -.-> B"} subject={{}} showFailure />);
  expect(await screen.findByText("Grafik konnte nicht dargestellt werden.")).toBeInTheDocument();
  expect(screen.queryByTestId("tutor-mermaid")).toBeNull();
});

it("snapshots mode for the request and its retry, while the next action uses the new setting", async () => {
  const bodies: Record<string, unknown>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }));
    if (String(url) === "/api/tutor/question") {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) { await gate; return new Response(JSON.stringify({ message: "Fail" }), { status: 503 }); }
      return new Response(JSON.stringify({ question: "Welche Aufgabe hat setup?", model: "m", provider: "kiconnect" }));
    }
    throw new Error(`Unexpected ${url}`);
  });
  localStorage.setItem("unoTutorGraphicsMode", "always");
  const { result } = renderHook(() => useTutor());
  act(() => result.current.setCredential("key"));
  let pending!: Promise<void>;
  act(() => { pending = result.current.generateQuestion(CODE); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  localStorage.setItem("unoTutorGraphicsMode", "auto");
  release();
  await act(() => pending);
  expect(bodies[0].graphicsMode).toBe("always");
  act(() => result.current.retryFor(CODE)!());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].graphicsMode).toBe("always");
  await act(() => result.current.generateQuestion(CODE));
  expect(bodies[2].graphicsMode).toBeUndefined();
});

it.each(["dialog", "support"])("keeps the original mode and action id on %s retry after switching Settings", async (endpoint) => {
  const support = { session: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222", answerAttempts: 0, clarifications: 0, canRevealReference: false, canSkip: false, referenceAvailable: false, referenceShown: false, outcome: "open" };
  const bodies: Record<string, unknown>[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }));
    if (String(url) === "/api/tutor/question") return new Response(JSON.stringify({ question: "Welche Aufgabe hat setup?", model: "m", provider: "kiconnect", support }));
    if (String(url) === `/api/tutor/${endpoint}`) {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) { await gate; return new Response(JSON.stringify({ message: "Fail" }), { status: 503 }); }
      return new Response(JSON.stringify(endpoint === "dialog"
        ? { question: "Welche Aufgabe hat setup?", model: "m", provider: "kiconnect", feedback: "Präzisiere die Aussage.", answerRating: 2, questionStatus: "open", support }
        : { action: "hint", explanation: "Betrachte die Aufrufreihenfolge.", model: "m", provider: "kiconnect", support }));
    }
    throw new Error(`Unexpected ${url}`);
  });
  localStorage.setItem("unoTutorGraphicsMode", "always");
  const { result } = renderHook(() => useTutor());
  act(() => result.current.setCredential("key"));
  await act(() => result.current.generateQuestion(CODE));
  act(() => result.current.setAnswer("Eine fachliche Antwort"));
  let pending!: Promise<void>;
  act(() => { pending = endpoint === "dialog" ? result.current.submitAnswer(CODE) : result.current.requestSupport("hint", CODE); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  localStorage.setItem("unoTutorGraphicsMode", "auto");
  release();
  await act(() => pending);
  act(() => result.current.retryFor(CODE)!());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].graphicsMode).toBe("always");
  expect(bodies[1].actionId).toBe(bodies[0].actionId);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  if (endpoint === "dialog") {
    act(() => result.current.setAnswer("Eine fachliche Antwort"));
    await act(() => result.current.submitAnswer(CODE));
  } else await act(() => result.current.requestSupport("hint", CODE));
  expect(bodies[2].graphicsMode).toBeUndefined();
  expect(bodies[2].actionId).not.toBe(bodies[0].actionId);
});

it("keeps the switch effective for the current tab when browser storage is unavailable", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const { readTutorGraphicsMode, writeTutorGraphicsMode } = await import("@/lib/tutor-graphics-preference");
  try {
    writeTutorGraphicsMode("always");
    expect(readTutorGraphicsMode()).toBe("always");
    writeTutorGraphicsMode("auto");
    expect(readTutorGraphicsMode()).toBe("auto");
  } finally { get.mockRestore(); set.mockRestore(); }
});
