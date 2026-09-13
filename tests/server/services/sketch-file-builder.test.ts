import { describe, it, expect } from "vitest";
import {
  extractForwardDeclarations,
  SketchFileBuilder,
} from "../../../server/services/sketch-file-builder";
import { readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function buildSketch(code: string): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "sfb-test-"));
  const builder = new SketchFileBuilder(tmpDir);
  const { sketchFile } = await builder.build(code, "test-sketch");
  return readFile(sketchFile, "utf8");
}

async function buildProjectSketch(
  code: string,
  entryFile: string,
  headers: Array<{ name: string; content: string }>,
): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "sfb-project-test-"));
  const builder = new SketchFileBuilder(tmpDir);
  const { sketchFile } = await builder.build(code, "test-project", headers, entryFile);
  return readFile(sketchFile, "utf8");
}

describe("SketchFileBuilder", () => {

  it("resolves nested logical entry includes before writing the physical sketch", async () => {
    const content = await buildProjectSketch(
      '#include "../shared/pins.h"\nvoid setup() {}\nvoid loop() {}',
      "src/main.ino",
      [{ name: "shared/pins.h", content: "pinMode(5, OUTPUT);" }],
    );

    expect(content).toContain("pinMode(5, OUTPUT);");
    expect(content).not.toContain('#include "../shared/pins.h"');
  });

  it("resolves parent-relative includes from deeper entry paths", async () => {
    const content = await buildProjectSketch(
      '#include "../../shared/pins.h"\nvoid setup() {}\nvoid loop() {}',
      "src/app/main.ino",
      [{ name: "shared/pins.h", content: "digitalWrite(5, HIGH);" }],
    );

    expect(content).toContain("digitalWrite(5, HIGH);");
    expect(content).not.toContain('#include "../../shared/pins.h"');
  });

  it("expands controller and pins headers in include order", async () => {
    const content = await buildProjectSketch(
      '#include "controller.h"\nvoid setup() { setupController(); }\nvoid loop() { runController(); }',
      "nested.ino",
      [
        {
          name: "controller.h",
          content: '#include "pins.h"\nvoid setupController() { pinMode(STATUS_LED, OUTPUT); }\nvoid runController() { digitalWrite(STATUS_LED, HIGH); }',
        },
        { name: "pins.h", content: "const int STATUS_LED = 6;" },
      ],
    );

    expect(content).toContain("const int STATUS_LED = 6;");
    expect(content).toContain("void setupController()");
    expect(content).toContain("void runController()");
    expect(content).not.toContain('#include "controller.h"');
    expect(content).not.toContain('#include "pins.h"');
  });

  it("exposes pure prototype extraction for simple declarations", () => {
    expect(extractForwardDeclarations("// int fake() {}\nint real() { return 1; }")).toBe(
      "int real();",
    );
  });

  it("extracts multiline, reference, pointer, and overloaded signatures", () => {
    const code = `
void setup() { use(1); use(1.0); }
void loop() {}
long
use(const int& value) { return value; }
long use(double* value) { return static_cast<long>(*value); }
`;
    expect(extractForwardDeclarations(code)).toContain("long use(const int& value);");
    expect(extractForwardDeclarations(code)).toContain("long use(double* value);");
  });

  describe("forward declarations (Arduino IDE compatibility)", () => {
    it("adds a forward declaration for a helper function called before its definition", async () => {
      const code = `
void setup() { helper(); }
void loop() {}
void helper() {}
`.trim();
      const content = await buildSketch(code);
      // Forward decl must appear BEFORE the user-code section
      const fwdIdx = content.indexOf("void helper();");
      const userIdx = content.indexOf("// --- User code follows ---");
      expect(fwdIdx).toBeGreaterThan(-1);
      expect(fwdIdx).toBeLessThan(userIdx);
    });

    it("does not add forward declarations for setup() and loop()", async () => {
      const code = `void setup() {}\nvoid loop() {}`;
      const content = await buildSketch(code);
      expect(content).not.toContain("void setup();");
      expect(content).not.toContain("void loop();");
    });

    it("handles multi-word return types like unsigned long", async () => {
      const code = `
void setup() { unsigned long t = getTime(); }
void loop() {}
unsigned long getTime() { return 0; }
`.trim();
      const content = await buildSketch(code);
      expect(content).toContain("unsigned long getTime();");
    });

    it("handles pointer return types", async () => {
      const code = `
void setup() { char* s = getLabel(); }
void loop() {}
char* getLabel() { return nullptr; }
`.trim();
      const content = await buildSketch(code);
      expect(content).toContain("char* getLabel();");
    });

    it("adds a prototype with parameters and preserves the return type", async () => {
      const code = `
void setup() { int result = add(2, 3); }
void loop() {}
int add(int left, int right) { return left + right; }
`.trim();
      const content = await buildSketch(code);
      const declaration = "int add(int left, int right);";
      const declarationIndex = content.indexOf(declaration);
      const userCodeIndex = content.indexOf("// --- User code follows ---");
      expect(declarationIndex).toBeGreaterThan(-1);
      expect(declarationIndex).toBeLessThan(userCodeIndex);
    });

    it("does not duplicate declarations for overloaded or repeated function names", async () => {
      const code = `
void setup() { blink(3); }
void loop() {}
void blink(int n) {}
`.trim();
      const content = await buildSketch(code);
      const count = (content.match(/void blink\(/g) ?? []).length;
      // Exactly 2: the forward decl and the definition
      expect(count).toBe(2);
    });

    it("produces no forward section when there are no extra functions", async () => {
      const code = `void setup() {}\nvoid loop() {}`;
      const content = await buildSketch(code);
      expect(content).not.toContain("Forward declarations");
    });
  });
});
