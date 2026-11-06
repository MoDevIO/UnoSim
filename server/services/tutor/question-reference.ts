import type { TutorPlanningContentContext } from "./tutor-planning";
import { referenceAppliesTo, type ReferenceAnswer, type ReviewedProgram } from "./curriculum/reference-answer";

/** Where a reference answer for the asked question stands (LearningQuestions R-SUP-3). */
export type QuestionReference =
  | { readonly status: "available"; readonly reference: ReferenceAnswer }
  | { readonly status: "unavailable"; readonly reason: "no-reference" | "not-applicable" };

/**
 * The reviewed reference answer of the question the learner sees, looked up by its exact text in the
 * pinned Course Content: a teacher's focus question first, then a Topic question. A reference is bound to
 * the complete program it was reviewed for (the Example, or a Topic reference's `reviewedCode`); when the
 * learner's program differs from it beyond the question's own assumptions, the reference is not
 * applicable, so it can neither grade nor be shown (review N1).
 */
export function resolveQuestionReference(
  question: string,
  program: ReviewedProgram,
  courseContent?: TutorPlanningContentContext,
): QuestionReference {
  const found = findReference(question, courseContent);
  if (!found) return { status: "unavailable", reason: "no-reference" };
  if (!referenceAppliesTo(found.reference, program, found.reviewed)) return { status: "unavailable", reason: "not-applicable" };
  return { status: "available", reference: found.reference };
}

type FoundReference = { readonly reference: ReferenceAnswer; readonly reviewed: ReviewedProgram | undefined };

function findReference(question: string, courseContent?: TutorPlanningContentContext): FoundReference | undefined {
  if (!courseContent || courseContent.tutor?.status !== "valid") return undefined;
  const text = question.trim();
  const focusQuestion = courseContent.exampleTutorAnnotation?.focus
    ?.flatMap((area) => area.questions)
    .find((candidate) => candidate.text === text);
  if (focusQuestion?.reference) return { reference: focusQuestion.reference, reviewed: courseContent.exampleProgram };
  for (const topic of courseContent.tutor.topics) {
    if (topic.schemaVersion !== 3) continue;
    const reference = topic.questions.find((candidate) => candidate.text === text)?.reference;
    if (reference) return { reference, reviewed: reference.reviewedCode === undefined ? undefined : { code: reference.reviewedCode } };
  }
  return undefined;
}
