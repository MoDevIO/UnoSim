import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";
import { setActiveExternalExampleContext } from "@/lib/external-examples";

const code = "void setup() {} void loop() {}";
const id = "11111111-1111-4111-8111-111111111111";
const initial = { provider: "kiconnect", model: "m", question: "Was passiert zuerst?", support: { session: id, questionHandle: id, answerAttempts: 0, clarifications: 0, canRevealReference: false, canSkip: false, referenceAvailable: false, referenceShown: false, outcome: "open" } };
afterEach(() => { localStorage.clear(); setActiveExternalExampleContext(null); vi.restoreAllMocks(); });

it.each([
  ["question", null], ["question", { foo: "bar" }], ["models", { foo: "bar" }], ["dialog", { foo: "bar" }], ["support", { foo: "bar" }],
])("records an invalid %s learning response as failed", async (kind, invalid) => {
  localStorage.setItem("unoDebugMode", "1");
  const events: Array<{ stage: string; outcome: string; reason?: string }> = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener("tutor-diagnostic", listener);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(
    String(url) === "/api/config" ? { tutor: { provider: "kiconnect" }, tutorDiagnosticsAvailable: true }
      : String(url).endsWith(`/${kind}`) ? invalid : initial,
  ), { status: 200 }));
  try {
    const hook = renderHook(() => useTutor());
    act(() => hook.result.current.setCredential("private-test-key"));
    if (kind === "models") await act(async () => hook.result.current.loadModels());
    else {
      await act(async () => hook.result.current.generateQuestion(code));
      if (kind === "dialog") {
        act(() => hook.result.current.setAnswer("Eine Antwort"));
        await act(async () => hook.result.current.submitAnswer(code));
      } else if (kind === "support") await act(async () => hook.result.current.requestSupport("clarify", code));
    }
    expect(hook.result.current.error).not.toBeNull();
    expect(events.at(-1)).toMatchObject({ stage: "request", outcome: "failed", reason: "invalid-response" });
  } finally { document.removeEventListener("tutor-diagnostic", listener); }
});

it("closes a held graphic trace when a new learning context clears the dialog", async () => {
  localStorage.setItem("unoDebugMode", "1");
  const events: Array<{ outcome: string; reason?: string }> = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener("tutor-diagnostic", listener);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(
    String(url) === "/api/config" ? { tutor: { provider: "kiconnect" }, tutorDiagnosticsAvailable: true }
      : String(url).endsWith("/dialog") ? { ...initial, question: "Was passiert danach?", questionStatus: "closed", answerRating: 5, mermaid: "flowchart LR\nA --> B" } : initial,
  ), { status: 200 }));
  try {
    const hook = renderHook(() => useTutor());
    act(() => hook.result.current.setCredential("private-test-key"));
    await act(async () => hook.result.current.generateQuestion(code));
    act(() => hook.result.current.setAnswer("Die erste Funktion beginnt."));
    await act(async () => hook.result.current.submitAnswer(code));
    expect(hook.result.current.awaitingNext).toBe(true);
    expect(events.some((event) => event.outcome === "held")).toBe(true);
    expect(JSON.stringify(hook.result.current.history)).not.toMatch(/"(?:diagnostics|traceId|requestId|diagramId)"/);
    expect(JSON.stringify(localStorage)).not.toMatch(/"(?:diagnostics|traceId|requestId|diagramId)"/);
    act(() => hook.result.current.resetDialog());
    expect(events.some((event) => event.outcome === "discarded" && event.reason === "context-changed")).toBe(true);
  } finally { document.removeEventListener("tutor-diagnostic", listener); }
});
