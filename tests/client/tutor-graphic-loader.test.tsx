import { afterEach, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { tutorResponseSchema } from "@shared/tutor";
import { MermaidPreview } from "@/components/simulator/tutor-mermaid-preview";
import { bindTutorDiagnosticResponse, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";

vi.mock("@/lib/tutor-mermaid", () => { throw new Error("PRIVATE_RENDERER_LOAD_DETAIL"); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("reports a renderer load failure without leaking its error or throwing out of the view", async () => {
  localStorage.setItem("unoDebugMode", "1");
  const events: unknown[] = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener("tutor-diagnostic", listener);
  try {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Welche Reihenfolge?", mermaid: "flowchart LR\nA --> B" }), { status: 200 }));
    const body = await (await tutorDiagnosticFetch("/api/tutor/question", {})).json();
    const question = tutorResponseSchema.parse(body);
    bindTutorDiagnosticResponse(body, question);
    const view = render(<MermaidPreview source={question.mermaid!} subject={question} />);
    await waitFor(() => expect(JSON.stringify(events)).toContain("renderer-load-failed"));
    expect(view.container.querySelector("svg")).toBeNull();
    expect(JSON.stringify(events)).not.toContain("PRIVATE_RENDERER_LOAD_DETAIL");
  } finally { document.removeEventListener("tutor-diagnostic", listener); }
});
