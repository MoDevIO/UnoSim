import { stripComments } from "@shared/parser-patterns";
import type { ExampleTutorAnnotation } from "./embedded-tutor-annotation";
import type { TutorContentQualityIssue } from "./tutor-quality-validator";

const CODE_TERM = /`([^`]+)`/g;

const IDENTIFIER_TERM = /^[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*$/;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /\w/.test(character);
}

/** Identifier-like terms must match whole words, so `int` does not match inside `println`. */
function occursIn(code: string, term: string): boolean {
  if (!IDENTIFIER_TERM.test(term)) return code.includes(term);
  const haystack = code.replaceAll(/\s+/g, " ");
  const needle = term.replaceAll(/\s+/g, " ");
  for (let from = haystack.indexOf(needle); from >= 0; from = haystack.indexOf(needle, from + 1)) {
    if (!isWordCharacter(haystack[from - 1]) && !isWordCharacter(haystack[from + needle.length])) return true;
  }
  return false;
}

function unsupportedTerms(code: string, text: string): string[] {
  return [...text.matchAll(CODE_TERM)]
    .map((match) => (match[1] ?? "").trim())
    .filter((term) => term.length > 0 && !occursIn(code, term));
}

/**
 * Teacher-authored focus questions put every code term in backticks. Each such term must occur in
 * the Example's code (comments excluded); otherwise the Tutor would ask about something the sketch
 * does not contain, such as `long` for an `unsigned long` sketch.
 */
export function validateInlineFocus(
  examples: readonly { readonly id: string; readonly code: string; readonly annotation?: ExampleTutorAnnotation }[],
): TutorContentQualityIssue[] {
  const issues: TutorContentQualityIssue[] = [];
  for (const example of examples) {
    const focus = example.annotation?.focus ?? [];
    const code = stripComments(example.code);
    for (const area of focus) {
      for (const [index, question] of area.questions.entries()) {
        for (const term of unsupportedTerms(code, question.text)) {
          issues.push({
            code: "inline-focus-term-not-in-sketch",
            message: `Inline focus ${area.id} question ${index + 1} names \`${term}\`, which does not occur in the sketch`,
            exampleId: example.id,
            conceptId: area.id,
          });
        }
      }
    }
  }
  return issues;
}
