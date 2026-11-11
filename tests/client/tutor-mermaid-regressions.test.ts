import { describe, expect, it } from "vitest";
import { renderMermaidDiagram, renderMermaidSubset } from "@/lib/tutor-mermaid";
import { checkTutorMermaid, TUTOR_MERMAID_MAX_CHARS } from "@shared/tutor-mermaid-rules";

function diagram(source: string): Document {
  const svg = renderMermaidSubset(source, "regression-marker");
  expect(svg, "the supported graphic must render").not.toBeNull();
  return new DOMParser().parseFromString(svg!, "image/svg+xml");
}

describe("Tutor graphic regressions", () => {
  it("parses compact edges without consuming the arrow as part of a node name", () => {
    const doc = diagram("flowchart LR\nA-->B-->C");
    expect(doc.querySelectorAll("path[marker-end]")).toHaveLength(2);
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["A", "B", "C"]);
  });
  it("preserves every node and connection in a chained flow", () => {
    const doc = diagram("flowchart LR\nA --> B --> C");
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["A", "B", "C"]);
    expect(doc.querySelectorAll("path[marker-end]")).toHaveLength(2);
  });

  it("keeps the labels of state transitions", () => {
    const doc = diagram("stateDiagram-v2\nAus --> An : Taster gedrückt");
    expect(doc.documentElement.textContent).toContain("Taster gedrückt");
    expect(doc.querySelectorAll("rect")).toHaveLength(2);
  });

  it("treats shorthand edge text as a label rather than a third node", () => {
    const doc = diagram("flowchart LR\nA -- ja --> B");
    expect(doc.querySelectorAll("rect")).toHaveLength(2);
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toEqual(["ja", "A", "B"]);
  });

  it("allows a click label while rejecting an actual interaction instruction", () => {
    expect(diagram("flowchart LR\nA -->|click| B").documentElement.textContent).toContain("click");
    expect(renderMermaidSubset("flowchart LR\nA --> B\nclick A callback", "x")).toBeNull();
  });

  it("escapes comparison labels while rejecting actual markup", () => {
    const doc = diagram("flowchart LR\nA{x<b && c>d} --> B[Ende]");
    expect(doc.documentElement.textContent).toContain("x<b && c>d");
    expect(doc.querySelector("b")).toBeNull();
    expect(renderMermaidSubset("flowchart LR\nA[<script>alert(1)</script>] --> B", "x")).toBeNull();
    expect(renderMermaidSubset("flowchart LR\nA[<img src=x onerror=alert(1)>] --> B", "x")).toBeNull();
  });

  it("rejects the whole diagram when unsupported syntax would lose meaning", () => {
    expect(renderMermaidSubset("flowchart LR\nA --> B\nB -.-> C", "x")).toBeNull();
    expect(renderMermaidSubset("sequenceDiagram\nA->>B: Frage\nloop Wiederholen\nB->>A: Antwort\nend", "x")).toBeNull();
  });

  it.each(["RL", "BT"])("honors the reverse %s direction", (direction) => {
    const doc = diagram(`flowchart ${direction}\nA --> B`);
    const positions = [...doc.querySelectorAll("text")].map((node) => Number(node.getAttribute(direction === "RL" ? "x" : "y")));
    expect(positions[0]).toBeGreaterThan(positions[1]);
  });

  it("keeps every shorthand label in a chain and rejects an empty one", () => {
    const doc = diagram("flowchart LR\nA -- ja --> B -- nein --> C");
    expect(doc.querySelectorAll("rect")).toHaveLength(3);
    expect(doc.documentElement.textContent).toContain("ja");
    expect(doc.documentElement.textContent).toContain("nein");
    expect(renderMermaidDiagram("flowchart LR\nA --  --> B", "m")).toEqual({ status: "rejected", reason: "syntax-unsupported" });
  });
});

describe("Tutor graphic rule cost", () => {
  // Before the fix, 12,000 blank lines took about 90 ms per check on a developer machine: quadratic backtracking.
  it("checks a maximum-length run of blank lines in linear time", () => {
    const source = `flowchart LR\n${"\n".repeat(TUTOR_MERMAID_MAX_CHARS - 20)}`;
    const started = performance.now();
    expect(checkTutorMermaid(source)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });

  it.each([
    ["after a CRLF line break", "flowchart LR\r\n  A --> B\r\n\t click A callback"],
    ["after a statement separator", "flowchart LR\n  A --> B; classDef hot fill:#f00"],
    ["after blank lines", "flowchart LR\n\n\n   linkStyle 0 stroke:#f00"],
  ])("still rejects a directive %s", (_case, source) => {
    expect(checkTutorMermaid(source)).toBe("directive-disallowed");
  });

  it("rejects an unclosed shorthand label on a maximum-length line without rendering", () => {
    const line = `A -- ${"x ".repeat((TUTOR_MERMAID_MAX_CHARS - 40) / 2)}B`;
    expect(renderMermaidDiagram(`flowchart LR\n${line}`, "m")).toEqual({ status: "rejected", reason: "syntax-unsupported" });
  });
});
