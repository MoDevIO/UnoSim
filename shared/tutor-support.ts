import { z } from "zod";
import { boardIdSchema } from "./boards";
import { INPUT_LIMITS } from "./input-limits";
import { projectFilesRequestFields, rejectEntryHeaderCollision } from "./schema";
import { boundedArray } from "./bounded-array";
import {
  TUTOR_DEFAULT_DIFFICULTY,
  tutorContentFields,
  tutorCourseContentContextSchema,
  tutorCourseContentSessionSchema,
  tutorDialogTurnSchema,
  tutorDifficultySchema,
  tutorFocusProgressSchema,
  tutorModelSchema,
  tutorSupportActionSchema,
  tutorSupportBindingFields,
  tutorSupportStateSchema,
} from "./tutor";

/**
 * Request and response of `POST /api/tutor/support` (LearningQuestions 9.1). Kept apart from `./tutor` so
 * that the browser loads them only when the learner uses a support action.
 */

/** Why no reference answer can be shown. */
export const tutorReferenceUnavailableReasonSchema = z.enum(["no-reference", "not-applicable"]);

export const tutorReferenceViewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    answer: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(1).max(1_500),
    assumptions: boundedArray(z.string().trim().min(1).max(160), 6).optional(),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: tutorReferenceUnavailableReasonSchema,
  }).strict(),
]);
export type TutorReferenceView = z.infer<typeof tutorReferenceViewSchema>;

/** An explicit support action on the asked question; it carries no learner answer (LearningQuestions 9.1). */
export const tutorSupportRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    ...projectFilesRequestFields,
    board: boardIdSchema.optional(),
    history: boundedArray(tutorDialogTurnSchema, INPUT_LIMITS.tutor.maxHistoryEntries),
    action: tutorSupportActionSchema,
    ...tutorSupportBindingFields,
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision);
export type TutorSupportRequest = z.infer<typeof tutorSupportRequestSchema>;

/** The next question after a skip; its learning metadata as in a question response. */
const tutorNextQuestionSchema = z.object({
  ...tutorContentFields,
  responseStyle: z.literal("normal"),
}).strict();

/**
 * The result of a support action (LearningQuestions 9.1): `explanation` for clarify and hint, `reference` for
 * reveal, and for skip either the `next` question or `completed` with the open areas. None carries a rating.
 */
export const tutorSupportResponseSchema = z.object({
  action: tutorSupportActionSchema,
  explanation: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  reference: tutorReferenceViewSchema.optional(),
  next: tutorNextQuestionSchema.optional(),
  completed: z.literal(true).optional(),
  focusProgress: tutorFocusProgressSchema.optional(),
  support: tutorSupportStateSchema.optional(),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  courseContentSession: tutorCourseContentSessionSchema.optional(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.action === "clarify" || value.action === "hint") && value.explanation === undefined) issue(`${value.action} needs an explanation`);
  if (value.action === "reveal" && value.reference === undefined) issue("reveal needs a reference view");
  if (value.action !== "reveal" && value.reference !== undefined) issue("only reveal shows a reference");
  if (value.action === "skip" && (value.next === undefined) === (value.completed === undefined)) issue("skip needs either next or completed");
  if (value.action !== "skip" && (value.next !== undefined || value.completed !== undefined)) issue("only skip moves to another question");
  if (value.action !== "skip" && value.support === undefined) issue(`${value.action} needs the support state`);
});
export type TutorSupportResponse = z.infer<typeof tutorSupportResponseSchema>;
