import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useEditorCommands } from "../../../client/src/hooks/use-editor-commands";

// Review of 322eba6da, F4: the fallback loads the formatter on use; a sketch that changed while it loaded wins.
it("keeps a newer sketch when the fallback formatter finishes loading late", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = vi.fn();
  vi.doMock("@/lib/editor/format-code", async (importOriginal) => {
    started();
    await gate;
    return importOriginal();
  });
  const initial = "void loop() {\nif (a)\nold();\n}";
  const newer = "void loop() {\nnewer();\n}";
  const toast = vi.fn();
  const ref = { current: null };
  const { result } = renderHook(() => {
    const [code, setCode] = useState(initial);
    const commands = useEditorCommands(ref, { code, setCode, toast });
    return { code, setCode, ...commands };
  });
  act(() => result.current.formatCode());
  await waitFor(() => expect(started).toHaveBeenCalledOnce());
  act(() => result.current.setCode(newer));
  expect(result.current.code).toBe(newer);
  await act(async () => { release(); });
  await waitFor(() => expect(toast).toHaveBeenCalled());
  expect(result.current.code).toBe(newer);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Code not formatted" }));
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Code Formatted" }));
});
