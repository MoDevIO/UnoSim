import { describe, expect, it } from "vitest";
import {
  insertForwardDeclarations,
  planForwardDeclarations,
  stripDefaultArguments,
} from "../../../server/services/sketch-prototypes";

describe("sketch prototypes", () => {
  it("keeps a parameter list without default arguments unchanged", () => {
    expect(stripDefaultArguments("(int  left,int right)")).toBe("(int  left,int right)");
  });

  it("removes default arguments, including strings that contain commas or equals signs", () => {
    expect(stripDefaultArguments('(const char *sep = ", =", byte n = 2, int last)')).toBe(
      "(const char *sep, byte n, int last)",
    );
  });

  it("ignores functions that only appear in comments", () => {
    const plan = planForwardDeclarations("/* int fake() { } */\nvoid setup() {}\nint real() { return 1; }");
    expect(plan.declarations).toBe("int real();");
  });

  it("plans the insertion before the first function the sketch itself defines", () => {
    const code = "void header() {}\nconst int M = 2;\nvoid setup() {}\nvoid helper(int a[M]) {}";
    const plan = planForwardDeclarations(code, (lineIndex) => lineIndex >= 1);
    expect(plan.insertAt).toBe(code.indexOf("void setup()"));
    expect(plan.declarations).toBe("void header();\nvoid helper(int a[M]);");
  });

  it("returns code without function definitions unchanged", () => {
    expect(insertForwardDeclarations("const int M = 2;\n")).toBe("const int M = 2;\n");
  });
});
