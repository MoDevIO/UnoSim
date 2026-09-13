import { describe, expect, it } from "vitest";
import {
  resolveSourceProject,
  validateSourceProject,
  type SourceProject,
} from "../../shared/source-project";

const project = (files: Record<string, string>, entryFile = "main.ino"): SourceProject => ({
  entryFile,
  files,
});

describe("source project validation and include resolution", () => {
  it("resolves an entry file without includes", () => {
    const result = resolveSourceProject(project({ "main.ino": "pinMode(4, OUTPUT);" }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino"]);
    expect(result.source).toBe("pinMode(4, OUTPUT);");
    expect(result.lineOrigins).toEqual([{ file: "main.ino", line: 1 }]);
  });

  it("expands a local header in deterministic depth-first order", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "led.h"\npinMode(4, OUTPUT);',
      "led.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.reachableFiles).toEqual(["main.ino", "led.h"]);
    expect(result.source).toContain("digitalWrite(4, HIGH);");
    expect(result.lineOrigins).toContainEqual({ file: "led.h", line: 1 });
  });

  it("preserves original provenance through nested includes", () => {
    const result = resolveSourceProject(project({
      "main.ino": [
        '#include "a.h"',
        "",
        "digitalWrite(9, HIGH);",
      ].join("\n"),
      "a.h": [
        "// header preamble",
        '#include "sub/b.h"',
        "pinMode(4, OUTPUT);",
      ].join("\n"),
      "sub/b.h": [
        "",
        "",
        "",
        "",
        "",
        "",
        "digitalRead(4);",
      ].join("\n"),
    }));

    expect(result.lineOrigins.length).toBe(result.source.split("\n").length);
    expect(result.lineOrigins).toEqual([
      { file: "a.h", line: 1 },
      { file: "sub/b.h", line: 1 },
      { file: "sub/b.h", line: 2 },
      { file: "sub/b.h", line: 3 },
      { file: "sub/b.h", line: 4 },
      { file: "sub/b.h", line: 5 },
      { file: "sub/b.h", line: 6 },
      { file: "sub/b.h", line: 7 },
      { file: "a.h", line: 3 },
      { file: "main.ino", line: 2 },
      { file: "main.ino", line: 3 },
    ]);
  });

  it("resolves nested includes relative to the including file", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "drivers/led.h"',
      "drivers/led.h": '#include "../shared/pins.h"\ndigitalWrite(4, HIGH);',
      "shared/pins.h": "#define LED_PIN 4",
    }));

    expect(result.reachableFiles).toEqual([
      "main.ino",
      "drivers/led.h",
      "shared/pins.h",
    ]);
    expect(result.complete).toBe(true);
  });

  it("does not analyze files that are not reachable from the entry", () => {
    const result = resolveSourceProject(project({
      "main.ino": "void setup() {}",
      "unused.h": "digitalWrite(9, HIGH);",
    }));

    expect(result.reachableFiles).toEqual(["main.ino"]);
    expect(result.source).not.toContain("digitalWrite");
  });

  it("preserves system includes without resolving them as project files", () => {
    const result = resolveSourceProject(project({
      "main.ino": "#include <Arduino.h>\npinMode(4, OUTPUT);",
      "Arduino.h": "digitalWrite(9, HIGH);",
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino"]);
    expect(result.source).toContain("#include <Arduino.h>");
  });

  it("expands a duplicate include only once", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "pins.h"\n#include "pins.h"',
      "pins.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.reachableFiles).toEqual(["main.ino", "pins.h"]);
    expect(result.source.match(/digitalWrite/g)).toHaveLength(1);
  });

  it("terminates an include cycle deterministically", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "a.h"',
      "a.h": '#include "b.h"\ndigitalWrite(4, HIGH);',
      "b.h": '#include "a.h"\ndigitalWrite(5, HIGH);',
    }));

    expect(result.complete).toBe(false);
    expect(result.reachableFiles).toEqual(["main.ino", "a.h", "b.h"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain("INCLUDE_CYCLE");
  });

  it("honors recognized include guards in a mutual cycle", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "a.h"',
      "a.h": [
        "#ifndef A_H",
        "#define A_H",
        '#include "b.h"',
        "digitalWrite(4, HIGH);",
        "#endif",
      ].join("\n"),
      "b.h": [
        "#ifndef B_H",
        "#define B_H",
        '#include "a.h"',
        "digitalWrite(5, HIGH);",
        "#endif",
      ].join("\n"),
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino", "a.h", "b.h"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports missing local includes and marks the result incomplete", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "missing.h"\npinMode(4, OUTPUT);',
    }));

    expect(result.complete).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "MISSING_LOCAL_INCLUDE",
      file: "main.ino",
      line: 1,
      include: "missing.h",
    }));
  });

  it("keeps same basenames distinct by directory", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "one/pins.h"\n#include "two/pins.h"',
      "one/pins.h": "digitalWrite(4, HIGH);",
      "two/pins.h": "digitalWrite(5, HIGH);",
    }));

    expect(result.reachableFiles).toEqual(["main.ino", "one/pins.h", "two/pins.h"]);
  });

  it("allows a relative parent include within the project root", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "nested/entry.h"',
      "nested/entry.h": '#include "../pins.h"',
      "pins.h": "pinMode(4, OUTPUT);",
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toContain("pins.h");
  });

  it("rejects paths that escape the project root", () => {
    const result = validateSourceProject(project({
      "main.ino": '#include "../escape.h"',
      "../escape.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_PATH" }),
    ]));
  });

  it("rejects empty path segments and case-fold collisions", () => {
    expect(validateSourceProject(project({
      "main.ino": "",
      "drivers//pins.h": "",
      "Drivers/pins.h": "",
    })).valid).toBe(false);
  });

  it("reports an include that escapes the project root", () => {
    const result = resolveSourceProject(project({
      "nested/main.ino": '#include "../../outside.h"',
    }, "nested/main.ino"));

    expect(result.complete).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "MISSING_LOCAL_INCLUDE",
      include: "../../outside.h",
    }));
  });

  it("does not mark a classic include guard incomplete", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "led_controller.h"\npinMode(4, OUTPUT);',
      "led_controller.h": [
        "#ifndef LED_CONTROLLER_H",
        "#define LED_CONTROLLER_H",
        '#include "pins.h"',
        "digitalWrite(4, HIGH);",
        "#endif",
      ].join("\n"),
      "pins.h": "#define LED_PIN 4",
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino", "led_controller.h", "pins.h"]);
  });

  it("recognizes guards after comments and blank lines", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "guarded.h"',
      "guarded.h": [
        "// comment",
        "",
        "#ifndef GUARDED_H",
        "#define GUARDED_H",
        '#include "nested.h"',
        "#endif // GUARDED_H",
      ].join("\n"),
      "nested.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino", "guarded.h", "nested.h"]);
  });

  it("does not accept trailing tokens on an include-guard endif", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "guarded.h"',
      "guarded.h": [
        "#ifndef GUARDED_H",
        "#define GUARDED_H",
        '#include "nested.h"',
        "#endif GUARDED_H",
      ].join("\n"),
      "nested.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.complete).toBe(false);
    expect(result.reachableFiles).toEqual(["main.ino", "guarded.h"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "UNSUPPORTED_CONDITIONAL_INCLUDE",
    );
  });

  it("does not mistake a similar conditional for an include guard", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "conditional.h"',
      "conditional.h": [
        "#ifndef FEATURE_X",
        '#include "nested.h"',
        "#endif",
      ].join("\n"),
      "nested.h": "digitalWrite(4, HIGH);",
    }));

    expect(result.complete).toBe(false);
    expect(result.reachableFiles).toEqual(["main.ino", "conditional.h"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "UNSUPPORTED_CONDITIONAL_INCLUDE",
    );
  });

  it("marks unknown conditional includes unsupported", () => {
    const result = resolveSourceProject(project({
      "main.ino": [
        "#if SOME_COMPLEX_EXPRESSION",
        '#include "a.h"',
        "#else",
        '#include "b.h"',
        "#endif",
      ].join("\n"),
      "a.h": "digitalWrite(4, HIGH);",
      "b.h": "digitalWrite(5, HIGH);",
    }));

    expect(result.complete).toBe(false);
    expect(result.reachableFiles).toEqual(["main.ino"]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "UNSUPPORTED_CONDITIONAL_INCLUDE",
    );
  });

  it("preserves both unknown conditional branches without selecting one", () => {
    const result = resolveSourceProject(project({
      "main.ino": [
        "#if FEATURE",
        "digitalWrite(4, HIGH);",
        "#else",
        "digitalWrite(5, HIGH);",
        "#endif",
      ].join("\n"),
    }));

    expect(result.complete).toBe(false);
    expect(result.source).toContain("digitalWrite(4, HIGH);");
    expect(result.source).toContain("digitalWrite(5, HIGH);");
  });

  it("normalizes safe relative include spellings", () => {
    const result = resolveSourceProject(project({
      "main.ino": '#include "./dir/../foo.h"\n#include "dir/../foo.h"',
      "foo.h": "pinMode(4, OUTPUT);",
    }));

    expect(result.complete).toBe(true);
    expect(result.reachableFiles).toEqual(["main.ino", "foo.h"]);
  });

  it("rejects unsafe include spellings", () => {
    for (const include of ["../../foo.h", "/foo.h", String.raw`dir\foo.h`, "a//b.h"]) {
      const result = resolveSourceProject(project({
        "main.ino": `#include "${include}"`,
      }));
      expect(result.complete, include).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "MISSING_LOCAL_INCLUDE",
        include,
      }));
    }
  });
});
