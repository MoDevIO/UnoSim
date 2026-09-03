import { describe, expect, it } from "vitest";
import { buildCompileCommand } from "../../../client/src/hooks/compile-command-builder";

describe("compile command builder", () => {
  it("keeps the main sketch separate and maps header tabs", () => {
    expect(buildCompileCommand("void setup(){}", [
      { name: "sketch.ino", content: "ignored" },
      { name: "pins.h", content: "#define LED 13" },
    ])).toEqual({ code: "void setup(){}", headers: [{ name: "pins.h", content: "#define LED 13" }] });
  });
});
