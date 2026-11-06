import { z } from "zod";
import { boundedArray } from "@shared/bounded-array";
import { stripComments } from "@shared/parser-patterns";

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
 * - `reviewedCode` is the complete program the answer was reviewed for. A Topic question needs it; a focus
 *   question has none, because its Example is the reviewed program.
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

/** A program as the Tutor sees it: the entry code and the further project files. */
export interface ReviewedProgram {
  readonly code: string;
  readonly headers?: readonly { readonly name: string; readonly content: string }[];
}

/**
 * Whether the reference still fits the learner's current program (CourseContent SSOT 6.4, review N1). The
 * reference is bound to the complete program it was reviewed for: outside comments and spacing, the current
 * program must be that program token for token, with every project file. The one change allowed is the
 * literal value assigned to a variable the question itself sets (`assumptions`, e.g. `a = 200`), because
 * the question's value applies anyway. Any other change, such as an inserted `i = 0;`, a negated expression
 * or a moved line, cannot be judged safely, so the reference must neither grade nor be shown.
 */
export function referenceAppliesTo(reference: ReferenceAnswer, current: ReviewedProgram, reviewed: ReviewedProgram | undefined): boolean {
  if (!reviewed) return false;
  const reviewedTokens = codeTokens(reviewed.code);
  if (!reference.requiresCode.every((line) => containsTokens(reviewedTokens, codeTokens(line)))) return false;
  if (!sameTokens(reviewedTokens, codeTokens(current.code), assumedVariables(reference))) return false;
  const reviewedHeaders = reviewed.headers ?? [];
  const currentHeaders = current.headers ?? [];
  if (reviewedHeaders.length !== currentHeaders.length) return false;
  return reviewedHeaders.every(({ name, content }) => {
    const match = currentHeaders.find((header) => header.name === name);
    return match !== undefined && sameTokens(codeTokens(content), codeTokens(match.content), new Set());
  });
}

/** Whether `line` is part of `code`, outside comments and spacing; used to validate `requiresCode`. */
export function codeContainsLine(code: string, line: string): boolean {
  return containsTokens(codeTokens(code), codeTokens(line));
}

const TOKEN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|\d[\w.]*|<<=|>>=|<<|>>|&&|\|\||\+\+|--|->|::|[-+*/%&|^!=<>]=|\S/g;
const LITERAL = /^(?:\d[\w.]*|'(?:\\.|[^'\\])*'|true|false|HIGH|LOW)$/;
const ASSUMED_VARIABLE = /^\s*([A-Za-z_]\w*)\s*=/;

function codeTokens(code: string): string[] {
  return stripComments(code).match(TOKEN) ?? [];
}

function assumedVariables(reference: ReferenceAnswer): ReadonlySet<string> {
  return new Set((reference.assumptions ?? []).flatMap((assumption) => ASSUMED_VARIABLE.exec(assumption)?.[1] ?? []));
}

function containsTokens(tokens: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0) return false;
  for (let start = 0; start + part.length <= tokens.length; start += 1) {
    if (part.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

/** Length of a literal at `index` (with an optional sign), or 0 when there is none. */
function literalLength(tokens: readonly string[], index: number): number {
  const signed = tokens[index] === "-" || tokens[index] === "+" ? 1 : 0;
  return LITERAL.test(tokens[index + signed] ?? "") ? signed + 1 : 0;
}

/** A literal that is the whole value of `<assumed variable> = <literal>;` in the reviewed code. */
function assumedLiteralLength(tokens: readonly string[], index: number, variables: ReadonlySet<string>): number {
  if (index < 2 || tokens[index - 1] !== "=" || !variables.has(tokens[index - 2]!)) return 0;
  const length = literalLength(tokens, index);
  return length > 0 && tokens[index + length] === ";" ? length : 0;
}

function sameTokens(reviewed: readonly string[], current: readonly string[], variables: ReadonlySet<string>): boolean {
  let r = 0;
  let c = 0;
  while (r < reviewed.length && c < current.length) {
    const assumed = assumedLiteralLength(reviewed, r, variables);
    if (assumed > 0) {
      const given = literalLength(current, c);
      if (given === 0 || current[c + given] !== ";") return false;
      r += assumed;
      c += given;
    } else if (reviewed[r] === current[c]) {
      r += 1;
      c += 1;
    } else {
      return false;
    }
  }
  return r === reviewed.length && c === current.length;
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
