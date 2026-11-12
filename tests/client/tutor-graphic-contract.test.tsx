import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { tutorResponseSchema, type TutorSupportState } from "@shared/tutor";
import { checkTutorMermaid } from "@shared/tutor-mermaid-rules";
import { MermaidPreview } from "@/components/simulator/tutor-mermaid-preview";
import { TutorWorkspacePlaceholder } from "@/components/simulator/ExperimentalWorkspace";
import { renderMermaidDiagram } from "@/lib/tutor-mermaid";
import { useTutor } from "@/hooks/use-tutor";

/**
 * The graphic and the question it belongs to in the browser (Plan Aufgabe 5, GQ-02..GQ-04). The server
 * side of the same contract is `tests/server/services/tutor/tutor-graphic-question-contract.test.ts`.
 */

const GRAPHIC = "flowchart LR\n  A[value setzen] --> B[ausgeben] --> C[Ende]";
const SKETCH = "int value = 3; void setup() { Serial.println(value); } void loop() {}";
const FIRST = "Welche Rolle hat value im Sketch?";
const NEXT = "Wie wird value bei der seriellen Ausgabe verwendet?";
const HANDLE_A = "22222222-2222-4222-8222-222222222222";
const HANDLE_B = "33333333-3333-4333-8333-333333333333";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const svgOf = (source: string): Document => {
  const result = renderMermaidDiagram(source, "contract-marker");
  expect(result.status).toBe("rendered");
  return new DOMParser().parseFromString((result as { svg: string }).svg, "image/svg+xml");
};

describe("GQ-02: the delivered graphic is drawn with exactly its nodes and edges", () => {
  it("draws three labelled nodes in order and two connections, not just 'some SVG'", () => {
    const doc = svgOf(GRAPHIC);
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["value setzen", "ausgeben", "Ende"]);
    expect(doc.querySelectorAll("rect")).toHaveLength(3);
    expect(doc.querySelectorAll("path[marker-end]")).toHaveLength(2);
  });

  it("a graphic with another edge set is another drawing: the DOM follows the source", () => {
    const doc = svgOf("flowchart LR\n  A[value setzen] --> C[Ende]");
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["value setzen", "Ende"]);
    expect(doc.querySelectorAll("path[marker-end]")).toHaveLength(1);
  });

  it("the preview inserts that SVG into the Tutor DOM and nothing for a rejected source", async () => {
    const subject = tutorResponseSchema.parse({ provider: "kiconnect", model: "m", question: FIRST, mermaid: GRAPHIC });
    const view = render(<MermaidPreview source={GRAPHIC} subject={subject} />);
    await waitFor(() => expect(view.container.querySelector("svg")).not.toBeNull());
    expect(within(view.container).getByTestId("tutor-mermaid")).toHaveTextContent("ausgeben");
    view.rerender(<MermaidPreview source={"flowchart LR\n  A --> B\n  click A callback"} subject={subject} />);
    await waitFor(() => expect(view.container.querySelector("svg")).toBeNull());
    expect(screen.queryByTestId("tutor-mermaid")).toBeNull();
  });
});

describe("GQ-03: the renderer gives the server's fixed reason where both reject", () => {
  it.each([
    ["unsupported diagram type", "pie title Anteile\n  \"a\": 1", "diagram-type-unsupported"],
    ["forbidden directive", "flowchart LR\n  A --> B\n  click A callback", "directive-disallowed"],
    ["markup", "flowchart LR\n  A[<b>x</b>] --> B", "markup-disallowed"],
    ["external content", "flowchart LR\n  A[https://example.org] --> B", "external-content-disallowed"],
    ["empty source", "", "empty"],
  ] as const)("%s: server rule and renderer name the same reason", (_name, source, reason) => {
    expect(checkTutorMermaid(source)).toBe(reason);
    expect(renderMermaidDiagram(source, "contract-marker")).toEqual({ status: "rejected", reason });
  });

  it("a safe but unsupported structure is refused by the renderer alone, with its own fixed reason", () => {
    const source = "flowchart LR\n  A --> B\n  B -.-> C";
    expect(checkTutorMermaid(source)).toBeNull(); // the server's coarse check lets it through
    expect(renderMermaidDiagram(source, "contract-marker")).toEqual({ status: "rejected", reason: "syntax-unsupported" });
  });

  it("an unterminated subgraph is accepted by the server rule, and the renderer refuses it rather than inventing a drawing", () => {
    const source = "flowchart LR\n  A --> B\n  subgraph S\n  A";
    expect(checkTutorMermaid(source)).toBeNull();
    expect(renderMermaidDiagram(source, "contract-marker")).toEqual({ status: "rejected", reason: "syntax-unsupported" });
  });
});

describe("GQ-04: a held follow-up question and its graphic appear together, once, after Weiter", () => {
  function support(handle: string): TutorSupportState {
    return {
      session: "11111111-1111-4111-8111-111111111111", questionHandle: handle, answerAttempts: 0, clarifications: 0,
      canRevealReference: false, canSkip: false, referenceAvailable: false, referenceShown: false, outcome: "open",
    };
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function server() {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(url);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url === "/api/config") return json({ tutor: { provider: "kiconnect" } });
      if (url === "/api/tutor/models") return json({ models: ["m"] });
      if (url === "/api/tutor/question") return json({ provider: "kiconnect", model: "m", question: FIRST, support: support(HANDLE_A) });
      if (url === "/api/tutor/dialog") {
        expect(body.answer).toBe("value speichert 3.");
        return json({ responseStyle: "normal", provider: "kiconnect", model: "m", question: NEXT, feedback: "Richtig.", answerRating: 4, learnerInput: "answer", mermaid: GRAPHIC, support: support(HANDLE_B) });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    return { calls };
  }

  it("keeps the next question and its graphic invisible until Weiter; the answered question shows no graphic of the next one", async () => {
    localStorage.setItem("unoDebugMode", "1");
    const events: Array<{ stage: string; outcome: string; reason?: string }> = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    document.addEventListener("tutor-diagnostic", listener);
    try {
      const { calls } = server();
      function Harness() {
        return <TutorWorkspacePlaceholder code={SKETCH} tutor={useTutor()} />;
      }
      render(<Harness />);
      fireEvent.click(await screen.findByTestId("tutor-setup-action"));
      fireEvent.change(await screen.findByLabelText("API-Key", { selector: "input" }), { target: { value: "personal-key" } });
      fireEvent.click(screen.getByTestId("tutor-apply-key"));
      fireEvent.click(await screen.findByTestId("tutor-start-question"));
      fireEvent.change(await screen.findByLabelText("Deine Antwort oder Rückfrage"), { target: { value: "value speichert 3." } });
      fireEvent.click(screen.getByTestId("tutor-send-answer"));

      const next = await screen.findByTestId("tutor-continue");
      // Held: the answered question stays, neither the next question nor its graphic is shown or reported as displayed.
      expect(screen.getByTestId("tutor-question")).toHaveTextContent(FIRST);
      expect(screen.queryByTestId("tutor-mermaid")).toBeNull();
      expect(document.body.textContent).not.toContain(NEXT);
      expect(events.some((event) => event.outcome === "displayed")).toBe(false);

      fireEvent.click(next);
      await waitFor(() => expect(screen.getByTestId("tutor-question")).toHaveTextContent(NEXT));
      await waitFor(() => expect(screen.getByTestId("tutor-mermaid")).toHaveTextContent("ausgeben"));
      expect(screen.getByTestId("tutor-mermaid").querySelectorAll("path[marker-end]")).toHaveLength(2);
      // Counted once: one `displayed` for the delivery, none from re-rendering.
      await waitFor(() => expect(events.filter((event) => event.stage === "browser" && event.outcome === "displayed")).toHaveLength(1));
      expect(events.filter((event) => event.outcome === "rendered")).toHaveLength(1);
      expect(calls.filter((url) => url === "/api/tutor/dialog")).toHaveLength(1);
      expect(calls.filter((url) => url === "/api/tutor/question")).toHaveLength(1);
    } finally {
      document.removeEventListener("tutor-diagnostic", listener);
    }
  });
});
