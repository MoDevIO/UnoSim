import { describe, expect, it } from "vitest";
import { buildSourceProject } from "../../client/src/lib/source-project";
import {
  parseStaticIORegistry,
  parseStaticIORegistryProject,
} from "../../shared/io-registry-parser";

const tabs = [
  { id: "main", name: "main.ino", content: '#include "led_controller.h"' },
  { id: "header", name: "led_controller.h", content: "digitalWrite(4, HIGH);" },
  { id: "unused", name: "unused.h", content: "digitalWrite(9, HIGH);" },
];

describe("client SourceProject snapshot", () => {
  it("uses current editor code for the active ino tab", () => {
    const snapshot = buildSourceProject(tabs, "main", "#include \"led_controller.h\"\npinMode(4, OUTPUT);");

    expect(snapshot).toEqual({
      entryFile: "main.ino",
      files: {
        "main.ino": '#include "led_controller.h"\npinMode(4, OUTPUT);',
        "led_controller.h": "digitalWrite(4, HIGH);",
        "unused.h": "digitalWrite(9, HIGH);",
      },
    });
  });

  it("uses current editor code for an active header without changing entry", () => {
    const snapshot = buildSourceProject(tabs, "header", "pinMode(4, OUTPUT);\ndigitalWrite(4, HIGH);");

    expect(snapshot?.entryFile).toBe("main.ino");
    expect(snapshot?.files["led_controller.h"]).toContain("pinMode(4, OUTPUT)");
  });

  it("keeps the analysis independent of the active tab", () => {
    const mainActive = buildSourceProject(tabs, "main", tabs[0].content);
    const headerActive = buildSourceProject(tabs, "header", tabs[1].content);

    expect(mainActive).toEqual(headerActive);
    expect(parseStaticIORegistryProject(mainActive!).map(({ pinId }) => pinId)).toEqual([4]);
    expect(parseStaticIORegistryProject(headerActive!).map(({ pinId }) => pinId)).toEqual([4]);
  });

  it("characterizes the previous active-text bug", () => {
    expect(parseStaticIORegistry(tabs[0].content)).toEqual([]);
    expect(parseStaticIORegistry(tabs[1].content).map(({ pinId }) => pinId)).toEqual([4]);
  });

  it("does not silently choose a header as entry", () => {
    expect(buildSourceProject([
      { id: "header", name: "only.h", content: "digitalWrite(4, HIGH);" },
    ], "header", "digitalWrite(5, HIGH);" )).toBeNull();
  });

  it("updates an included header in the registry without loading files again", () => {
    const before = buildSourceProject(tabs, "main", tabs[0].content);
    const changedTabs = tabs.map((tab) =>
      tab.id === "header" ? { ...tab, content: "pinMode(7, OUTPUT);" } : tab,
    );
    const after = buildSourceProject(changedTabs, "main", changedTabs[0].content);

    expect(parseStaticIORegistryProject(before!).map(({ pinId }) => pinId)).toEqual([4]);
    expect(parseStaticIORegistryProject(after!).map(({ pinId }) => pinId)).toEqual([7]);
  });

  it("keeps a single-file sketch on the existing analysis path", () => {
    const snapshot = buildSourceProject([
      { id: "main", name: "sketch.ino", content: "analogRead(A0);" },
    ], "main", "analogRead(A0);");

    expect(snapshot).toEqual({
      entryFile: "sketch.ino",
      files: { "sketch.ino": "analogRead(A0);" },
    });
    expect(parseStaticIORegistryProject(snapshot!).map(({ pinId }) => pinId)).toEqual([14]);
  });

  it("rejects duplicate project paths instead of dropping a tab", () => {
    expect(buildSourceProject([
      { id: "main", name: "main.ino", content: "" },
      { id: "a", name: "io.h", content: "" },
      { id: "b", name: "IO.H", content: "" },
    ], "main", "")).toBeNull();
  });
});
