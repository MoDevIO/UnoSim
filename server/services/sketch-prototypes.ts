/**
 * Arduino-IDE-compatible function prototypes for the local g++ build.
 *
 * The Arduino IDE declares every sketch function before the first function
 * definition, so a helper may be called before it is defined. The prototypes
 * go there, not at the top of the file, because their signatures may use
 * types and constants that the sketch defines first (a `typedef`, or `M` in
 * `double mat[M][N]`). Default arguments are left out: C++ allows them only
 * once, and the definition already carries them.
 */

import { maskCommentsPreservingLines } from "@shared/source-project";

const FUNCTION_DEFINITION = /^((?:\w[\w*&]*\s+)*\w[\w*&]*)\s+(\w+)\s*(\([^)]*\))\s*\{/gm;
const NOT_A_FUNCTION = new Set(["if", "else", "while", "for", "do", "switch", "case", "return", "break", "continue", "goto", "class", "struct", "union", "enum", "namespace", "typedef"]);
const ENTRYPOINTS = new Set(["setup", "loop", "main"]);
const OPENING_BRACKETS = "([{";
const CLOSING_BRACKETS = ")]}";

export interface ForwardDeclarationPlan {
  /** Newline-separated prototypes, empty when the sketch needs none. */
  declarations: string;
  /** Offset in the code where the prototypes belong; -1 when there is no function definition. */
  insertAt: number;
}

interface ParameterScan {
  parts: string[];
  current: string;
  depth: number;
  quote: string | null;
  escaped: boolean;
}

function scanQuoted(scan: ParameterScan, character: string): void {
  scan.current += character;
  if (scan.escaped) scan.escaped = false;
  else if (character === "\\") scan.escaped = true;
  else if (character === scan.quote) scan.quote = null;
}

function scanParameterCharacter(scan: ParameterScan, character: string): void {
  if (scan.quote) {
    scanQuoted(scan, character);
    return;
  }
  if (character === "," && scan.depth === 0) {
    scan.parts.push(scan.current);
    scan.current = "";
    return;
  }
  if (character === '"' || character === "'") scan.quote = character;
  else if (OPENING_BRACKETS.includes(character)) scan.depth++;
  else if (CLOSING_BRACKETS.includes(character)) scan.depth--;
  scan.current += character;
}

/** Index of the `=` that starts a default argument, ignoring `=` inside quotes or brackets. */
function defaultArgumentStart(parameter: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < parameter.length; index++) {
    const character = parameter[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (OPENING_BRACKETS.includes(character)) {
      depth++;
    } else if (CLOSING_BRACKETS.includes(character)) {
      depth--;
    } else if (character === "=" && depth === 0) {
      return index;
    }
  }
  return -1;
}

/** Removes default arguments from a parenthesized parameter list such as `(int a, byte b = 2)`. */
export function stripDefaultArguments(parameterList: string): string {
  const scan: ParameterScan = { parts: [], current: "", depth: 0, quote: null, escaped: false };
  for (const character of parameterList.slice(1, -1)) scanParameterCharacter(scan, character);
  scan.parts.push(scan.current);
  if (!scan.parts.some((part) => defaultArgumentStart(part) >= 0)) return parameterList;
  const parameters = scan.parts.map((part) => {
    const start = defaultArgumentStart(part);
    return (start >= 0 ? part.slice(0, start) : part).trim();
  });
  return `(${parameters.join(", ")})`;
}

function lineIndexAt(code: string, offset: number): number {
  let line = 0;
  for (let index = code.indexOf("\n"); index >= 0 && index < offset; index = code.indexOf("\n", index + 1)) line++;
  return line;
}

/**
 * Plans the prototypes for every function defined in `code`.
 *
 * `isSketchLine` tells which lines belong to the sketch itself rather than to
 * an inlined header; the prototypes go before the first function the sketch
 * defines, like in the Arduino IDE. Without a sketch function they go before
 * the first function at all.
 */
export function planForwardDeclarations(
  code: string,
  isSketchLine: (lineIndex: number) => boolean = () => true,
): ForwardDeclarationPlan {
  const masked = maskCommentsPreservingLines(code);
  const seen = new Set<string>();
  const declarations: string[] = [];
  let firstDefinition = -1;
  let firstSketchDefinition = -1;

  for (const match of masked.matchAll(FUNCTION_DEFINITION)) {
    const name = match[2];
    if (NOT_A_FUNCTION.has(name)) continue;
    const offset = match.index ?? 0;
    if (firstDefinition < 0) firstDefinition = offset;
    if (firstSketchDefinition < 0 && isSketchLine(lineIndexAt(masked, offset))) firstSketchDefinition = offset;
    if (ENTRYPOINTS.has(name)) continue;
    const parameters = stripDefaultArguments(match[3]);
    const signature = `${name}${parameters}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    declarations.push(`${match[1].trim()} ${signature};`);
  }

  return {
    declarations: declarations.join("\n"),
    insertAt: firstSketchDefinition >= 0 ? firstSketchDefinition : firstDefinition,
  };
}

/** Inserts the planned prototypes into `code`; returns `code` unchanged when none are needed. */
export function insertForwardDeclarations(
  code: string,
  isSketchLine?: (lineIndex: number) => boolean,
): string {
  const plan = planForwardDeclarations(code, isSketchLine);
  if (!plan.declarations || plan.insertAt < 0) return code;
  const section = `// --- Forward declarations (auto-generated, mirrors Arduino IDE behaviour) ---\n${plan.declarations}\n\n`;
  return `${code.slice(0, plan.insertAt)}${section}${code.slice(plan.insertAt)}`;
}
