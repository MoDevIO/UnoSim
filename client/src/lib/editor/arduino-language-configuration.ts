import type * as monaco from "monaco-editor/esm/vs/editor/editor.api";

/**
 * Typing behaviour of the sketch editor: Enter continues the indentation (one level deeper after an opening
 * bracket, back out for a closing one), brackets and quotes close themselves, and `//`, `/* *\/` follow C++.
 * Monaco applies none of this to a language registered without a configuration.
 */
export const arduinoLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: "/*", close: " */", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  onEnterRules: [
    {
      // /** … : continue a block comment with " * "
      beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
      afterText: /^\s*\*\/$/,
      action: { indentAction: 2, appendText: " * " }, // IndentAction.IndentOutdent
    },
    {
      beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
      action: { indentAction: 0, appendText: " * " }, // IndentAction.None
    },
    {
      beforeText: /^(\t| )* \*( ([^*]|\*(?!\/))*)?$/,
      previousLineText: /(?=^(\s*(\/\*\*|\*)).*)(?=(?!(\s*\*\/)))/,
      action: { indentAction: 0, appendText: "* " }, // IndentAction.None
    },
  ],
};
