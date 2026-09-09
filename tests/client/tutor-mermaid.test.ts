import { describe, expect, it } from "vitest";
import { renderMermaidSubset } from "@/lib/tutor-mermaid";

describe("local Tutor Mermaid renderer", () => {
  it("renders the supported flowchart subset as escaped SVG", () => {
    const svg = renderMermaidSubset("flowchart LR\nA[Input] -->|Next| B[Output]", "diagram-1");

    expect(svg).toContain("<svg");
    expect(svg).toContain("Input");
    expect(svg).toContain("Output");
    expect(svg).toContain("marker-end=\"url(#diagram-1)\"");
    expect(svg).toContain('aria-label="Mermaid diagram"');
    expect(svg).toContain('stroke="var(--background)"');
    expect(renderMermaidSubset("flowchart LR\nA[<script>] --> B", "diagram-2")).toBeNull();
  });

  it("keeps linear nodes separated and supports vertical flow direction", () => {
    const svg = renderMermaidSubset(
      "flowchart LR\nA[Start] --> B[Normal]\nB --> C[Umkehr]",
      "diagram-linear",
    );
    const verticalSvg = renderMermaidSubset(
      "flowchart TD\nA[Start] --> B[Normal]",
      "diagram-vertical",
    );

    expect(svg).toContain('width="120"');
    expect(svg).toContain("Start");
    expect(svg).toContain("Normal");
    expect(svg).toContain("Umkehr");
    expect(verticalSvg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("renders a sequence diagram and drops unsupported syntax", () => {
    expect(renderMermaidSubset("sequenceDiagram\nA->>B: Frage", "diagram-3")).toContain("Frage");
    expect(renderMermaidSubset("pie\n\"A\": 1", "diagram-4")).toBeNull();
  });
});
