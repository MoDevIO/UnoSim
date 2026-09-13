import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import { useSimulatorFileSystem } from "@/hooks/useSimulatorFileSystem";
import { buildSourceProject } from "@/lib/source-project";
import { buildCompileCommand } from "@/hooks/compile-command-builder";
import { resolveSourceProject } from "@shared/source-project";

type TestTab = {
  id: string;
  name: string;
  path?: string;
  content: string;
};

function useTestFileSystem(initialTabs: TestTab[], initialActiveTabId: string, initialCode: string) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialActiveTabId);
  const [code, setCode] = useState(initialCode);
  const [isModified, setIsModified] = useState(false);

  return useSimulatorFileSystem({
    code,
    setCode,
    isModified,
    setIsModified,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    initializeDefaultSketch: () => {},
    toast: () => {},
  });
}

describe("useSimulatorFileSystem tab content persistence", () => {
  it("keeps a renamed local header addressable in project and compile snapshots", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [
          {
            id: "ino",
            name: "sketch.ino",
            path: "sketch.ino",
            content: '#include "led_controller.h"',
          },
          {
            id: "header",
            name: "header_1.h",
            path: "header_1.h",
            content: "pinMode(4, OUTPUT);",
          },
        ],
        "ino",
        '#include "led_controller.h"',
      ),
    );

    act(() => result.current.handleTabRename("header", "led_controller.h"));

    const project = buildSourceProject(
      result.current.tabs,
      result.current.activeTabId,
      result.current.code,
    );
    expect(project?.files).toEqual({
      "sketch.ino": '#include "led_controller.h"',
      "led_controller.h": "pinMode(4, OUTPUT);",
    });
    expect(resolveSourceProject(project!).reachableFiles).toEqual([
      "sketch.ino",
      "led_controller.h",
    ]);
    expect(resolveSourceProject(project!).complete).toBe(true);
    expect(buildCompileCommand(project!)).toEqual({
      code: '#include "led_controller.h"',
      headers: [{ name: "led_controller.h", content: "pinMode(4, OUTPUT);" }],
      entryFile: "sketch.ino",
    });
  });

  it("keeps nested headers addressable after creating and renaming both tabs", () => {
    const sketch = `#include "controller.h"\n\nvoid setup() {\n  setupController();\n}\n\nvoid loop() {\n  runController();\n}`;
    const controller = `#include "pins.h"\n\nvoid setupController() {\n  pinMode(STATUS_LED, OUTPUT);\n  pinMode(AUX_LED, OUTPUT);\n}\n\nvoid runController() {\n  digitalWrite(STATUS_LED, HIGH);\n  digitalWrite(AUX_LED, LOW);\n}`;
    const pins = "const int STATUS_LED = 6;\nconst int AUX_LED = 7;";
    const { result } = renderHook(() =>
      useTestFileSystem(
        [{ id: "ino", name: "nested.ino", path: "nested.ino", content: sketch }],
        "ino",
        sketch,
      ),
    );

    act(() => result.current.handleTabAdd());
    act(() => result.current.setCode(controller));
    const controllerId = result.current.activeTabId!;
    act(() => result.current.handleTabRename(controllerId, "controller.h"));

    act(() => result.current.handleTabAdd());
    act(() => result.current.setCode(pins));
    const pinsId = result.current.activeTabId!;
    act(() => result.current.handleTabRename(pinsId, "pins.h"));
    act(() => result.current.handleTabClick("ino"));

    const project = buildSourceProject(result.current.tabs, result.current.activeTabId, result.current.code);
    expect(project).toEqual({
      entryFile: "nested.ino",
      files: {
        "nested.ino": sketch,
        "controller.h": controller,
        "pins.h": pins,
      },
    });
    const resolved = resolveSourceProject(project!);
    expect(resolved.reachableFiles).toEqual(["nested.ino", "controller.h", "pins.h"]);
    expect(resolved.complete).toBe(true);
    expect(buildCompileCommand(project!).headers.map(({ name }) => name)).toEqual([
      "controller.h",
      "pins.h",
    ]);
  });

  it("keeps edits when switching from an ino tab to a header and back", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [
          { id: "ino", name: "main.ino", content: "old ino" },
          { id: "header", name: "led_controller.h", content: "header" },
        ],
        "ino",
        "old ino",
      ),
    );

    act(() => result.current.setCode("new ino"));
    act(() => result.current.handleTabClick("header"));
    act(() => result.current.handleTabClick("ino"));

    expect(result.current.code).toBe("new ino");
    expect(result.current.tabs.find((tab) => tab.id === "ino")?.content).toBe("new ino");
  });

  it("keeps edits when switching from a header tab to an ino and back", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [
          { id: "ino", name: "main.ino", content: "ino" },
          { id: "header", name: "led_controller.h", content: "old header" },
        ],
        "header",
        "old header",
      ),
    );

    act(() => result.current.setCode("new header"));
    act(() => result.current.handleTabClick("ino"));
    act(() => result.current.handleTabClick("header"));

    expect(result.current.code).toBe("new header");
    expect(result.current.tabs.find((tab) => tab.id === "header")?.content).toBe("new header");
  });

  it("persists edits before adding a new header tab", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [{ id: "ino", name: "main.ino", content: "old ino" }],
        "ino",
        "old ino",
      ),
    );

    act(() => result.current.setCode("new ino"));
    act(() => result.current.handleTabAdd());

    expect(result.current.tabs.find((tab) => tab.id === "ino")?.content).toBe("new ino");
    expect(result.current.code).toBe("");
  });

  it("preserves both tabs across multiple edits and switches", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [
          { id: "ino", name: "main.ino", content: "main old" },
          { id: "header", name: "pins.h", content: "header old" },
        ],
        "ino",
        "main old",
      ),
    );

    act(() => result.current.setCode("main new"));
    act(() => result.current.handleTabClick("header"));
    act(() => result.current.setCode("header new"));
    act(() => result.current.handleTabClick("ino"));
    act(() => result.current.handleTabClick("header"));

    expect(result.current.tabs.map((tab) => tab.content)).toEqual(["main new", "header new"]);
    expect(result.current.code).toBe("header new");
  });

  it("does not change content when switching without an edit", () => {
    const { result } = renderHook(() =>
      useTestFileSystem(
        [
          { id: "ino", name: "main.ino", content: "main" },
          { id: "header", name: "pins.h", content: "header" },
        ],
        "ino",
        "main",
      ),
    );

    act(() => result.current.handleTabClick("header"));
    act(() => result.current.handleTabClick("ino"));

    expect(result.current.tabs.map((tab) => tab.content)).toEqual(["main", "header"]);
    expect(result.current.code).toBe("main");
  });

  it("keeps loaded multi-file entry and header edits in project and compile snapshots", () => {
    const { result } = renderHook(() => useTestFileSystem([], "", ""));

    act(() =>
      result.current.handleFilesLoaded(
        [
          {
            name: "main.ino",
            path: "src/main.ino",
            content: '#include "../shared/pins.h"',
          },
          {
            name: "pins.h",
            path: "shared/pins.h",
            content: "pinMode(5, OUTPUT);",
          },
        ],
        true,
      ),
    );

    const entryId = result.current.activeTabId;
    expect(entryId).toBeTruthy();
    act(() => result.current.setCode('#include "../shared/pins.h"\ndigitalWrite(5, HIGH);'));
    act(() => result.current.handleTabClick(result.current.tabs[1].id));
    act(() => result.current.setCode("pinMode(7, OUTPUT);"));
    act(() => result.current.handleTabClick(entryId!));

    const project = buildSourceProject(result.current.tabs, result.current.activeTabId, result.current.code);
    expect(project).toEqual({
      entryFile: "src/main.ino",
      files: {
        "src/main.ino": '#include "../shared/pins.h"\ndigitalWrite(5, HIGH);',
        "shared/pins.h": "pinMode(7, OUTPUT);",
      },
    });
    expect(buildCompileCommand(project!)).toEqual({
      code: '#include "../shared/pins.h"\ndigitalWrite(5, HIGH);',
      headers: [{ name: "shared/pins.h", content: "pinMode(7, OUTPUT);" }],
      entryFile: "src/main.ino",
    });
  });

});
