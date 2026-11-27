import { describe, expect, it } from "vitest";
import { readUmlSources } from "../../../../../server/services/tutor/uml/source";

const SKETCH = '#include "mat_func.h"\n\nvoid setup() {\n  printMatrix();\n}\n\nvoid loop() {}\n';
const BODY = "const int M = 3;\n\nvoid printMatrix() {}\n";
const read = (header: string, code = SKETCH) =>
  readUmlSources({ question: "Warum?", code, entryFile: "main.ino", board: "uno", headers: { "mat_func.h": header } });

describe("preprocessing the UML evidence accepts", () => {
  it.each([
    ["#pragma once", `#pragma once\n\n${BODY}`],
    ["#pragma once after a file comment", `// Matrixfunktionen\n#pragma once\n${BODY}`],
    ["an include guard", `#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n\n${BODY}\n#endif\n`],
    ["an include guard with comments around it", `/* Kopf */\n#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n${BODY}#endif // MAT_FUNC_H\n`],
    ["an include guard with block comments in its directives", `#ifndef MAT_FUNC_H /* Kopf */\n#define MAT_FUNC_H\n${BODY}#endif /* MAT_FUNC_H */\n`],
    ["an include guard around a sent include", `#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n#include "mat_func.h"\n${BODY}#endif\n`],
  ])("%s in a header", (_name, header) => {
    expect(read(header)?.map(({ file }) => file)).toEqual(["mat_func.h", "main.ino"]);
  });
});

describe("a quoted include", () => {
  const sources = (entryFile: string, header: string) =>
    readUmlSources({ question: "Warum?", code: SKETCH, entryFile, board: "uno", headers: { [header]: `#pragma once\n${BODY}` } });
  it("finds the header next to a sketch in a folder", () => {
    expect(sources("examples/IT11/main.ino", "examples/IT11/mat_func.h")).not.toBeNull();
  });
  it("does not find a header of the same name in another folder", () => {
    expect(sources("examples/IT11/main.ino", "examples/IT10/mat_func.h")).toBeNull();
    expect(sources("examples/IT11/main.ino", "mat_func.h")).toBeNull();
  });
});

describe("preprocessing the UML evidence still rejects", () => {
  it.each([
    ["#pragma once in the sketch itself", `#pragma once\n${SKETCH}`, BODY],
    ["another pragma", SKETCH, `#pragma pack(1)\n${BODY}`],
    ["a guard whose #define names another macro", SKETCH, `#ifndef MAT_FUNC_H\n#define OTHER_H\n${BODY}#endif\n`],
    ["a guard whose #define gives a value", SKETCH, `#ifndef MAT_FUNC_H\n#define MAT_FUNC_H 1\n${BODY}#endif\n`],
    ["code after the guard", SKETCH, `#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n${BODY}#endif\nint extra = 1;\n`],
    ["code before the guard", SKETCH, `int extra = 1;\n#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n${BODY}#endif\n`],
    ["a further conditional inside the guard", SKETCH, `#ifndef MAT_FUNC_H\n#define MAT_FUNC_H\n#ifdef DEBUG\n${BODY}#endif\n#endif\n`],
    ["a guard in the sketch itself", `#ifndef MAIN\n#define MAIN\n${SKETCH}#endif\n`, BODY],
    ["a value macro", SKETCH, `#define M 3\n${BODY}`],
  ])("%s", (_name, code, header) => {
    expect(read(header, code)).toBeNull();
  });
});
