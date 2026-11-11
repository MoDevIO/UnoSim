import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import { tutorDiagnosticFetch, bindTutorDiagnosticResponse, reportTutorGraphic, tutorRequestTrace } from "@/lib/tutor-diagnostics";

const events: unknown[] = [];
const onEvent = (event: Event) => events.push((event as CustomEvent).detail);
beforeEach(() => { events.length = 0; localStorage.setItem("unoDebugMode", "1"); document.addEventListener("tutor-diagnostic", onEvent); });
afterEach(() => { localStorage.clear(); document.removeEventListener("tutor-diagnostic", onEvent); vi.unstubAllGlobals(); });

describe("Tutor diagnostic browser transport", () => {
  it("separates malformed diagnostics from valid learning content without logging raw data", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      provider: "kiconnect", model: "model", question: "PRIVATE_QUESTION_SENTINEL?", mermaid: "flowchart LR\nA --> B",
      diagnostics: { raw: "PRIVATE_DIAGNOSTIC_SENTINEL" },
    }), { status: 200 }));
    const response = await tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: "PRIVATE_KEY_SENTINEL" }) });
    const body = await response.json();
    const parsed = tutorResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body).not.toHaveProperty("diagnostics");
    expect(JSON.stringify(events)).toContain("diagnostics-invalid");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_");
  });

  it("keeps the logical trace across retries while assigning a fresh request ID", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Welche Reihenfolge?" }), { status: 200 }));
    const first = new AbortController();
    await (await tutorDiagnosticFetch("/api/tutor/question", { signal: first.signal })).json();
    const traceId = tutorRequestTrace(first.signal);
    expect(traceId).toBeDefined();
    const second = new AbortController();
    await (await tutorDiagnosticFetch("/api/tutor/question", { signal: second.signal }, { traceId })).json();
    const starts = (events as Array<{stage: string; outcome: string; traceId: string; requestId: string}>).filter((event) => event.stage === "request" && event.outcome === "started");
    expect(starts).toHaveLength(2);
    expect(starts[0].traceId).toBe(starts[1].traceId);
    expect(starts[0].requestId).not.toBe(starts[1].requestId);
  });

  it("records graphics as received and held before a later display event", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Welche Reihenfolge?", mermaid: "flowchart LR\nA --> B" }), { status: 200 }));
    const body = await (await tutorDiagnosticFetch("/api/tutor/question", {})).json();
    const question = tutorResponseSchema.parse(body);
    bindTutorDiagnosticResponse(body, question);
    bindTutorDiagnosticResponse(question, { ...question });
    expect((events as Array<{stage: string; outcome: string}>).filter((event) => event.stage === "browser" && event.outcome === "received")).toHaveLength(1);
    reportTutorGraphic(question, { stage: "browser", outcome: "held", reason: "awaiting-continue" });
    expect(JSON.stringify(events)).toContain('"outcome":"received"');
    expect(JSON.stringify(events)).toContain('"outcome":"held"');
    expect(JSON.stringify(events)).not.toContain('"outcome":"rendered"');
    localStorage.setItem("unoDebugMode", "0");
    const count = events.length;
    reportTutorGraphic(question, { stage: "renderer", outcome: "rendered" });
    expect(events).toHaveLength(count);
  });
});
