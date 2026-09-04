import { useEffect, useRef } from "react";
// Import the editor API directly; the package root pulls every Monaco language.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { Logger } from "@shared/logger";

const logger = new Logger("CodeEditor");

/**
 * Find the location of `void functionName()` in source lines.
 * Returns 1-indexed startLine and openBraceLine, or -1 if not found.
 */
function findFunctionInLines(
  lines: string[],
  functionName: string,
): { startLine: number; openBraceLine: number } {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`void ${functionName}()`)) {
      const startLine = i + 1;
      let openBraceLine = startLine;
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].includes("{")) {
          openBraceLine = j + 1;
          break;
        }
      }
      return { startLine, openBraceLine };
    }
  }
  return { startLine: -1, openBraceLine: -1 };
}

/** Intentional no-op error handler - avoids anonymous function nesting in .catch() (S2004). */
const _ignoreErr = () => {};

// Formatting function
function formatCode(code: string): string {
  let formatted = code;

  // 1. Normalize line endings
  formatted = formatted.replaceAll('\r\n', '\n');

  // 2. Add newlines after opening braces
  formatted = formatted.replaceAll(/\{\s*/g, "{\n");

  // 3. Add newlines before closing braces
  formatted = formatted.replaceAll(/[ \t\n\r]*\}/g, "\n}"); // NOSONAR S2631

  // 4. Indent blocks (simple 2-space indentation)
  const lines = formatted.split("\n");
  let indentLevel = 0;
  const indentedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Decrease indent for closing braces
    if (trimmed.startsWith("}")) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indented = "  ".repeat(indentLevel) + trimmed;

    // Increase indent after opening braces
    if (trimmed.endsWith("{")) {
      indentLevel++;
    }

    return indented;
  });

  formatted = indentedLines.join("\n");

  // 5. Remove multiple consecutive blank lines
  formatted = formatted.replaceAll(/\n{3,}/g, "\n\n");

  // 6. Ensure newline at end of file
  if (!formatted.endsWith("\n")) {
    formatted += "\n";
  }

  return formatted;
}

function insertSuggestionAtLine(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  insertLine: number,
  text: string,
) {
  const indent = "  ";
  const range = {
    startLineNumber: insertLine,
    startColumn: model.getLineMaxColumn(insertLine),
    endLineNumber: insertLine,
    endColumn: model.getLineMaxColumn(insertLine),
  };

  editor.executeEdits("insertSuggestion", [{ range, text: "\n" + indent + text }]);
  editor.setPosition({
    lineNumber: insertLine + 1,
    column: indent.length + text.length + 1,
  });
  editor.revealPositionInCenter({
    lineNumber: insertLine + 1,
    column: 1,
  });
}

/**
 * Insert text at a specific line or at the current cursor position when line is undefined.
 * Extracted from CodeEditor.insertTextAtLine to reduce Cognitive Complexity (S3776).
 */
function insertTextAtLineInEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  line: number | undefined,
  text: string,
): void {
  if (line === undefined) {
    const pos = editor.getPosition();
    if (!pos) return;
    const endOfLine = model.getLineMaxColumn(pos.lineNumber);
    const range = {
      startLineNumber: pos.lineNumber,
      startColumn: endOfLine,
      endLineNumber: pos.lineNumber,
      endColumn: endOfLine,
    };
    editor.executeEdits("insertSuggestion", [{ range, text: "\n" + text }]);
    editor.setPosition({ lineNumber: pos.lineNumber + 1, column: text.length + 1 });
    editor.revealPositionInCenter({ lineNumber: pos.lineNumber + 1, column: 1 });
    return;
  }
  const targetLine = Math.min(Math.max(1, Math.floor(line)), model.getLineCount());
  const endOfLine = model.getLineMaxColumn(targetLine);
  const range = {
    startLineNumber: targetLine,
    startColumn: endOfLine,
    endLineNumber: targetLine,
    endColumn: endOfLine,
  };
  editor.executeEdits("insertSuggestion", [{ range, text: "\n" + text }]);
  editor.setPosition({ lineNumber: targetLine + 1, column: text.length + 1 });
  editor.revealPositionInCenter({ lineNumber: targetLine + 1, column: 1 });
}

/**
 * Determine where to insert a suggestion: inside setup() or loop(),
 * or at the current cursor if neither function is found.
 * Extracted to reduce Cognitive Complexity of insertSuggestionSmartly (S3776).
 */
function resolveSmartInsertLine(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  text: string,
): number {
  const lines = model.getValue().split("\n");
  const isSetupSuggestion =
    text.includes("Serial.begin") ||
    text.includes("pinMode") ||
    text.includes("void setup");
  const targetFunctionName = isSetupSuggestion ? "setup" : "loop";
  const { startLine: functionStartLine, openBraceLine: functionOpenBraceIndex } =
    findFunctionInLines(lines, targetFunctionName);
  if (functionStartLine === -1) {
    return editor.getPosition()?.lineNumber ?? 1;
  }
  return functionOpenBraceIndex > 0 ? functionOpenBraceIndex : functionStartLine;
}

/**
 * Handle paste action with clipboard read and insert.
 * Extracted to reduce nesting depth in paste callback (S2004).
 */
async function handlePasteAction(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel | null,
  sel: ReturnType<typeof editor.getSelection> | null,
): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    
    if (model && sel && !sel.isEmpty()) {
      editor.executeEdits("paste", [{ range: sel, text }]);
      return;
    }
    
    const pos = editor.getPosition();
    if (pos) {
      const range = {
        startLineNumber: pos.lineNumber,
        startColumn: pos.column,
        endLineNumber: pos.lineNumber,
        endColumn: pos.column,
      };
      editor.executeEdits("paste", [{ range, text }]);
    }
  } catch {
    // ignore clipboard read errors
  }
}


interface CodeEditorAPI {
  getValue: () => string;
  undo?: () => void;
  redo?: () => void;
  find?: () => void;
  selectAll?: () => void;
  copy?: () => void;
  cut?: () => void;
  paste?: () => void;
  goToLine?: (line: number) => void;
  insertSuggestionSmartly?: (suggestion: string, line?: number) => void;
  insertTextAtLine?: (line: number | undefined, text: string) => void;
  formatCode?: () => void;
}

interface CodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onCompileAndRun?: () => void;
  readonly onFormat?: () => void;
  readonly readOnly?: boolean;
  readonly editorRef?: React.MutableRefObject<CodeEditorAPI | null>;
}

export function CodeEditor({
  value,
  onChange,
  onCompileAndRun,
  onFormat,
  readOnly = false,
  editorRef: externalEditorRef,
}: CodeEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ignoreChangesRef = useRef(false);
  // Store callback refs to avoid closure issues with keyboard shortcuts
  const onChangeRef = useRef(onChange);
  const onCompileAndRunRef = useRef(onCompileAndRun);
  const onFormatRef = useRef(onFormat);

  useEffect(() => {
    if (!containerRef.current) return;

    // Configure Monaco for Arduino C++
    monaco.languages.register({ id: "arduino-cpp" });

    // Set tokens provider for Arduino C++ (use stateful handling for block comments)
    monaco.languages.setMonarchTokensProvider("arduino-cpp", {
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"], // NOSONAR S5843
          [/\/\*/, "comment.block", "@comment"],
          [/".*?"/, "string"], // NOSONAR S5843
          [/'.*?'/, "string"], // NOSONAR S5843
          [
            /\b(void|int|float|double|char|bool|byte|String|long|short|unsigned)\b/,
            "type",
          ],
          [
            /\b(setup|loop|pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|millis|Serial)\b/,
            "keyword",
          ],
          [
            /\b(if|else|for|while|do|switch|case|break|continue|return|HIGH|LOW|INPUT|OUTPUT|LED_BUILTIN)\b/,
            "keyword",
          ],
          [/\b\d+\b/, "number"],
          [/[{}()[\]]/,  "bracket"],
          [/[<>]=?/, "operator"],
          [/[+\-*/%=!&|^~]/, "operator"],
          [/[;,.]/, "delimiter"],
          [/\b[a-zA-Z_]\w*(?=\s*\()/, "function"],
        ],

        // comment state for multiline comments
        comment: [
          [/\*\//, "comment.block", "@pop"],
          [/[^*]+/, "comment.block"],
          [/[/*]/, "comment.block"],
        ],
      },
    });

    // Configure theme
    monaco.editor.defineTheme("arduino-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "comment.block", foreground: "6a9955", fontStyle: "italic" },
        { token: "string", foreground: "ce9178" },
        { token: "keyword", foreground: "569cd6" },
        { token: "type", foreground: "4ec9b0" },
        { token: "number", foreground: "b5cea8" },
        { token: "function", foreground: "dcdcaa" },
        { token: "operator", foreground: "d4d4d4" },
      ],
      colors: {
        "editor.background": "#121212",
        "editor.foreground": "#fafafa",
        "editorLineNumber.foreground": "#666666",
        "editorLineNumber.activeForeground": "#ffffff",
        "editor.selectionBackground": "#262626",
        "editor.lineHighlightBackground": "#121212",
      },
    });

    // Read UI sizing from base vars and multiplier to avoid unresolved calc() strings
    const computeUi = () => {
      try {
        const cs = getComputedStyle(document.documentElement);
        const baseFs =
          Number.parseFloat(cs.getPropertyValue("--ui-font-base-size")) || 16;
        const baseLh = Number.parseFloat(cs.getPropertyValue("--ui-line-base")) || 20;
        const scale = Number.parseFloat(cs.getPropertyValue("--ui-font-scale")) || 1;
        const fs = baseFs * scale;
        const lh = baseLh * scale;
        return { fs, lh };
      } catch (e) {
        console.warn("computeUi failed", e);
        return { fs: 16, lh: 20 };
      }
    };

    const initial = computeUi();
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: "arduino-cpp",
      theme: "arduino-dark",
      readOnly,
      minimap: { enabled: false },
      // Hide native Monaco scrollbars — we prefer no visible scrollbars
      scrollbar: {
        vertical: "hidden",
        horizontal: "hidden",
        useShadows: false,
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
        handleMouseWheel: true,
      },
      fontSize: Math.round(initial.fs),
      lineHeight: Math.round(initial.lh),
      fontFamily: "JetBrains Mono, Consolas, Monaco, monospace",
      wordWrap: "on",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      folding: true,
      renderLineHighlight: "line",
      selectOnLineNumbers: true,
      roundedSelection: false,
      cursorStyle: "line",
      cursorWidth: 2,
      cursorSmoothCaretAnimation: "on",
      // Prevent auto-indent and format-on-paste/type from mangling programmatically
      // inserted code (e.g. via Playwright setValue / setEditorContent).
      autoIndent: "none",
      formatOnPaste: false,
      formatOnType: false,
    });

    editorRef.current = editor;

    // E2E TEST HOOK: Expose the editor instance globally for Playwright
    if (globalThis.window !== undefined) {
      // Only expose the first editor (or last, if multiple)
      (globalThis as any).__MONACO_EDITOR__ = editor;
    }

    // Ensure Monaco re-measures and layouts after CSS has fully applied.
    // Use rAF so the browser has painted and CSS vars are resolved.
    requestAnimationFrame(() => {
      try {
        const ui = computeUi();
        editor.updateOptions({
          fontSize: Math.round(ui.fs),
          lineHeight: Math.round(ui.lh),
        });
        try {
          editor.layout();
        } catch {}
      } catch (err) {
        console.warn("Monaco initial rAF sync failed", err);
      }
    });

    // Expose getValue method to external ref if provided
    if (externalEditorRef) {
      const withEditorFocus = (action: () => void) => {
        try {
          editor.focus();
          action();
        } catch {
          // ignore focus failures
        }
      };

      externalEditorRef.current = {
        getValue: () => editor.getValue(),
        undo: () => {
          withEditorFocus(() => editor.trigger("keyboard", "undo", {}));
        },
        redo: () => {
          withEditorFocus(() => editor.trigger("keyboard", "redo", {}));
        },
        find: () => {
          withEditorFocus(() => {
            const action = editor.getAction("actions.find");
            if (action) action.run();
          });
        },
        selectAll: () => {
          withEditorFocus(() => {
            const model = editor.getModel();
            if (model) {
              editor.setSelection(model.getFullModelRange());
              editor.revealRangeInCenter(model.getFullModelRange());
            }
          });
        },
        insertTextAtLine: (line: number | undefined, text: string) => {
          try {
            editor.focus();
            const model = editor.getModel();
            if (!model) return;
            insertTextAtLineInEditor(editor, model, line, text);
          } catch (err) {
            console.error("Insert text at line failed:", err);
          }
        },
        insertSuggestionSmartly: (
          text: string,
          _errorLine: number | undefined,
        ) => {
          try {
            editor.focus();
            const model = editor.getModel();
            if (!model) return;
            const insertLine = resolveSmartInsertLine(editor, model, text);
            insertSuggestionAtLine(editor, model, insertLine, text);
          } catch (err) {
            console.error("Insert suggestion smartly failed:", err);
          }
        },
        copy: () => {
          const model = editor.getModel();
          const sel = editor.getSelection();
          if (!model || !sel || sel.isEmpty()) return;
          withEditorFocus(() => {
            const text = model.getValueInRange(sel);
            navigator.clipboard.writeText(text).catch(_ignoreErr);
          });
        },
        cut: () => {
          const model = editor.getModel();
          const sel = editor.getSelection();
          if (!model || !sel || sel.isEmpty()) return;
          withEditorFocus(() => {
            const text = model.getValueInRange(sel);
            // try clipboard write (async) but not await to avoid blocking
            navigator.clipboard.writeText(text).catch(_ignoreErr);
            editor.executeEdits("cut", [{ range: sel, text: "" }]);
          });
        },
        paste: () => {
          editor.focus();
          const model = editor.getModel();
          const sel = editor.getSelection();
          handlePasteAction(editor, model, sel);
        },
        goToLine: (ln: number) => {
          editor.focus();
          const model = editor.getModel();
          if (!model) return;
          const line = Math.min(
            Math.max(1, Math.floor(ln)),
            model.getLineCount(),
          );
          editor.setPosition({ lineNumber: line, column: 1 });
          editor.revealPositionInCenter({ lineNumber: line, column: 1 });
        },
        formatCode: () => {
          const currentCode = editor.getValue();
          const formatted = formatCode(currentCode);

          if (formatted !== currentCode) {
            const model = editor.getModel();
            if (model) {
              editor.executeEdits("format", [
                {
                  range: model.getFullModelRange(),
                  text: formatted,
                },
              ]);
            }
          }
        },
      };
    }

    // Set up change listener with null check
    const changeDisposable = editor.onDidChangeModelContent(() => {
      if (ignoreChangesRef.current) return;
      const model = editor.getModel();
      if (model) {
        logger.debug("CodeEditor: onDidChangeModelContent, calling onChange");
        onChangeRef.current(editor.getValue());
      }
    });

    // NEW: Add keyboard shortcut for formatting (Ctrl+Shift+F / Cmd+Shift+F)
    // Use onKeyDown instead of addCommand to avoid accidental deletion
    const keydownDisposable = editor.onKeyDown((e) => {
      // Check if Ctrl/Cmd + Shift + F (Format)
      const isMac = navigator.userAgent.includes("Mac");
      const isFormatKey =
        (isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.code === "KeyF";

      if (isFormatKey) {
        e.preventDefault();

        // Format code directly in the editor with proper undo support
        const currentCode = editor.getValue();
        const formatted = formatCode(currentCode);

        if (formatted !== currentCode) {
          // Use executeEdits to maintain undo history
          const model = editor.getModel();
          if (model) {
            editor.executeEdits("format", [
              {
                range: model.getFullModelRange(),
                text: formatted,
              },
            ]);
          }
        }
      }

      // Note: Cmd+U (Compile&Run) is handled by a global document listener
      // to work even when the editor is not focused
    });

    // NEW: Custom paste handler to handle large pastes
    const pasteDisposable = editor.onDidPaste(() => {
      // This event fires after paste, we can use it to detect if paste was truncated
      // But we need to handle it before Monaco processes it
      logger.debug("Paste event detected");
    });

    // Better approach: Add a DOM paste listener directly
    const domNode = editor.getDomNode();
    // Listen for UI font-scale changes and update Monaco options accordingly
    const onScale = () => {
      try {
        const ui = computeUi();
        if (editor) {
          editor.updateOptions({
            fontSize: Math.round(ui.fs),
            lineHeight: Math.round(ui.lh),
          });
          try {
            editor.layout();
          } catch {}
        }
      } catch (err) {
        console.warn("onScale failed", err);
      }
    };

    // Keep listening for scale changes (some emit on document, others on window)
    globalThis.addEventListener("uiFontScaleChange", onScale);
    document.addEventListener("uiFontScaleChange", onScale);
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;

      // Get current selection
      const selection = editor.getSelection();
      if (!selection) return;

      // Execute edit operation with the full pasted text
      const model = editor.getModel();
      if (model) {
        editor.executeEdits("paste", [
          {
            range: selection,
            text: text,
            forceMoveMarkers: true,
          },
        ]);

        // Move cursor to end of pasted text
        const lines = text.split("\n");
        const endLineNumber = selection.startLineNumber + lines.length - 1;
        const lastLineText = lines.at(-1) ?? "";
        const endColumn =
          lines.length === 1
            ? selection.startColumn + text.length
            : lastLineText.length + 1;

        editor.setPosition({
          lineNumber: endLineNumber,
          column: endColumn,
        });
      }
    };

    if (domNode) {
      domNode.addEventListener("paste", handlePaste);
    }

    return () => {
      changeDisposable.dispose();
      pasteDisposable.dispose();
      keydownDisposable.dispose();
      if (domNode) {
        domNode.removeEventListener("paste", handlePaste);
      }
      document.removeEventListener("uiFontScaleChange", onScale);
      globalThis.removeEventListener("uiFontScaleChange", onScale);
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== value) {
      ignoreChangesRef.current = true;
      editorRef.current.setValue(value);
      ignoreChangesRef.current = false;
    }
  }, [value]);

  // Update callback refs whenever they change
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCompileAndRunRef.current = onCompileAndRun;
  }, [onCompileAndRun]);

  useEffect(() => {
    onFormatRef.current = onFormat;
  }, [onFormat]);

  // Global keyboard shortcut for Cmd+U (Compile & Run) - works even when editor is not focused
  useEffect(() => {
    const isMac = navigator.userAgent.includes("Mac");

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCompileKey = (isMac ? e.metaKey : e.ctrlKey) && e.code === "KeyU";

      if (isCompileKey) {
        e.preventDefault(); // Prevent browser default (View Source in Firefox)
        e.stopPropagation();
        if (onCompileAndRunRef.current) {
          onCompileAndRunRef.current();
        }
      }
    };

    // Add listener with capture phase to intercept before browser handles it
    document.addEventListener("keydown", handleGlobalKeyDown, {
      capture: true,
    });

    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, {
        capture: true,
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      data-testid="code-editor"
    />
  );
}
