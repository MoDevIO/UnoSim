import { stripComments } from "@shared/parser-patterns";
import type { ExampleTutorAnnotation } from "./embedded-tutor-annotation";
import type { TutorContentQualityIssue } from "./tutor-quality-validator";

const CODE_TERM = /`([^`]+)`/g;

/** Identifier-like terms must match whole words, so `int` does not match inside `println`. */
function occursIn(code: string, term: string): boolean {
  if (!/^[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*$/.test(term)) return code.includes(term);
  const escaped = term.split(/\s+/).map((part) => part.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)).join(String.raw`\s+`);
  return new RegExp(String.raw`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(code);
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
    const focus = example.annotation?.focus;
    if (focus === undefined) continue;
    const code = stripComments(example.code);
    for (const area of focus) {
      for (const [index, question] of area.questions.entries()) {
        for (const match of question.text.matchAll(CODE_TERM)) {
          const term = (match[1] ?? "").trim();
          if (term.length > 0 && !occursIn(code, term)) {
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
  }
  return issues;
}
