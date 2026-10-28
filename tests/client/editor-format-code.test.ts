import { describe, expect, it } from "vitest";
import { formatCode } from "../../client/src/lib/editor/format-code";
import { arduinoLanguageConfiguration } from "../../client/src/lib/editor/arduino-language-configuration";

describe("formatCode", () => {
  it("indents nested blocks by two spaces and puts braces on their own lines", () => {
    const out = formatCode("void loop(){if(x){y();}}");
    expect(out).toBe("void loop(){\n  if(x){\n    y();\n  }\n}\n");
  });

  it("re-indents badly indented code and normalises CRLF", () => {
    const out = formatCode("void setup() {\r\n        Serial.begin(9600);\r\n   }\r\n");
    expect(out).toBe("void setup() {\n  Serial.begin(9600);\n}\n");
  });

  it("collapses runs of blank lines and ends with exactly one newline", () => {
    expect(formatCode("int a;\n\n\n\n\nint b;")).toBe("int a;\n\nint b;\n");
    expect(formatCode("int a;\n")).toBe("int a;\n");
  });

  it("is idempotent", () => {
    const once = formatCode("void setup(){\nSerial.begin(9600);\n}\nvoid loop(){\nif(a){\nb();\n}\n}");
    expect(formatCode(once)).toBe(once);
  });
});

describe("arduinoLanguageConfiguration", () => {
  it("declares the brackets that make Enter indent and outdent", () => {
    expect(arduinoLanguageConfiguration.brackets).toEqual([
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ]);
  });

  it("closes brackets and quotes, but not quotes inside strings or comments", () => {
    const pairs = arduinoLanguageConfiguration.autoClosingPairs ?? [];
    expect(pairs).toEqual(expect.arrayContaining([{ open: "{", close: "}" }, { open: "(", close: ")" }]));
    expect(pairs.find((pair) => pair.open === '"')?.notIn).toEqual(["string", "comment"]);
  });
});
