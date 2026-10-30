import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLibraries, type UseProjectLibrariesParams } from "@/hooks/use-project-libraries";
import type { OfferedLibraryPackage } from "@shared/libraries";

const aunit: OfferedLibraryPackage = {
  name: "AUnit",
  version: "1.7.1",
  description: "Unit tests",
  author: "Brian T. Park",
  license: "MIT",
  documentationUrl: "https://github.com/bxparks/AUnit/tree/v1.7.1",
  headers: ["AUnit.h", "AUnitVerbose.h"],
  includes: ["AUnit.h"],
  dependencies: [],
  sha256: "a".repeat(64),
  examples: [],
  compatibility: { compile: [], runtime: [{ board: "uno", runtime: "host-mock", status: "unsupported", reason: "No libraries." }] },
  available: true,
};
const AUNIT = { name: "AUnit", version: "1.7.1" };
const SKETCH = "void setup() {}\nvoid loop() {}\n";

function serve(body: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, json: async () => body } as Response);
}

function setup(overrides: Partial<UseProjectLibrariesParams> = {}) {
  const editor = { value: SKETCH, replaceContent: vi.fn((text: string) => { editor.value = text; }) };
  const toast = vi.fn(() => ({ id: "t", dismiss: vi.fn(), update: vi.fn() }));
  const setIsModified = vi.fn();
  const initial: UseProjectLibrariesParams = {
    board: "uno",
    runtime: "browser",
    offeredRuntimes: ["browser", "host-mock"],
    tabs: [{ id: "main", name: "sketch.ino", content: SKETCH }],
    activeTabId: "main",
    code: SKETCH,
    editorRef: { current: { getValue: () => editor.value, replaceContent: editor.replaceContent } },
    setIsModified,
    toast: toast as never,
    ...overrides,
  };
  const hook = renderHook((props: UseProjectLibrariesParams) => useProjectLibraries(props), { initialProps: initial });
  return { hook, editor, toast, setIsModified, initial };
}

const undoOf = (toast: ReturnType<typeof vi.fn>) => (toast.mock.calls.at(-1)![0] as { action?: ReactElement<{ onClick: () => void }> }).action;

describe("useProjectLibraries (SSOT Libraries §5–§7)", () => {
  beforeEach(() => serve({ schemaVersion: 1, packages: [aunit] }));
  afterEach(() => vi.restoreAllMocks());

  it("loads the offered catalog and states loading, ready and error apart", async () => {
    const { hook } = setup();
    expect(hook.result.current.catalog.status).toBe("loading");
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));
    expect(hook.result.current.catalog.packages.map((entry) => entry.name)).toEqual(["AUnit"]);

    serve({}, false);
    await act(() => hook.result.current.catalog.retry());
    expect(hook.result.current.catalog.status).toBe("error");
  });

  it("Einbinden adds the exact version and the include in one undoable action", async () => {
    const { hook, editor, toast, setIsModified } = setup();
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));

    let included = false;
    act(() => { included = hook.result.current.include(aunit); });

    expect(included).toBe(true);
    expect(hook.result.current.libraries).toEqual([AUNIT]);
    expect(editor.replaceContent).toHaveBeenCalledWith(`#include <AUnit.h>\n\n${SKETCH}`);
    expect(setIsModified).toHaveBeenCalledWith(true);
    expect(toast.mock.calls.at(-1)![0]).toMatchObject({ title: "AUnit 1.7.1 eingebunden", description: "Include in sketch.ino ergänzt." });
  });

  it("Rückgängig takes back include and new dependency while nothing changed since", async () => {
    const { hook, editor, toast, initial } = setup();
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));
    act(() => hook.result.current.include(aunit));
    hook.rerender({ ...initial, code: editor.value });

    act(() => undoOf(toast)!.props.onClick());

    expect(hook.result.current.libraries).toEqual([]);
    expect(editor.replaceContent).toHaveBeenLastCalledWith(SKETCH);
  });

  it("offers no Rückgängig after a later edit and overwrites nothing", async () => {
    const { hook, editor, toast, initial } = setup();
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));
    act(() => hook.result.current.include(aunit));
    const undo = undoOf(toast)!;
    editor.value = `${editor.value}// more\n`;
    hook.rerender({ ...initial, code: editor.value });

    act(() => undo.props.onClick());

    expect(hook.result.current.libraries).toEqual([AUNIT]);
    expect(editor.replaceContent).toHaveBeenCalledTimes(1);
  });

  it("keeps a package that was selected before when undoing an include", async () => {
    const { hook, editor, toast, initial } = setup();
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));
    act(() => hook.result.current.addRequirement(AUNIT));
    hook.rerender({ ...initial });
    act(() => hook.result.current.include(aunit));
    hook.rerender({ ...initial, code: editor.value });

    act(() => undoOf(toast)!.props.onClick());

    expect(hook.result.current.libraries).toEqual([AUNIT]);
    expect(editor.replaceContent).toHaveBeenLastCalledWith(SKETCH);
  });

  it("does not include into a file that cannot take it", async () => {
    const { hook, editor, toast } = setup({ activeTabId: undefined as never });
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));

    let included = true;
    act(() => { included = hook.result.current.include(aunit); });

    expect(included).toBe(false);
    expect(hook.result.current.libraries).toEqual([]);
    expect(editor.replaceContent).not.toHaveBeenCalled();
    expect(toast.mock.calls.at(-1)![0]).toMatchObject({ variant: "destructive" });
  });

  it("hints at a written include and adds the package without touching the source", async () => {
    const code = `#include <AUnit.h>\n${SKETCH}`;
    const { hook, editor } = setup({ code, tabs: [{ id: "main", name: "sketch.ino", content: code }] });
    await waitFor(() => expect(hook.result.current.hints).toHaveLength(1));

    act(() => hook.result.current.addRequirement(hook.result.current.hints[0].candidates[0]));

    expect(hook.result.current.libraries).toEqual([AUNIT]);
    expect(editor.replaceContent).not.toHaveBeenCalled();
  });

  it("blocks starting in an engine the selection does not support", async () => {
    const { hook } = setup({ runtime: "host-mock" });
    await waitFor(() => expect(hook.result.current.catalog.status).toBe("ready"));
    act(() => hook.result.current.addRequirement(AUNIT));

    expect(hook.result.current.startBlockReason()).toMatch(/does not run in the Legacy engine/);
  });
});
