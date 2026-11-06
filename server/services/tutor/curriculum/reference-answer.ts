import { z } from "zod";
import { boundedArray } from "@shared/bounded-array";
import { stripComments } from "@shared/parser-patterns";

const CONTROL_CHARACTER = /\p{Cc}/u;

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
 * - `requiresCode` are the complete code lines the answer depends on; the reference applies only while the
 *   current code still has each of them, unchanged and in this order.
 */
export const referenceAnswerSchema = z.object({
  answer: referenceText(300),
  explanation: referenceText(1_500),
  accept: boundedArray(referenceText(120), 8, 1).optional(),
  assumptions: boundedArray(referenceText(160), 6, 1).optional(),
  requiresCode: boundedArray(referenceText(160), 8, 1),
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

/**
 * Whether the reference still fits the learner's current code: every required line must still be a whole line
 * of the code (comments and spacing aside), in the given order. A changed line, such as a negated expression or
 * another loop start, means the reviewed answer is no longer proven and must neither grade nor be shown.
 */
export function referenceAppliesTo(reference: ReferenceAnswer, code: string): boolean {
  const lines = stripComments(code).split("\n").map(compactSpacing).filter((line) => line.length > 0);
  let from = 0;
  for (const required of reference.requiresCode) {
    const index = lines.indexOf(compactSpacing(required), from);
    if (index < 0) return false;
    from = index + 1;
  }
  return true;
}

/** Spacing inside a line does not matter: `a&(1<<i)` and `a & (1 << i)` are the same code. */
function compactSpacing(value: string): string {
  return value.replaceAll(/\s+/g, "");
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
