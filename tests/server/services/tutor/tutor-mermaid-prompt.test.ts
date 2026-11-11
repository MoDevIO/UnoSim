import { describe, expect, it } from "vitest";
import { renderMermaidDiagram } from "../../../../client/src/lib/tutor-mermaid";
import { checkTutorMermaid } from "../../../../shared/tutor-mermaid-rules";
import { TUTOR_MERMAID_EXAMPLE, TUTOR_SYSTEM_PROMPT } from "../../../../server/services/tutor/tutor-service";
import { TUTOR_SUPPORT_GUIDANCE_TEXT } from "../../../../server/services/tutor/learning-support";

/**
 * The prompt tells the model when a graphic helps and which syntax to use. What it allows must be drawn in
 * full by the local renderer, and what it forbids must be rejected, so that prompt and renderer cannot drift.
 */
const render = (source: string) => renderMermaidDiagram(source, "prompt-marker");

describe("Tutor graphic guidance in the system prompt", () => {
  it("shows an example that passes the shared rules and renders completely", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain(JSON.stringify(TUTOR_MERMAID_EXAMPLE));
    expect(checkTutorMermaid(TUTOR_MERMAID_EXAMPLE)).toBeNull();
    const result = render(TUTOR_MERMAID_EXAMPLE);
    expect(result.status).toBe("rendered");
    const svg = result.status === "rendered" ? result.svg : "";
    for (const label of ["Start", "Aus", "An", "Taster gedrückt", "Taster losgelassen"]) expect(svg).toContain(label);
  });

  it("names when a graphic helps and when it is left out", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain("Füge mermaid hinzu, wenn die Frage einen Ablauf");
    expect(TUTOR_SYSTEM_PROMPT).toContain("Lass mermaid weg bei einfachen Faktenfragen");
    expect(TUTOR_SYSTEM_PROMPT).toContain("verrät nicht die gesuchte Antwort");
  });

  it.each([
    ["nodes and edges", "flowchart TD\n  A[Start] --> B[Ende]"],
    ["graph header", "graph LR\n  A[Start] --> B[Ende]"],
    ["pipe edge label", "flowchart LR\n  A[Taster] -->|gedrückt| B[LED an]"],
    ["shorthand edge label", "flowchart LR\n  A[Taster] -- gedrückt --> B[LED an]"],
    ["state transition label", "stateDiagram-v2\n  Aus --> An : Taster gedrückt"],
    ["sequence message", "sequenceDiagram\n  Sketch->>Serial: Wert ausgeben"],
  ])("renders the allowed form: %s", (_form, source) => {
    expect(render(source).status).toBe("rendered");
  });

  it.each([
    ["subgraph", "flowchart LR\n  subgraph Teil\n  A --> B\n  end"],
    ["dashed edge", "flowchart LR\n  A -.-> B"],
    ["loop block", "sequenceDiagram\n  loop Jede Sekunde\n  A->>B: Wert\n  end"],
    ["style", "flowchart LR\n  A --> B\n  style A fill:#f00"],
    ["classDef", "flowchart LR\n  A --> B\n  classDef hot fill:#f00"],
    ["click", "flowchart LR\n  A --> B\n  click A callback"],
  ])("rejects the forbidden form: %s", (form, source) => {
    expect(TUTOR_SYSTEM_PROMPT).toContain(form === "dashed edge" ? "gestrichelte Kanten" : form.replace(" block", ""));
    expect(render(source).status).toBe("rejected");
  });

  it("keeps graphics out of hints and clarifications, which deliver text only", () => {
    expect(TUTOR_SUPPORT_GUIDANCE_TEXT.format).toContain("answerRating und mermaid fehlen");
  });
});
