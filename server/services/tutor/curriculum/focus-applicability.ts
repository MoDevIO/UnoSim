import { stripComments } from "@shared/parser-patterns";
import type { ExampleFocusArea } from "../../course-content/embedded-tutor-annotation";

const CODE_TERM = /`([^`]+)`/g;
const IDENTIFIER_TERM = /^[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*$/;

/** Below this share of its code terms the sketch is another program, not an experiment with the Example. */
const MINIMUM_RETAINED_TERM_SHARE = 0.5;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /\w/.test(character);
}

/** Identifier-like terms must match whole words, so `int` does not match inside `println`. */
export function termOccursIn(cleanCode: string, term: string): boolean {
  if (!IDENTIFIER_TERM.test(term)) return cleanCode.includes(term);
  const haystack = cleanCode.replaceAll(/\s+/g, " ");
  const needle = term.replaceAll(/\s+/g, " ");
  for (let from = haystack.indexOf(needle); from >= 0; from = haystack.indexOf(needle, from + 1)) {
    if (!isWordCharacter(haystack[from - 1]) && !isWordCharacter(haystack[from + needle.length])) return true;
  }
  return false;
}

/** The code terms a teacher wrote in backticks. */
export function focusCodeTerms(text: string): string[] {
  return [...text.matchAll(CODE_TERM)].map((match) => (match[1] ?? "").trim()).filter((term) => term.length > 0);
}

/**
 * Decides against the current sketch which focus questions still fit (CourseContent SSOT 6.3): a question
 * whose code terms are gone does not apply, and a sketch that lost most terms of the focus is another
 * program, so no question applies. Small experiments keep the focus and drop only the affected questions.
 */
export function focusQuestionFilter(focus: readonly ExampleFocusArea[], code: string): (text: string) => boolean {
  const cleanCode = stripComments(code);
  const terms = [...new Set(focus.flatMap((area) => area.questions.flatMap((question) => focusCodeTerms(question.text))))];
  const retained = terms.filter((term) => termOccursIn(cleanCode, term)).length;
  if (terms.length > 0 && retained / terms.length < MINIMUM_RETAINED_TERM_SHARE) return () => false;
  return (text) => focusCodeTerms(text).every((term) => termOccursIn(cleanCode, term));
}
