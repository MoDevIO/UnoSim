import { describe, expect, it } from "vitest";
import { findUnsafeIncludes } from "../../../../server/services/compiler/include-guard";

const BACKSLASH = String.fromCodePoint(92);
const SKETCH_TAIL = "\nvoid setup(){}\nvoid loop(){}\n";

function scan(main: string, files: Record<string, string> = {}) {
  return findUnsafeIncludes({ entryFile: "sketch.ino", files: { "sketch.ino": main, ...files } });
}

describe("include guard", () => {
  it.each([
    ["absolute quoted include", '#include "/etc/passwd"'],
    ["absolute angled include", "#include </etc/passwd>"],
    ["quoted include leaving the project", '#include "../secret.h"'],
    ["angled include with a parent segment", "#include <../../etc/passwd>"],
    ["include_next", '#include_next "/etc/hosts"'],
    ["import", '#import "/etc/hosts"'],
    ["digraph directive", '%:include "/etc/hosts"'],
    ["spaces and comments around the directive", '  # /* x */ include /* y */ "/etc/hosts"'],
    ["a comment before the directive", '/* c */ #include "/etc/hosts"'],
    ["a line splice inside the directive name", `#inc${BACKSLASH}\nlude "/etc/hosts"`],
    ["a computed include", '#define P "/etc/hosts"\n#include P'],
    ["an escaped directive name", String.raw`#incl\u0075de "x.h"`],
    ["__has_include with an absolute path", '#if __has_include("/etc/hosts")\n#endif'],
    ["__has_include with a computed operand", "#if __has_include(P)\n#endif"],
    ["a backslash path", String.raw`#include "..\x.h"`],
  ])("rejects %s", (_label, source) => {
    expect(scan(source + SKETCH_TAIL)).not.toHaveLength(0);
  });

  it("rejects an unsafe include inside a submitted header file", () => {
    expect(scan('#include "lib.h"' + SKETCH_TAIL, { "lib.h": '#include "/etc/hosts"\n' })).toEqual([
      expect.objectContaining({ file: "lib.h", line: 1 }),
    ]);
  });

  it("reports the line of the first physical line of a directive", () => {
    expect(scan('int a;\n\n#include "/etc/hosts"' + SKETCH_TAIL)).toEqual([
      expect.objectContaining({ file: "sketch.ino", line: 3 }),
    ]);
  });

  it.each([
    ["library include", "#include <Servo.h>"],
    ["core include", '#include "Arduino.h"'],
    ["nested library include", "#include <avr/pgmspace.h>"],
    ["project subdirectory include", '#include "src/config.h"'],
    ["text that only mentions an include", String.raw`void f(){ Serial.println("use #include \"/etc/x\""); }`],
    ["a line comment", '// #include "/etc/hosts"'],
    ["other directives", "#define LED 13\n#pragma once\n#if 1\n#endif"],
  ])("accepts %s", (_label, source) => {
    expect(scan(source + SKETCH_TAIL)).toEqual([]);
  });

  it("accepts a parent include that stays inside the project", () => {
    expect(scan('#include "src/a.h"' + SKETCH_TAIL, { "src/a.h": '#include "../config.h"\n', "config.h": "" })).toEqual([]);
  });
});
