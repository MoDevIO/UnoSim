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
 * `a = 200`), and only at its single file-scope declaration with a plain literal (`byte a = 37;`); every
 * other assignment to that variable stays fixed. Where that declaration cannot be identified safely, no
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

/** A plain integer or character literal, the only initial value that may replace the reviewed one. */
const INITIAL_VALUE = /^-?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|B[01]+|\d+)[uUlL]{0,3}|^'(?:[^'\\\n]|\\[^\n])'/;
const ASSUMED_VARIABLE = /^\s*([A-Za-z_]\w*)\s*=\s*\S/;

function assumedVariables(reference: ReferenceAnswer): ReadonlySet<string> {
  return new Set((reference.assumptions ?? []).flatMap((assumption) => ASSUMED_VARIABLE.exec(assumption)?.[1] ?? []));
}

/**
 * The offsets of the initial values that may change: for each assumed variable, the literal of its only
 * declaration `<type words> name = <literal>;` among the lines before the first `{`. Those lines must be
 * plain file scope: no line continuation, conditional directive, string, character or block comment before
 * the declaration, so the declaration cannot be part of a macro, a literal, a comment or a disabled branch. When this is not certain for a
 * variable, it gets no site, and its value may not change.
 */
function initialValueSites(code: string, variables: ReadonlySet<string>): readonly { readonly start: number; readonly end: number }[] {
  if (variables.size === 0) return [];
  const candidates = new Map<string, { start: number; end: number }[]>();
  let offset = 0;
  for (const line of code.split("\n")) {
    const site = declarationSite(line, variables);
    if (site) {
      const list = candidates.get(site.name) ?? [];
      list.push({ start: offset + site.start, end: offset + site.end });
      candidates.set(site.name, list);
    }
    const plain = codeBeforeLineComment(line);
    if (plain === undefined || /[{"']|\/\*/.test(plain) || line.trimEnd().endsWith("\\") || CONDITIONAL_DIRECTIVE.test(line)) break;
    offset += line.length + 1;
  }
  return [...candidates.values()].flatMap((sites) => (sites.length === 1 ? sites : [])).sort((a, b) => a.start - b.start);
}

/** The part of a line before a `//` comment, or undefined when a quote makes that uncertain. */
function codeBeforeLineComment(line: string): string | undefined {
  const comment = line.indexOf("//");
  const code = comment < 0 ? line : line.slice(0, comment);
  return comment >= 0 && /["']/.test(code) ? undefined : code;
}

/** A conditional directive may leave a later declaration out of the program. */
const CONDITIONAL_DIRECTIVE = /^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/;
const DECLARATION = /^(\s*(?:[A-Za-z_]\w*\s+)+)([A-Za-z_]\w*)(\s*=\s*)(\S+?)(\s*;\s*(?:\/\/.*)?)$/;

function declarationSite(line: string, variables: ReadonlySet<string>): { name: string; start: number; end: number } | undefined {
  const match = DECLARATION.exec(line);
  if (!match || !variables.has(match[2]!)) return undefined;
  const value = match[4]!;
  const literal = INITIAL_VALUE.exec(value);
  if (literal?.[0] !== value) return undefined;
  const start = match[1]!.length + match[2]!.length + match[3]!.length;
  return { name: match[2]!, start, end: start + value.length };
}

/**
 * The current source equals the reviewed one character for character, except that each site may hold
 * another plain literal. Only whitespace at the very end is ignored.
 */
function matchesReviewedSource(current: string, reviewed: string, sites: readonly { readonly start: number; readonly end: number }[]): boolean {
  const text = current.trimEnd();
  const reference = reviewed.trimEnd();
  let position = 0;
  let from = 0;
  for (const site of sites) {
    const fixed = reference.slice(from, site.start);
    if (!text.startsWith(fixed, position)) return false;
    position += fixed.length;
    const value = INITIAL_VALUE.exec(text.slice(position))?.[0];
    if (value === undefined) return false;
    position += value.length;
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
