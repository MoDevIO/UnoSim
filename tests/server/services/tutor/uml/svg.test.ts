import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { validateTutorUmlSvg } from "../../../../../server/services/tutor/uml/svg";

const valid =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="150px" viewBox="0 0 200 150" data-diagram-type="ACTIVITY"><rect x="1" y="1" width="150" height="50" rx="12"/><text x="10" y="25" font-family="DejaVu Sans" font-size="14">digitalWrite(LED, HIGH)</text></svg>';
describe("checked UML SVG output", () => {
  it("preserves visible code and geometry while using a browser font fallback", () => {
    const image = validateTutorUmlSvg(valid, "activity");
    expect(image).toMatchObject({ width: 200, height: 150 });
    expect(image.svg).toContain("digitalWrite(LED, HIGH)");
    expect(image.svg).toContain('font-family="sans-serif"');
  });
  it.each([
    valid.replace("<rect", "<script>alert(1)</script><rect"),
    valid.replace("<rect", "<foreignObject/><rect"),
    valid.replace("<rect", '<image href="https://example.invalid/x"/><rect'),
    valid.replace("<rect", '<animate attributeName="x"/><rect'),
    valid.replace('rx="12"', 'rx="12" onload="alert(1)"'),
    valid.replace(
      'rx="12"',
      'rx="12" style="fill:url(https://example.invalid/x)"',
    ),
    '<?xml-stylesheet href="https://example.invalid/x"?>' + valid,
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]>' + valid,
    valid.replace("200px", "2401px"),
    valid.replace("150px", "4001px"),
    valid.replace("ACTIVITY", "ERROR"),
    valid.replace("</svg>", ""),
    valid.replace('rx="12"', 'fill="URL(//example.invalid/paint.svg#paint)"'),
    valid.replace('rx="12"', 'fill="uRl( //example.invalid/paint.svg#paint )"'),
    valid.replace('rx="12"', String.raw`fill="u\72l(//example.invalid/x)"`),
    valid.replace('font-size="14"', 'font-size="14" style="font-size:1px"'),
    valid.replace('font-size="14"', 'font-size="14" transform="scale(0.01)"'),
    valid.replace(
      'data-diagram-type="ACTIVITY"',
      'data-diagram-type="ACTIVITY" style="width:1px;height:1px"',
    ),
  ])("rejects active/invalid/oversized renderer output", (svg) => {
    expect(() => validateTutorUmlSvg(svg, "activity")).toThrow(
      "render-output-invalid",
    );
  });
  it("rejects excessive bytes before parsing", () => {
    expect(() =>
      validateTutorUmlSvg(" ".repeat(512 * 1024 + 1), "activity"),
    ).toThrow();
  });
  it.each(["activity", "class", "sequence"] as const)(
    "accepts actual pinned %s renderer output",
    async (kind) => {
      const svg = await readFile(`docs/examples/tutor-uml/${kind}.svg`, "utf8");
      const image = validateTutorUmlSvg(svg, kind);
      expect(image.width).toBeGreaterThan(50);
      expect(image.height).toBeGreaterThan(50);
      expect(image.svg).not.toContain("SRC=");
    },
  );
});
