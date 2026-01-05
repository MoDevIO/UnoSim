import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

// Formatting function
function formatCode(code: string): string {
  let formatted = code;

  // 1. Normalize line endings
  formatted = formatted.replace(/\r\n/g, "\n");

  // 2. Add newlines after opening braces
  formatted = formatted.replace(/\{\s*/g, "{\n");

  // 3. Add newlines before closing braces
  formatted = formatted.replace(/\s*\}/g, "\n}");

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
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  // 6. Ensure newline at end of file
  if (!formatted.endsWith("\n")) {
    formatted += "\n";
  }

  return formatted;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCompileAndRun?: () => void;
  onFormat?: () => void;
  readOnly?: boolean;
  editorRef?: React.MutableRefObject<{ getValue: () => string } | null>;
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
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment.block", "@comment"],
          [/".*?"/, "string"],
          [/'.*?'/, "string"],
          [
            /\b(void|int|float|double|char|bool|byte|String|long|short|unsigned)\b/,
            "type",
          ],
          [
            /\b(setup|loop|pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|millis|Serial|if|else|for|while|do|switch|case|break|continue|return|HIGH|LOW|INPUT|OUTPUT|LED_BUILTIN)\b/,
            "keyword",
          ],
          [/\b\d+\b/, "number"],
          [/[{}()\[\]]/, "bracket"],
          [/[<>]=?/, "operator"],
          [/[+\-*/%=!&|^~]/, "operator"],
          [/[;,.]/, "delimiter"],
          [/\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/, "function"],
        ],

        // comment state for multiline comments
        comment: [
          [/\*\//, "comment.block", "@pop"],
          [/[^\/*]+/, "comment.block"],
          [/[\/*]/, "comment.block"],
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
        "editorLineNumber.activeForeground": "#888888",
        "editor.selectionBackground": "#3d3d3d",
        "editor.lineHighlightBackground": "#1a1a1a",
      },
    });

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
      fontSize: 14,
      lineHeight: 20,
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
    });

    editorRef.current = editor;

    // Expose getValue method to external ref if provided
    if (externalEditorRef) {
      externalEditorRef.current = {
        getValue: () => editor.getValue(),
      };
    }

    // Set up change listener with null check
    const changeDisposable = editor.onDidChangeModelContent(() => {
      if (ignoreChangesRef.current) return;
      const model = editor.getModel();
      if (model) {
        console.log("CodeEditor: onDidChangeModelContent, calling onChange");
        onChange(editor.getValue());
      }
    });

    // NEW: Add keyboard shortcut for formatting (Ctrl+Shift+F / Cmd+Shift+F)
    // Use onKeyDown instead of addCommand to avoid accidental deletion
    const keydownDisposable = editor.onKeyDown((e) => {
      // Check if Ctrl/Cmd + Shift + F (Format)
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
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
    const pasteDisposable = editor.onDidPaste((e) => {
      // This event fires after paste, we can use it to detect if paste was truncated
      // But we need to handle it before Monaco processes it
      console.log("Paste event detected", e);
    });

    // Better approach: Add a DOM paste listener directly
    const domNode = editor.getDomNode();
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
        const endColumn =
          lines.length === 1
            ? selection.startColumn + text.length
            : lines[lines.length - 1].length + 1;

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
    onCompileAndRunRef.current = onCompileAndRun;
  }, [onCompileAndRun]);

  useEffect(() => {
    onFormatRef.current = onFormat;
  }, [onFormat]);

  // Global keyboard shortcut for Cmd+U (Compile & Run) - works even when editor is not focused
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

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
