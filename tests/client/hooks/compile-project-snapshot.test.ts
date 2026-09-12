import { describe, expect, it } from "vitest";
import { buildSourceProject } from "../../../client/src/lib/source-project";
import { buildCompileCommand } from "../../../client/src/hooks/compile-command-builder";

describe("compile command from the client SourceProject", () => {
  it("uses current active-header content and preserves the entry", () => {
    const project = buildSourceProject([
      { id: "main", name: "main.ino", content: '#include "led.h"' },
      { id: "header", name: "led.h", content: "digitalWrite(4, HIGH);" },
    ], "header", "pinMode(4, OUTPUT);\ndigitalWrite(4, HIGH);");

    expect(buildCompileCommand(project!)).toEqual({
      code: '#include "led.h"',
      headers: [{ name: "led.h", content: "pinMode(4, OUTPUT);\ndigitalWrite(4, HIGH);" }],
    });
  });

  it("uses current active-ino content and leaves inactive files unchanged", () => {
    const project = buildSourceProject([
      { id: "main", name: "main.ino", content: "old main" },
      { id: "header", name: "led.h", content: "header" },
    ], "main", "new main");

    expect(buildCompileCommand(project!)).toEqual({
      code: "new main",
      headers: [{ name: "led.h", content: "header" }],
    });
  });

  it("retains nested paths in the existing header contract", () => {
    expect(buildCompileCommand({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "drivers/led.h"',
        "drivers/led.h": "digitalWrite(4, HIGH);",
      },
    })).toEqual({
      code: '#include "drivers/led.h"',
      headers: [{ name: "drivers/led.h", content: "digitalWrite(4, HIGH);" }],
    });
  });

  it("produces the same compile snapshot regardless of the selected tab", () => {
    const tabs = [
      { id: "main", name: "main.ino", content: '#include "led.h"' },
      { id: "header", name: "led.h", content: "pinMode(4, OUTPUT);" },
    ];

    const mainSnapshot = buildCompileCommand(
      buildSourceProject(tabs, "main", tabs[0].content)!,
    );
    const headerSnapshot = buildCompileCommand(
      buildSourceProject(tabs, "header", tabs[1].content)!,
    );

    expect(headerSnapshot).toEqual(mainSnapshot);
  });

  it("keeps the single-file compile contract unchanged", () => {
    const project = buildSourceProject([
      { id: "main", name: "sketch.ino", content: "void setup() {}" },
    ], "main", "void setup() {}");

    expect(buildCompileCommand(project!)).toEqual({
      code: "void setup() {}",
      headers: [],
    });
  });
});
