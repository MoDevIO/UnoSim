import { describe, it, expect } from "vitest";
import { SketchFileBuilder } from "../../../server/services/sketch-file-builder";
import { readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function buildSketch(code: string): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "sfb-test-"));
  const builder = new SketchFileBuilder(tmpDir);
  const { sketchFile } = await builder.build(code, "test-sketch");
  return readFile(sketchFile, "utf8");
}

describe("SketchFileBuilder", () => {

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
