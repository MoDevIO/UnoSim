import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCode } from "../../client/src/lib/editor/format-code";
import { tokenizeCpp } from "../../client/src/lib/editor/cpp-lexer";
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

  it("indents the statement of a brace-less if and else inside loop() (SSOT CodeFormatting 3.1)", () => {
    const input = [
      "void loop() {",
      "  int eingabe = Serial.parseInt();",
      "  if (eingabe == zahl)",
      "  Serial.println(\"Zahl gefunden\");",
      "  else",
      "  Serial.println(\"Falsche Zahl\");",
      "}",
      "",
    ].join("\n");
    expect(formatCode(input)).toBe([
      "void loop() {",
      "  int eingabe = Serial.parseInt();",
      "  if (eingabe == zahl)",
      "    Serial.println(\"Zahl gefunden\");",
      "  else",
      "    Serial.println(\"Falsche Zahl\");",
      "}",
      "",
    ].join("\n"));
  });

  it("indents every brace-less control statement, nested ones one level more each (3.1)", () => {
    expect(formatCode(lines(
      "void loop() {",
      "for (int i = 0; i < 3; i++)",
      "while (i > 0)",
      "i--;",
      "after();",
      "}",
    ))).toBe(lines(
      "void loop() {",
      "  for (int i = 0; i < 3; i++)",
      "    while (i > 0)",
      "      i--;",
      "  after();",
      "}",
    ));
  });

  it("keeps an else with the if it belongs to in C++, not with the nearest line (3.1)", () => {
    expect(formatCode(lines(
      "void loop() {",
      "if (a)",
      "if (b)",
      "x();",
      "else",
      "y();",
      "else",
      "z();",
      "w();",
      "}",
    ))).toBe(lines(
      "void loop() {",
      "  if (a)",
      "    if (b)",
      "      x();",
      "    else",
      "      y();",
      "  else",
      "    z();",
      "  w();",
      "}",
    ));
  });

  it("puts an else if chain on one level, brace-less and braced branches alike (3.1)", () => {
    expect(formatCode(lines(
      "void loop() {",
      "if (a) x();",
      "else if (b)",
      "y();",
      "else if (c) {",
      "z();",
      "} else",
      "q();",
      "done();",
      "}",
    ))).toBe(lines(
      "void loop() {",
      "  if (a) x();",
      "  else if (b)",
      "    y();",
      "  else if (c) {",
      "    z();",
      "  } else",
      "    q();",
      "  done();",
      "}",
    ));
  });

  it("puts the while of a do on the level of the do, with and without braces (3.1)", () => {
    expect(formatCode(lines(
      "void loop() {",
      "do",
      "x++;",
      "while (x < 10);",
      "do {",
      "y++;",
      "} while (y < 3);",
      "if (z)",
      "do",
      "z--;",
      "while (z);",
      "after();",
      "}",
    ))).toBe(lines(
      "void loop() {",
      "  do",
      "    x++;",
      "  while (x < 10);",
      "  do {",
      "    y++;",
      "  } while (y < 3);",
      "  if (z)",
      "    do",
      "      z--;",
      "    while (z);",
      "  after();",
      "}",
    ));
  });

  it("indents a multi-line condition as a continuation and a comment before the statement with it (3.1)", () => {
    expect(formatCode(lines(
      "void loop() {",
      "if (temperatur > grenze &&",
      "luefter == AUS)",
      "// zu warm: Luefter an",
      "digitalWrite(LUEFTER, HIGH);",
      "// weiter",
      "else",
      "digitalWrite(LUEFTER, LOW);",
      "messen();",
      "}",
    ))).toBe(lines(
      "void loop() {",
      "  if (temperatur > grenze &&",
      "      luefter == AUS)",
      "    // zu warm: Luefter an",
      "    digitalWrite(LUEFTER, HIGH);",
      "  // weiter",
      "  else",
      "    digitalWrite(LUEFTER, LOW);",
      "  messen();",
      "}",
    ));
  });

  it("indents case labels under switch and their statements one level deeper (3.1)", () => {
    expect(formatCode("void loop() {\nswitch (x) {\ncase 1:\na();\nbreak;\ndefault:\nb();\n}\n}\n")).toBe(lines(
      "void loop() {",
      "  switch (x) {",
      "    case 1:",
      "      a();",
      "      break;",
      "    default:",
      "      b();",
      "  }",
      "}",
    ));
  });

  it("leaves initializer braces in place and indents their continuation lines (3.1, 3.2)", () => {
    expect(formatCode(lines("int a[] = {1, 2,", "3};", "int b[2][2] = {{1, 2}, {3, 4}};", "P p = {", "1,", "2", "};"))).toBe(lines(
      "int a[] = {1, 2,",
      "  3};",
      "int b[2][2] = {{1, 2}, {3, 4}};",
      "P p = {",
      "  1,",
      "  2",
      "};",
    ));
  });

  it("treats braces, semicolons and keywords in strings, characters, raw strings, comments and directives as text (3.3)", () => {
    const input = lines(
      "const char* s = \"{ if (x) ; } else {\";",
      "char c = '{';",
      "const char* r = R\"x(",
      "  if (a) {",
      "    }",
      ")x\";",
      "// } else {",
      "/* {",
      "   { */",
      "#define BLOCK(x) do { x; } while (0)",
      "#define MULTI \\",
      "  {",
      "void setup() {",
      "Serial.println(\"}\");",
      "if (c == '}')",
      "Serial.println(\"if (\");",
      "}",
    );
    expect(formatCode(input)).toBe(lines(
      "const char* s = \"{ if (x) ; } else {\";",
      "char c = '{';",
      "const char* r = R\"x(",
      "  if (a) {",
      "    }",
      ")x\";",
      "// } else {",
      "/* {",
      "   { */",
      "#define BLOCK(x) do { x; } while (0)",
      "#define MULTI \\",
      "  {",
      "void setup() {",
      "  Serial.println(\"}\");",
      "  if (c == '}')",
      "    Serial.println(\"if (\");",
      "}",
    ));
  });

  it("keeps raw strings byte for byte, blank lines and trailing blanks included (3.3)", () => {
    const raw = "R\"(\n  a  \n\n\n\n}\n)\"";
    expect(formatCode(`void f() {\nconst char* t = ${raw};\n}`)).toBe(`void f() {\n  const char* t = ${raw};\n}\n`);
  });

  it("moves the continuation lines of a block comment with its first line (3.3)", () => {
    expect(formatCode("void f() {\n/* eins\n   zwei */\nx();\n}")).toBe("void f() {\n  /* eins\n     zwei */\n  x();\n}\n");
  });

  it("formats incomplete code without losing text (3.4)", () => {
    for (const input of ["void loop() {\nif (a)\nx(", "void f() {\n\"offen\nx();\n}", "}}\nx();", "/* offen\nif (a) {"]) {
      expect(meaning(formatCode(input))).toEqual(meaning(input));
    }
  });

  // Review of 322eba6da: expectations written out by hand, independent of the lexer under test.
  describe("reads the source as the compiler does (translation phases 2–4)", () => {
    it("protects a directive after a comment at the start of its line (F1)", () => {
      const input = "/* comment */ #define F() { int a = 1; }\nint main(){F(); return 0;}\n";
      expect(formatCode(input)).toBe("/* comment */ #define F() { int a = 1; }\nint main(){\n  F(); return 0;\n}\n");
    });

    it("keeps a raw string whose delimiter contains a quote byte for byte (F2)", () => {
      const raw = 'R"q"(a\n{payload}\n)q""';
      const input = `void f(){\nconst char* s = ${raw};\n}\n`;
      const output = formatCode(input);
      expect(output).toBe(`void f(){\n  const char* s = ${raw};\n}\n`);
      expect(output.split(raw)).toHaveLength(2);
    });

    it("keeps a raw string inside a directive byte for byte", () => {
      const input = '#define S R"x(a\n{payload}\n)x"\nvoid f() {\nx();\n}\n';
      expect(formatCode(input)).toBe('#define S R"x(a\n{payload}\n)x"\nvoid f() {\n  x();\n}\n');
    });

    it("continues a string across a backslash-newline: an escaped backslash is no escape there (F3)", () => {
      // Physically `"a\\` + newline: the second backslash and the newline splice, so the string goes on.
      const input = 'const char* s = "a\\\\\n"{payload}";\nint main(){return 0;}\n';
      expect(formatCode(input)).toBe('const char* s = "a\\\\\n"{payload}";\nint main(){\n  return 0;\n}\n');
    });

    it("joins `/` backslash-newline `/` into a line comment and leaves the comment alone (F3)", () => {
      const input = "int main(){int x=0; /\\\n/ if(1){ x=1; }\nreturn x;}\n";
      expect(formatCode(input)).toBe("int main(){\n  int x=0; /\\\n/ if(1){ x=1; }\n  return x;\n}\n");
    });

    it("continues a line comment and a directive across a backslash-newline, braces inside included", () => {
      const input = "void f() {\n// eins \\\n{ zwei\nx();\n#define G(a) \\\n{ a; }\n}\n";
      expect(formatCode(input)).toBe("void f() {\n  // eins \\\n{ zwei\n  x();\n  #define G(a) \\\n{ a; }\n}\n");
    });

    it("never re-indents the continuation line of a spliced token", () => {
      const input = "void f() {\nint lang\\\nername = 1;\n}\n";
      expect(formatCode(input)).toBe("void f() {\n  int lang\\\nername = 1;\n}\n");
    });
  });

  it("puts a block right after a case label on the label's level (review H1)", () => {
    const input = "void f() {\nswitch (x) {\ncase 1: {\na();\nbreak;\n}\ndefault: {\nb();\n}\n}\n}\n";
    expect(formatCode(input)).toBe(lines(
      "void f() {",
      "  switch (x) {",
      "    case 1: {",
      "      a();",
      "      break;",
      "    }",
      "    default: {",
      "      b();",
      "    }",
      "  }",
      "}",
    ));
  });

  it("is idempotent on an open comment or raw string at the end, adding no line end each time (review H2)", () => {
    for (const [input, once] of [["/* offen", "/* offen\n"], ['x = R"(offen', 'x = R"(offen\n'], ["// zu\\", "// zu\\\n"]]) {
      expect(formatCode(input!)).toBe(once);
      expect(formatCode(once!)).toBe(once);
    }
  });

  it("normalises lone carriage returns as line ends", () => {
    expect(formatCode("void f() {\rx();\r}")).toBe("void f() {\n  x();\n}\n");
  });

  it("is idempotent", () => {
    const once = formatCode("void setup(){\nSerial.begin(9600);\n}\nvoid loop(){\nif(a){\nb();\n}\n}");
    expect(formatCode(once)).toBe(once);
  });
});

function lines(...text: string[]): string {
  return `${text.join("\n")}\n`;
}

/** Code without layout: tokens without blanks and line breaks; comment text without its spacing. */
function meaning(code: string): string[] {
  return tokenizeCpp(code.replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .filter((token) => token.kind !== "space" && token.kind !== "newline")
    .map((token) => (token.kind === "blockComment" || token.kind === "lineComment" ? token.text.replaceAll(/\s+/g, " ").trim() : token.text.trimEnd()));
}

function sketches(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sketches(full);
    return entry.endsWith(".ino") ? [full] : [];
  });
}

// A corpus regression with the formatter's own lexer: it catches lost or added characters and non-idempotence, but
// shares the lexer's view of what is text. Independent evidence: tests/integration/format-code-compiler.test.ts.
describe("formatCode on every sketch in the repository (SSOT CodeFormatting 3.4)", () => {
  const files = ["public/examples", "tests/fixtures", "packages/avr-emulator", "evals/tutor-quality/fixtures"]
    .flatMap((directory) => sketches(path.join(process.cwd(), directory)));

  it("finds the sketches", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("keeps their meaning, adds or drops no character outside layout, and is idempotent", () => {
    const problems: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const once = formatCode(source);
      if (once.replaceAll(/\s+/g, "") !== source.replaceAll(/\s+/g, "")) problems.push(`${file}: characters changed`);
      if (JSON.stringify(meaning(once)) !== JSON.stringify(meaning(source))) problems.push(`${file}: tokens changed`);
      if (formatCode(once) !== once) problems.push(`${file}: not idempotent`);
    }
    expect(problems).toEqual([]);
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
