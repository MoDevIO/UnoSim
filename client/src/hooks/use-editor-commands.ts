import { useCallback } from "react";
import type { RefObject } from "react";
import type { ToastFn } from "@/hooks/use-toast";

/**
 * Monaco Editor imperative API surface exposed via ref forwarding.
 * Provides direct access to editor commands and state operations.
 * Methods are optional since the actual ref implementation may only expose a subset.
 */
interface EditorAPI {
  undo?: () => void;
  redo?: () => void;
  find?: () => void;
  selectAll?: () => void;
  copy?: () => void;
  cut?: () => void;
  paste?: () => void;
  goToLine?: (lineNumber: number) => void;
  getValue?: () => string;
  insertSuggestionSmartly?: (suggestion: string, line?: number) => void;
  formatCode?: () => void;
}

interface EditorCommandsOptions {
  toast?: ToastFn;
  suppressAutoStopOnce?: () => void;
  code?: string;
  setCode?: React.Dispatch<React.SetStateAction<string>>;
}

interface EditorCommandsAPI {
  undo: () => void;
  redo: () => void;
  find: () => void;
  selectAll: () => void;

  copy: () => void;
  cut: () => void;
  paste: () => void;
  goToLine: () => void;

  insertSuggestion: (suggestion: string, line?: number) => void;

  // always provided (may no-op if formatting not possible)
  formatCode: () => void;
}

export function useEditorCommands(
  editorRef: RefObject<EditorAPI>,
  opts: EditorCommandsOptions = {},
): EditorCommandsAPI {
  const { toast, suppressAutoStopOnce, code, setCode } = opts;

  const runCmd = useCallback(
    (cmd: "undo" | "redo" | "find" | "selectAll") => {
      const ed = editorRef.current;
      if (!ed) {
        toast?.({ title: "No active editor", description: "Open the main editor first." });
        return;
      }
      if (typeof ed[cmd] === "function") {
        try {
          ed[cmd]();
        } catch (err) {
          console.error("Editor command failed", err);
        }
      } else {
        toast?.({ title: "Command not available", description: `Editor does not support ${cmd}.` });
      }
    },
    [editorRef, toast],
  );

  const copy = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || typeof ed.copy !== "function") {
      toast?.({ title: "Command not available", description: "Copy not supported." });
      return;
    }
    try {
      ed.copy();
    } catch (err) {
      console.error("Copy failed", err);
    }
  }, [editorRef, toast]);

  const cut = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || typeof ed.cut !== "function") {
      toast?.({ title: "Command not available", description: "Cut not supported." });
      return;
    }
    try {
      ed.cut();
    } catch (err) {
      console.error("Cut failed", err);
    }
  }, [editorRef, toast]);

  const paste = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || typeof ed.paste !== "function") {
      toast?.({ title: "Command not available", description: "Paste not supported." });
      return;
    }
    try {
      ed.paste();
    } catch (err) {
      console.error("Paste failed", err);
    }
  }, [editorRef, toast]);

  const goToLine = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || typeof ed.goToLine !== "function") {
      toast?.({ title: "Command not available", description: "Go to line not supported." });
      return;
    }
    const input = prompt("Go to line number:");
    if (!input) return;
    const num = Number(input);
    if (!Number.isFinite(num) || num <= 0) {
      toast?.({ title: "Invalid line number", description: "Please enter a positive number." });
      return;
    }
    try {
      ed.goToLine(num);
    } catch (err) {
      console.error("Go to line failed", err);
    }
  }, [editorRef, toast]);

  const insertSuggestion = useCallback(
    (suggestion: string, line?: number) => {
      const ed = editorRef.current;
      if (!ed || typeof ed.insertSuggestionSmartly !== "function") {
        console.error("insertSuggestionSmartly method not available on editor");
        return;
      }
      suppressAutoStopOnce?.();
      try {
        ed.insertSuggestionSmartly(suggestion, line);
        toast?.({ title: "Suggestion inserted", description: "Code added" });
      } catch (err) {
        console.error(err);
      }
    },
    [editorRef, toast, suppressAutoStopOnce],
  );

  // One formatter for the editor and for this fallback (SSOT CodeFormatting 3.4). The fallback loads it on use,
  // so it stays off the page's initial path.
  const formatCode = useCallback(() => {
    const ed = editorRef.current;
    if (ed && typeof ed.formatCode === "function") {
      try {
        ed.formatCode();
        toast?.({ title: "Code Formatted", description: "Code has been automatically formatted" });
        return;
      } catch (err) {
        console.error("Format code failed", err);
      }
    }
    if (typeof code !== "string" || !setCode) return;
    import("@/lib/editor/format-code")
      .then(({ formatCode: format }) => {
        setCode(format(code));
        toast?.({ title: "Code Formatted", description: "Code has been automatically formatted" });
      })
      .catch((err: unknown) => console.error("Format code failed", err));
  }, [code, setCode, toast, editorRef]);

  return {
    undo: () => runCmd("undo"),
    redo: () => runCmd("redo"),
    find: () => runCmd("find"),
    selectAll: () => runCmd("selectAll"),
    copy,
    cut,
    paste,
    goToLine,
    insertSuggestion,
    formatCode,
  };
}
