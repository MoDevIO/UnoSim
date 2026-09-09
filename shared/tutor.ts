import { z } from "zod";
import { INPUT_LIMITS } from "./input-limits";

export const tutorModeSchema = z.enum(["disabled", "user-key", "managed"]);
export type TutorMode = z.infer<typeof tutorModeSchema>;

export const tutorModelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/, "Invalid tutor model identifier");

export const tutorQuestionRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
  })
  .strict();

export type TutorQuestionRequest = z.infer<typeof tutorQuestionRequestSchema>;

export const tutorModelsRequestSchema = z
  .object({
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
  })
  .strict();

export type TutorModelsRequest = z.infer<typeof tutorModelsRequestSchema>;

export const tutorModelsResponseSchema = z
  .object({
    models: z.array(tutorModelSchema).max(256),
  })
  .strict();

export type TutorModelsResponse = z.infer<typeof tutorModelsResponseSchema>;

export const tutorContentResultSchema = z
  .object({
    feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
    question: z.string().trim().min(1).max(2_000),
    topic: z.string().trim().min(1).max(120).optional(),
    difficulty: z.enum(["basic", "intermediate", "advanced"]).optional(),
    mermaid: z.string().trim().min(1).max(12_000).optional(),
  })
  .strict();

export type TutorContentResult = z.infer<typeof tutorContentResultSchema>;

/** Backwards-compatible name for the initial single-question endpoint. */
export const learningQuestionResultSchema = tutorContentResultSchema;

export const tutorDialogTurnSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
    feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  })
  .strict();

export type TutorDialogTurn = z.infer<typeof tutorDialogTurnSchema>;

export const tutorDialogRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    history: z.array(tutorDialogTurnSchema).max(INPUT_LIMITS.tutor.maxHistoryEntries),
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
  })
  .strict();

export type TutorDialogRequest = z.infer<typeof tutorDialogRequestSchema>;

export const tutorResponseSchema = tutorContentResultSchema.extend({
  provider: z.string().min(1).max(64),
  mode: z.enum(["user-key", "managed"]),
  model: z.string().min(1).max(128),
});

export type TutorResponse = z.infer<typeof tutorResponseSchema>;
/** Backwards-compatible name for the initial single-question endpoint. */
export const tutorQuestionResponseSchema = tutorResponseSchema;

export const tutorErrorCodeSchema = z.enum([
  "TUTOR_DISABLED",
  "CREDENTIAL_REQUIRED",
  "CREDENTIAL_INVALID",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "RATE_LIMITED",
  "MODEL_UNAVAILABLE",
  "INVALID_PROVIDER_RESPONSE",
  "INVALID_REQUEST",
]);

export type TutorErrorCode = z.infer<typeof tutorErrorCodeSchema>;

export interface TutorErrorResponse {
  error: {
    code: TutorErrorCode;
    message: string;
    retryAfter?: number;
  };
}
