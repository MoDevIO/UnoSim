import { z } from "zod";
import { boundedArray } from "@shared/bounded-array";
import { DEFAULT_BOARD_ID, boardIdSchema, type BoardId } from "@shared/boards";

const CONTROL_CHARACTER = /\p{Cc}/u;
/** Code may contain line breaks and tabs, but no other control character. */
const CODE_CONTROL_CHARACTER = /[^\P{Cc}\n\r\t]/u;
const MAX_REVIEWED_CODE_LENGTH = 8_000;

const referenceText = (max: number) => z.string().trim().min(1)
  .refine((value) => [...value].length <= max, `Text is longer than ${max} characters`)
  .refine((value) => !CONTROL_CHARACTER.test(value), "Text contains a control character")
  .refine((value) => !/https?:\/\//i.test(value), "URLs are not allowed in reference answers");

/**
 * A reviewed reference answer for one learning question (CourseContent SSOT 6.4, LearningQuestions R-SUP-3):
 * plain educational data, never a prompt, an expression to evaluate or a replacement sketch.
 *
 * - `answer` and `explanation` are what the learner sees after an authorized request.
 * - `accept` lists short answers that are certainly correct; other equivalent answers stay acceptable.
 * - `assumptions` are the values the question itself sets (e.g. `a = 200`); they apply before the sketch's.
 * - `requiresCode` are the code lines the answer depends on, in order; they must be part of the reviewed code.
 * - `reviewedCode` (and `reviewedBoard`) is the complete program the answer was reviewed for. A Topic question
 *   needs it; a focus question has none, because its Example (with its board) is the reviewed program.
 */
export const referenceAnswerSchema = z.object({
  answer: referenceText(300),
  explanation: referenceText(1_500),
  accept: boundedArray(referenceText(120), 8, 1).optional(),
  assumptions: boundedArray(referenceText(160), 6, 1).optional(),
  requiresCode: boundedArray(referenceText(160), 8, 1),
  reviewedCode: z.string().min(1).max(MAX_REVIEWED_CODE_LENGTH)
    .refine((value) => !CODE_CONTROL_CHARACTER.test(value), "Reviewed code contains a control character")
    .optional(),
  /** The board `reviewedCode` was reviewed for; absent means the default board. */
  reviewedBoard: boardIdSchema.optional(),
}).strict().superRefine((value, context) => {
  if (/```/.test(value.answer) || /```/.test(value.explanation)) {
    context.addIssue({ code: "custom", message: "A reference answer must not contain a code block" });
  }
  if (/\bvoid\s+setup\s*\(/.test(value.explanation) && /\bvoid\s+loop\s*\(/.test(value.explanation)) {
    context.addIssue({ code: "custom", message: "A reference answer must not contain a replacement sketch" });
  }
});

export type ReferenceAnswer = z.infer<typeof referenceAnswerSchema>;

/** Compares answers without case, surrounding punctuation or spacing differences. */
export function normalizeReferenceAnswer(value: string): string {
  const words = value.normalize("NFKC").toLocaleLowerCase("de-DE").split(/\s/).filter(Boolean).join(" ");
  let start = 0;
  let end = words.length;
  while (start < end && LEADING_MARKS.has(words[start]!)) start += 1;
  while (end > start && TRAILING_MARKS.has(words[end - 1]!)) end -= 1;
  return words.slice(start, end).split("=").map((part) => part.trim()).join(" = ").trim();
}

const LEADING_MARKS = new Set(["\"", "'", "„", "“", "`", " "]);
const TRAILING_MARKS = new Set(["\"", "'", "„", "“", "`", ".", "!", " "]);

/** A program as the Tutor sees it: the entry code, the further project files and the board it runs on. */
export interface ReviewedProgram {
  readonly code: string;
  readonly headers?: readonly { readonly name: string; readonly content: string }[];
  /** Absent means the default board. */
  readonly board?: BoardId;
}

/**
 * Whether the reference still fits the learner's current program (CourseContent SSOT 6.4, reviews N1, E1,
 * E2). The reference is bound to the exact program it was reviewed for: the same board, the same project
 * files and the same source text, character for character (only whitespace at the very end of a file is
 * ignored). No comment, spacing or line-break normalization is applied, because in C++ each of them can
 * change the meaning (a comment marker inside a string, a line break that ends a preprocessor directive).
 *
 * The one allowed change is the initial value of a variable the question itself sets (`assumptions`, e.g.
 * `a = 200`), and only at its single file-scope declaration with an explicitly named type and a plain
 * literal (`byte a = 37;`); the replacement keeps the literal's kind and suffix, so the type cannot change.
 * Every other assignment to that variable stays fixed. Where that declaration cannot be identified safely, no
 * value may change. Anything else makes the reference inapplicable, so it neither grades nor is shown.
 */
export function referenceAppliesTo(reference: ReferenceAnswer, current: ReviewedProgram, reviewed: ReviewedProgram | undefined): boolean {
  if (!reviewed) return false;
  if ((current.board ?? DEFAULT_BOARD_ID) !== (reviewed.board ?? DEFAULT_BOARD_ID)) return false;
  if (!reference.requiresCode.every((line) => codeContainsLine(reviewed.code, line))) return false;
  if (!matchesReviewedSource(current.code, reviewed.code, initialValueSites(reviewed.code, assumedVariables(reference)))) return false;
  const reviewedHeaders = reviewed.headers ?? [];
  const currentHeaders = current.headers ?? [];
  if (reviewedHeaders.length !== currentHeaders.length) return false;
  return reviewedHeaders.every(({ name, content }) => {
    const match = currentHeaders.find((header) => header.name === name);
    return match !== undefined && matchesReviewedSource(match.content, content, []);
  });
}

/**
 * Whether `line` is a whole line of `code`, apart from indentation and a trailing `//` comment. This only
 * checks authored `requiresCode` data; it never decides whether a reference applies.
 */
export function codeContainsLine(code: string, line: string): boolean {
  const required = line.trim();
  return code.split("\n").some((candidate) => {
    const text = candidate.trim();
    if (!text.startsWith(required)) return false;
    const rest = text.slice(required.length);
    return rest === "" || /^\s*\/\//.test(rest);
  });
}

/**
 * A plain integer or character literal, the only initial value that may replace the reviewed one. The kind
 * (hexadecimal, binary, decimal, character) and the suffix are part of its shape: a replacement keeps both,
 * so `37` may become `200`, but never `37u` (review F1).
 */
const INITIAL_VALUE_PATTERNS: readonly (readonly [kind: string, pattern: RegExp])[] = [
  ["hex", /^-?0[xX][0-9a-fA-F]+([uUlL]{0,3})/],
  ["binary", /^-?(?:0[bB]|B)[01]+([uUlL]{0,3})/],
  ["decimal", /^-?\d+([uUlL]{0,3})/],
  ["character", /^'(?:[^'\\\n]|\\[^\n])'/],
];

interface InitialValue {
  readonly text: string;
  /** Kind and suffix: what may not change. */
  readonly shape: string;
}

/** The literal at the start of `text`, if it starts with one. */
function leadingInitialValue(text: string): InitialValue | undefined {
  for (const [kind, pattern] of INITIAL_VALUE_PATTERNS) {
    const match = pattern.exec(text);
    // A character literal has no suffix group; numbers carry theirs in group 1.
    if (match) return { text: match[0], shape: `${kind}:${match[1] ?? ""}` };
  }
  return undefined;
}

/**
 * The declaration names its type explicitly with these words. A type deduced from the initializer (`auto`,
 * `decltype`) or any other name (a typedef, a macro, a class) is not certain, so its value may not change.
 */
const EXPLICIT_TYPES = new Set([
  "bool", "boolean", "byte", "char", "short", "int", "long", "word", "float", "double", "size_t",
  "int8_t", "uint8_t", "int16_t", "uint16_t", "int32_t", "uint32_t", "int64_t", "uint64_t",
]);
const TYPE_QUALIFIERS = new Set(["const", "volatile", "static", "unsigned", "signed"]);

function hasExplicitType(typeWords: string): boolean {
  const words = typeWords.trim().split(/\s+/);
  return words.every((word) => EXPLICIT_TYPES.has(word) || TYPE_QUALIFIERS.has(word)) && words.some((word) => EXPLICIT_TYPES.has(word));
}

const ASSUMED_VARIABLE = /^\s*([A-Za-z_]\w*)\s*=\s*\S/;

function assumedVariables(reference: ReferenceAnswer): ReadonlySet<string> {
  return new Set((reference.assumptions ?? []).flatMap((assumption) => ASSUMED_VARIABLE.exec(assumption)?.[1] ?? []));
}

/**
 * The offsets of the initial values that may change: for each assumed variable, the literal of its only
 * declaration `<type words> name = <literal>;` in the file-scope preamble, the lines before the first `{`.
 * The preamble is scanned like C++: a closed block or line comment (such as an Example's header comment) is
 * fine, but a string or character literal, a line continuation or a conditional directive makes the rest
 * uncertain, so the scan stops there. A declaration inside a comment never counts. When no single safe
 * declaration exists for a variable, it gets no site, and its value may not change.
 */
/** Where the reviewed program's initial value of an assumed variable stands, and the shape a replacement keeps. */
interface ValueSite {
  readonly start: number;
  readonly end: number;
  readonly shape: string;
}

function initialValueSites(code: string, variables: ReadonlySet<string>): readonly ValueSite[] {
  if (variables.size === 0) return [];
  const candidates = new Map<string, ValueSite[]>();
  let offset = 0;
  let inBlockComment = false;
  for (const line of code.split("\n")) {
    const site = inBlockComment ? undefined : declarationSite(line, variables);
    if (site) {
      const list = candidates.get(site.name) ?? [];
      list.push({ start: offset + site.start, end: offset + site.end, shape: site.shape });
      candidates.set(site.name, list);
    }
    const scanned = scanPreambleLine(line, inBlockComment);
    if (scanned === "unsafe") break;
    inBlockComment = scanned === "block-comment";
    offset += line.length + 1;
  }
  return [...candidates.values()].flatMap((sites) => (sites.length === 1 ? sites : [])).sort((a, b) => a.start - b.start);
}

/** One preamble line: still in a block comment after it, plain code, or the end of the safe preamble. */
function scanPreambleLine(line: string, inBlockComment: boolean): "code" | "block-comment" | "unsafe" {
  if (!inBlockComment && CONDITIONAL_DIRECTIVE.test(line)) return "unsafe";
  let inBlock = inBlockComment;
  for (const [token] of line.matchAll(PREAMBLE_TOKENS)) {
    if (inBlock) {
      inBlock = token !== "*/";
    } else if (token === "/*") {
      inBlock = true;
    } else if (token === "//") {
      break;
    } else if (token !== "*/") {
      return "unsafe";
    }
  }
  // A backslash at the end continues the line: a comment or directive could swallow the next one.
  if (line.trimEnd().endsWith("\\")) return "unsafe";
  return inBlock ? "block-comment" : "code";
}

/** Comment markers, and what ends the safe preamble: a brace, a string or a character literal. */
const PREAMBLE_TOKENS = /\/\*|\*\/|\/\/|[{"']/g;

/** A conditional directive may leave a later declaration out of the program. */
const CONDITIONAL_DIRECTIVE = /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/;
const DECLARATION = /^(\s*(?:[A-Za-z_]\w*\s+)+)([A-Za-z_]\w*)(\s*=\s*)(\S+?)(\s*;\s*(?:\/\/.*)?)$/;

function declarationSite(line: string, variables: ReadonlySet<string>): ({ name: string } & ValueSite) | undefined {
  const match = DECLARATION.exec(line);
  if (!match || !variables.has(match[2]!) || !hasExplicitType(match[1]!)) return undefined;
  const value = leadingInitialValue(match[4]!);
  if (value?.text !== match[4]) return undefined;
  const start = match[1]!.length + match[2]!.length + match[3]!.length;
  return { name: match[2]!, start, end: start + value.text.length, shape: value.shape };
}

/**
 * The current source equals the reviewed one character for character, except that each site may hold
 * another plain literal of the same shape. Only whitespace at the very end is ignored.
 */
function matchesReviewedSource(current: string, reviewed: string, sites: readonly ValueSite[]): boolean {
  const text = current.trimEnd();
  const reference = reviewed.trimEnd();
  let position = 0;
  let from = 0;
  for (const site of sites) {
    const fixed = reference.slice(from, site.start);
    if (!text.startsWith(fixed, position)) return false;
    position += fixed.length;
    const value = leadingInitialValue(text.slice(position));
    if (value?.shape !== site.shape) return false;
    position += value.text.length;
    from = site.end;
  }
  const rest = reference.slice(from);
  return text.startsWith(rest, position) && position + rest.length === text.length;
}

export type ReferenceGrade = "accepted" | "contradicted" | "open";

/**
 * A deterministic check of a short answer against a reviewed reference. `accepted`: the answer is listed as
 * certainly correct. `contradicted`: the reference's answer is a single number and the learner gave a
 * different single number. Everything else stays with the Tutor's own judgement.
 */
export function gradeAgainstReference(reference: ReferenceAnswer, answer: string): ReferenceGrade {
  const given = normalizeReferenceAnswer(answer);
  const accepted = [reference.answer, ...(reference.accept ?? [])].map(normalizeReferenceAnswer);
  if (accepted.includes(given)) return "accepted";
  const isNumber = (value: string) => /^[+-]?\d+$/.test(value);
  const expected = normalizeReferenceAnswer(reference.answer);
  if (isNumber(expected) && isNumber(given) && Number(given) !== Number(expected)) return "contradicted";
  return "open";
}
