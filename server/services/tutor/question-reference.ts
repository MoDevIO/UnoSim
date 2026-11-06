import type { TutorPlanningContentContext } from "./tutor-planning";
import { referenceAppliesTo, type ReferenceAnswer } from "./curriculum/reference-answer";

/** Where a reference answer for the asked question stands (LearningQuestions R-SUP-3). */
export type QuestionReference =
  | { readonly status: "available"; readonly reference: ReferenceAnswer }
  | { readonly status: "unavailable"; readonly reason: "no-reference" | "not-applicable" };

/**
 * The reviewed reference answer of the question the learner sees, looked up by its exact text in the
 * pinned Course Content: a teacher's focus question first, then a Topic question. A reference whose code no
 * longer fits the learner's current sketch is not applicable, so it can neither grade nor be shown.
 */
export function resolveQuestionReference(
  question: string,
  code: string,
  courseContent?: TutorPlanningContentContext,
): QuestionReference {
  const reference = findReference(question, courseContent);
  if (!reference) return { status: "unavailable", reason: "no-reference" };
  if (!referenceAppliesTo(reference, code)) return { status: "unavailable", reason: "not-applicable" };
  return { status: "available", reference };
}

function findReference(question: string, courseContent?: TutorPlanningContentContext): ReferenceAnswer | undefined {
  if (!courseContent || courseContent.tutor?.status !== "valid") return undefined;
  const text = question.trim();
  const focusQuestion = courseContent.exampleTutorAnnotation?.focus
    ?.flatMap((area) => area.questions)
    .find((candidate) => candidate.text === text);
  if (focusQuestion?.reference) return focusQuestion.reference;
  for (const topic of courseContent.tutor.topics) {
    if (topic.schemaVersion !== 3) continue;
    const match = topic.questions.find((candidate) => candidate.text === text);
    if (match?.reference) return match.reference;
  }
  return undefined;
}
