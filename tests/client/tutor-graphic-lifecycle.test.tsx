import { afterEach, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { tutorResponseSchema } from "@shared/tutor";
import { MermaidPreview } from "@/components/simulator/tutor-mermaid-preview";
import { bindTutorDiagnosticResponse, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("reports rendering only after the actual safe SVG is inserted in the Tutor DOM", async () => {
  localStorage.setItem("unoDebugMode", "1");
  const events: Array<{ stage: string; outcome: string }> = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener("tutor-diagnostic", listener);
  try {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Welche Reihenfolge?", mermaid: "flowchart LR\nA[setup] --> B[loop]" }), { status: 200 }));
    const body = await (await tutorDiagnosticFetch("/api/tutor/question", {})).json();
    const question = tutorResponseSchema.parse(body);
    bindTutorDiagnosticResponse(body, question);
    expect(events.some((event) => event.outcome === "rendered")).toBe(false);
    const view = render(<MermaidPreview source={question.mermaid!} subject={question} />);
    await waitFor(() => expect(view.container.querySelector("svg")).not.toBeNull());
    await waitFor(() => expect(events.filter((event) => event.stage === "renderer" && event.outcome === "rendered")).toHaveLength(1));
    expect(view.container.textContent).toContain("setup");
    view.rerender(<MermaidPreview source={question.mermaid!} subject={question} />);
    expect(events.filter((event) => event.outcome === "rendered")).toHaveLength(1);
    view.rerender(<MermaidPreview source={"flowchart LR\nA --> B\nB -.-> C"} subject={question} />);
    expect(view.container.querySelector("svg")).toBeNull();
    await waitFor(() => expect(events.some((event) => event.outcome === "rejected")).toBe(true));
  } finally { document.removeEventListener("tutor-diagnostic", listener); }
});
