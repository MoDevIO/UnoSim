import { stripComments } from "@shared/parser-patterns";
import type { ExampleTutorAnnotation } from "./embedded-tutor-annotation";
import type { TutorContentQualityIssue } from "./tutor-quality-validator";

const CODE_TERM = /`([^`]+)`/g;

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
          if (term.length > 0 && !code.includes(term)) {
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
