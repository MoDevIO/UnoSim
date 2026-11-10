import { tokenizeCpp, type CppToken } from "./cpp-lexer";

/**
 * "Format Code" of the editor (ssot/ssot_function_definition_CodeFormatting.md): re-indents a sketch by its
 * structure, two spaces per level, with braces of blocks on their own line boundaries. Statements after a
 * brace-less `if`, `else`, `for`, `while` and `do` go one level deeper, and `else` stays with the `if` it belongs to.
 * Strings, character literals, raw strings, comments and preprocessor lines are text, not structure; the formatter
 * adds no braces or semicolons and changes no spacing inside a line.
 *
 * Why not clang-format: its WebAssembly build is about 5.5 MB (the whole bundle budget is 6 MB), and it restyles
 * everything (spacing, line breaks, include order) where learners need only the structure made visible. The lexer
 * (`cpp-lexer.ts`) and the statement state machine below cover exactly that.
 */

type ControlKind = "if" | "else" | "for" | "while" | "do" | "switch";

interface Frame {
  readonly type: "block" | "control" | "initializer";
  /** Level of the lines inside. */
  readonly inner: number;
  /** Level of the closing brace (block, initializer). */
  readonly open: number;
  /** Control statements: which one, and whether its body is a block. */
  readonly kind?: ControlKind;
  readonly braced?: boolean;
  /** Blocks: `class`/`struct`/`union`/`enum`, whose statement goes on after `}` (`};`, `} a;`). */
  readonly classLike?: boolean;
  readonly isSwitch?: boolean;
  /** Switch blocks: a `case` or `default` label was seen, so statements stand one level below it. */
  labelSeen?: boolean;
  /** Initializers: the parenthesis depth around the brace. */
  readonly parenDepth?: number;
}

interface OutputLine {
  readonly tokens: CppToken[];
  level: number | null;
  /** Width of the line's original indentation when it starts a source line, else null (a line split off). */
  readonly originalIndent: number | null;
}

const CONTROL_HEADERS = new Set<ControlKind>(["if", "for", "while", "switch"]);
const CLASS_KEYWORDS = new Set(["class", "struct", "union", "enum"]);
const ACCESS_LABELS = new Set(["public", "private", "protected"]);
/** After these, `{` opens a block, not an initializer: `f() {`, `f() const {`, `try {`, `extern "C" {`. */
const BLOCK_AFTER = new Set([")", '"', "const", "override", "final", "noexcept", "mutable", "try", "volatile"]);
/** What may follow a block's `}` on the same line. */
const KEEP_AFTER_CLOSE = new Set(["else", ";", ",", ")"]);
const STRUCTURE_FREE = new Set(["space", "newline", "splice", "lineComment", "blockComment", "preprocessor"]);
const INDENT = "  ";
const CONTINUATION = 2;

/** The structural key of a token: its text for words and punctuation, a placeholder for literals. */
function keyOf(token: CppToken): string {
  if (token.kind === "word" || token.kind === "punct") return token.text;
  if (token.kind === "number") return "0";
  return '"';
}

function isStructural(token: CppToken | undefined): boolean {
  return token !== undefined && !STRUCTURE_FREE.has(token.kind);
}

/** Shifts the continuation lines of a block comment by `delta` spaces, as its first line moved. */
function shiftComment(text: string, delta: number): string {
  if (delta === 0 || !text.includes("\n")) return text;
  return text.split("\n").map((line, index) => {
    if (index === 0 || line.trim() === "") return line;
    if (delta > 0) return " ".repeat(delta) + line;
    const removable = /^[ \t]*/.exec(line)![0].length;
    return line.slice(Math.min(removable, -delta));
  }).join("\n");
}

/** Drops blanks at the end, unless a backslash before them splices the next line. */
function trimTrailing(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return text[end - 1] === "\\" ? text : text.slice(0, end);
}

class CodeFormatter {
  private readonly stack: Frame[] = [];
  private parenDepth = 0;
  private statementStarted = false;
  private statementBase = 0;
  private statementTokens = 0;
  private statementFirst = "";
  private statementClassLike = false;
  private statementNamespace = false;
  private previous = "";
  /** A control keyword waiting for its parenthesized head; `headerOpen` once the head's `(` came. */
  private header: ControlKind | null = null;
  private headerOpen = false;
  /** A complete control head (or `else`, `do`) whose body has not started yet. */
  private pendingBody: { kind: ControlKind; level: number } | null = null;
  private doTailPending = false;
  private lineLevel = 0;
  private index = 0;
  private readonly nextStructural: number[];
  private readonly lines: string[] = [];

  constructor(private readonly tokens: CppToken[]) {
    this.nextStructural = new Array<number>(tokens.length + 1).fill(-1);
    for (let index = tokens.length - 1; index >= 0; index--) {
      this.nextStructural[index] = isStructural(tokens[index + 1]) ? index + 1 : this.nextStructural[index + 1]!;
    }
  }

  format(): string {
    let line = this.newLine(this.tokens[0]?.kind === "space" ? this.tokens[0].text.length : 0);
    for (let index = 0; index < this.tokens.length; index++) {
      const token = this.tokens[index]!;
      if (token.kind === "newline") {
        this.flush(line, index);
        const indent = this.tokens[index + 1]?.kind === "space" ? this.tokens[index + 1]!.text.length : 0;
        line = this.newLine(indent);
      } else if (!isStructural(token)) {
        if (token.kind !== "space" || line.tokens.length > 0) line.tokens.push(token);
      } else {
        line = this.addStructural(line, index);
      }
    }
    this.flush(line, this.tokens.length - 1);
    while (this.lines.length > 0 && this.lines.at(-1) === "") this.lines.pop();
    return `${this.lines.join("\n")}\n`;
  }

  private newLine(originalIndent: number | null): OutputLine {
    return { tokens: [], level: null, originalIndent };
  }

  /** Adds a structural token to `line`; returns the line that goes on (a new one after a split). */
  private addStructural(line: OutputLine, index: number): OutputLine {
    const token = this.tokens[index]!;
    const key = keyOf(token);
    this.index = index;
    let current = line;
    if (key === "}" && this.closesBlock() && current.tokens.some((part) => part.kind !== "space")) {
      this.flush(current, index - 1); // a comment-only rest takes the level before this `}`
      current = this.newLine(null);
    }
    const atLineStart = current.level === null;
    const level = this.process(key, atLineStart);
    if (atLineStart) current.level = level;
    current.tokens.push(token);
    if (this.breaksAfter(key, index)) {
      this.flush(current, index);
      current = this.newLine(null);
    }
    return current;
  }

  private flush(line: OutputLine, index: number): void {
    const tokens = [...line.tokens];
    while (tokens.at(-1)?.kind === "space") tokens.pop();
    if (tokens.length === 0) {
      if (this.lines.at(-1) !== "") this.lines.push(""); // one blank line at most
      return;
    }
    const next = this.nextStructural[index] ?? -1;
    const level = line.level ?? this.peekLevel(next >= 0 ? keyOf(this.tokens[next]!) : null);
    const delta = line.originalIndent === null ? 0 : level * INDENT.length - line.originalIndent;
    const text = tokens.map((token, position) => {
      const shifted = token.kind === "blockComment" ? shiftComment(token.text, delta) : token.text;
      const last = position === tokens.length - 1;
      return last && (token.kind === "lineComment" || token.kind === "preprocessor") ? trimTrailing(shifted) : shifted;
    }).join("");
    this.lines.push(INDENT.repeat(level) + text);
  }

  // --- Structure -----------------------------------------------------------------------------------------------

  private top(): Frame | undefined {
    return this.stack.at(-1);
  }

  /** Level of a new statement here: the innermost frame's, one deeper after a `case` label. */
  private statementLevel(): number {
    const top = this.top();
    if (!top) return 0;
    return top.inner + (top.isSwitch && top.labelSeen ? 1 : 0);
  }

  /** Level of a line that starts with `key`, with any pending control body already resolved. */
  private levelFor(key: string | null): number {
    const top = this.top();
    if (this.statementStarted) {
      if (key === "{" || key === ")" || key === "]") return this.statementBase;
      if (top?.type === "initializer" && this.parenDepth === 0) return top.inner;
      return this.statementBase + CONTINUATION;
    }
    if ((key === "case" || key === "default") && top?.isSwitch) return top.inner;
    return this.statementLevel();
  }

  /** Level of a comment or preprocessor line before a line that starts with `key` (null: end of file). */
  private peekLevel(key: string | null): number {
    const pending = this.pendingBody;
    if (pending) {
      if (key === "{" || (key === "if" && pending.kind === "else")) return pending.level;
      return pending.level + 1;
    }
    if (key === "}") return this.statementLevel();
    return this.levelFor(key);
  }

  /** Whether a `}` here closes a block (not an initializer); brace-less bodies left open close with it. */
  private closesBlock(): boolean {
    for (let position = this.stack.length - 1; position >= 0; position--) {
      const frame = this.stack[position]!;
      if (frame.type !== "control" || frame.braced) return frame.type === "block";
    }
    return false;
  }

  private process(key: string, atLineStart: boolean): number {
    this.resolvePendingBody(key);
    if (key === "}") return this.closeBrace(atLineStart);
    const level = this.levelFor(key);
    if (atLineStart) this.lineLevel = level;
    this.consume(key);
    return level;
  }

  /** The first token after a control head decides: `{` opens its block, anything else is its one statement. */
  private resolvePendingBody(key: string): void {
    const pending = this.pendingBody;
    if (!pending) return;
    this.pendingBody = null;
    if (key === "if" && pending.kind === "else") return; // `else if`: one chain on one level
    const braced = key === "{";
    this.stack.push({ type: "control", kind: pending.kind, braced, inner: braced ? pending.level : pending.level + 1, open: pending.level });
  }

  private consume(key: string): void {
    if (key === ";") {
      this.semicolon();
      return;
    }
    if (key === "{") {
      this.openBrace();
      return;
    }
    const starting = !this.statementStarted;
    if (starting) this.startStatement(key);
    if (key === "(" || key === "[") this.openParen();
    else if (key === ")" || key === "]") this.closeParen();
    else if (key === ":" && this.parenDepth === 0 && this.isLabel()) this.endLabel();
    else if (starting) this.keyword(key);
    this.noteToken(key);
  }

  private startStatement(key: string): void {
    const top = this.top();
    this.statementStarted = true;
    this.statementBase = (key === "case" || key === "default") && top?.isSwitch ? top.inner : this.statementLevel();
    this.statementTokens = 0;
    this.statementFirst = key;
    this.statementClassLike = false;
    this.statementNamespace = false;
    this.previous = "";
  }

  private noteToken(key: string): void {
    this.statementTokens++;
    if (CLASS_KEYWORDS.has(key)) this.statementClassLike = true;
    if (key === "namespace") this.statementNamespace = true;
    this.previous = key;
  }

  private keyword(key: string): void {
    const doTail = this.doTailPending && key === "while";
    this.doTailPending = false;
    if (doTail) return; // `while (…);` of a `do`: a plain statement on the level of the `do`
    if (CONTROL_HEADERS.has(key as ControlKind)) {
      this.header = key as ControlKind;
      this.headerOpen = false;
    } else if (key === "else" || key === "do") {
      this.pendingBody = { kind: key, level: this.statementBase };
      this.statementStarted = false;
    }
  }

  private openParen(): void {
    if (this.header && this.parenDepth === 0) this.headerOpen = true;
    this.parenDepth++;
  }

  private closeParen(): void {
    if (this.parenDepth > 0) this.parenDepth--;
    if (this.parenDepth === 0 && this.header && this.headerOpen) {
      this.pendingBody = { kind: this.header, level: this.statementBase };
      this.header = null;
      this.statementStarted = false;
    }
  }

  private isLabel(): boolean {
    const first = this.statementFirst;
    if (first === "case" || first === "default") return true;
    return this.statementTokens === 1 && (ACCESS_LABELS.has(first) || /^[A-Za-z_]\w*$/.test(first));
  }

  private endLabel(): void {
    const top = this.top();
    if ((this.statementFirst === "case" || this.statementFirst === "default") && top?.isSwitch) top.labelSeen = true;
    this.statementStarted = false;
  }

  private semicolon(): void {
    if (this.parenDepth > 0 || this.top()?.type === "initializer") return; // `for (;;)`
    this.completeStatement();
  }

  /** A statement ended: it completes the brace-less bodies around it, up to an `if` that an `else` follows. */
  private completeStatement(): void {
    this.statementStarted = false;
    this.header = null;
    for (let top = this.top(); top?.type === "control"; top = this.top()) {
      this.stack.pop();
      if (top.kind === "if" && this.nextKey() === "else") return;
      if (top.kind === "do") {
        this.doTailPending = true;
        return;
      }
    }
  }

  private nextKey(): string | null {
    const next = this.nextStructural[this.index] ?? -1;
    return next >= 0 ? keyOf(this.tokens[next]!) : null;
  }

  private openBrace(): void {
    const top = this.top();
    if (top?.type === "control" && top.braced) {
      this.pushBlock(top.inner, false, top.kind === "switch");
    } else if (this.isInitializer()) {
      this.stack.push({ type: "initializer", inner: this.lineLevel + 1, open: this.lineLevel, parenDepth: this.parenDepth });
      this.parenDepth = 0;
      this.previous = "{";
    } else {
      const base = this.statementStarted ? this.statementBase : this.statementLevel();
      this.pushBlock(base, this.statementStarted && this.statementClassLike, false);
    }
  }

  private isInitializer(): boolean {
    if (this.top()?.type === "initializer" || this.parenDepth > 0) return true;
    if (!this.statementStarted || this.statementClassLike || this.statementNamespace) return false;
    return !BLOCK_AFTER.has(this.previous);
  }

  private pushBlock(base: number, classLike: boolean, isSwitch: boolean): void {
    this.stack.push({ type: "block", inner: base + 1, open: base, classLike, isSwitch });
    this.statementStarted = false;
    this.header = null;
    this.parenDepth = 0;
  }

  private closeBrace(atLineStart: boolean): number {
    while (this.top()?.type === "control" && !this.top()!.braced) this.stack.pop();
    const frame = this.stack.pop();
    const level = frame?.open ?? 0;
    if (atLineStart) this.lineLevel = level;
    if (frame?.type === "initializer") {
      this.parenDepth = frame.parenDepth ?? 0;
      this.previous = "}";
      return level;
    }
    this.parenDepth = 0;
    if (frame?.classLike) {
      this.statementStarted = true;
      this.statementBase = frame.open;
      this.previous = "}";
      return level;
    }
    this.statementStarted = false;
    if (this.top()?.type === "control") this.completeStatement();
    return level;
  }

  /** A line break after a block's `{`, and after a `}` that ended a statement, when code follows on the line. */
  private breaksAfter(key: string, index: number): boolean {
    const top = this.top();
    if (key === "{") return top?.type === "block" && !this.statementStarted && this.codeFollows(index) !== null;
    if (key !== "}" || this.statementStarted || top?.type === "initializer") return false;
    const next = this.codeFollows(index);
    if (next === null || KEEP_AFTER_CLOSE.has(next)) return false;
    return !(next === "while" && this.doTailPending);
  }

  /** The key of the next code token on the same line, or null when only blanks and comments follow. */
  private codeFollows(index: number): string | null {
    for (let next = index + 1; next < this.tokens.length; next++) {
      const token = this.tokens[next]!;
      if (token.kind === "newline") return null;
      if (isStructural(token)) return keyOf(token);
    }
    return null;
  }
}

/** "Format Code" (ssot/ssot_function_definition_CodeFormatting.md). Pure; the same result when applied twice. */
export function formatCode(code: string): string {
  const source = code.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return new CodeFormatter(tokenizeCpp(source)).format();
}
