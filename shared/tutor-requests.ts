import { z } from "zod";
import { boardIdSchema } from "./boards";
import { INPUT_LIMITS } from "./input-limits";
import { projectFilesRequestFields, rejectEntryHeaderCollision } from "./schema";
import { boundedArray } from "./bounded-array";
import {
  TUTOR_DEFAULT_DIFFICULTY,
  tutorCourseContentContextSchema,
  tutorCourseContentSessionSchema,
  tutorDialogTurnSchema,
  tutorDifficultySchema,
  tutorModelSchema,
  tutorSupportBindingFields,
} from "./tutor";

/** Request bodies of the Tutor routes; only the server validates them, so the browser does not load them. */

export const tutorQuestionRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    /** Header files and entry file name of the project, as in `POST /api/compile`; `code` is the entry file. */
    ...projectFilesRequestFields,
    /** Board the sketch is written for; the Tutor's context then names it, its data type sizes and its pins. */
    board: boardIdSchema.optional(),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
    /** Opts into the learning-support cycle (LearningQuestions 3.10); the response then carries `support`. */
    learningSupport: z.literal(true).optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision);

export const tutorModelsRequestSchema = z
  .object({
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
  })
  .strict();

export const tutorDialogRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    ...projectFilesRequestFields,
    board: boardIdSchema.optional(),
    history: boundedArray(tutorDialogTurnSchema, INPUT_LIMITS.tutor.maxHistoryEntries),
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
    // Compatibility rule (LearningQuestions 9.1): without these three fields the dialog keeps the MVP behavior.
    supportSession: tutorSupportBindingFields.supportSession.optional(),
    questionHandle: tutorSupportBindingFields.questionHandle.optional(),
    actionId: tutorSupportBindingFields.actionId.optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision)
  .superRefine((value, context) => {
    const bound = [value.supportSession, value.questionHandle, value.actionId].filter((field) => field !== undefined).length;
    if (bound !== 0 && bound !== 3) {
      context.addIssue({ code: "custom", path: ["supportSession"], message: "supportSession, questionHandle and actionId belong together" });
    }
  });
