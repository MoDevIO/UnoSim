import { z } from "zod";
import { INPUT_LIMITS } from "./input-limits";

export const tutorModeSchema = z.enum(["disabled", "user-key", "managed"]);
export type TutorMode = z.infer<typeof tutorModeSchema>;

export const tutorModelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/, "Invalid tutor model identifier");

export const TUTOR_DIFFICULTY_MIN = 1;
export const TUTOR_DIFFICULTY_MAX = 100;
export const TUTOR_DEFAULT_DIFFICULTY = 30;
export const TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY = "unoTutorConfiguredDifficulty";
export const TUTOR_ADAPTIVE_RATING_WINDOW = 4;
export const TUTOR_ADAPTIVE_MIN_STEP = -6;
export const TUTOR_ADAPTIVE_MAX_STEP = 4;

export const tutorDifficultySchema = z.number().int().min(TUTOR_DIFFICULTY_MIN).max(TUTOR_DIFFICULTY_MAX);
export type TutorDifficulty = z.infer<typeof tutorDifficultySchema>;

export const tutorAnswerRatingSchema = z.number().int().min(1).max(5);
export type TutorAnswerRating = z.infer<typeof tutorAnswerRatingSchema>;

export const TUTOR_RATING_DIFFICULTY_DELTAS: Record<TutorAnswerRating, number> = {
  1: -6,
  2: -3,
  3: 0,
  4: 2,
  5: 4,
};

export const tutorResponseStyleSchema = z.enum(["normal", "philosophical"]);
export type TutorResponseStyle = z.infer<typeof tutorResponseStyleSchema>;

function withDefaultResponseStyle(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "responseStyle" in value) return value;
  return { ...value, responseStyle: "normal" };
}

const tutorContentFields = {
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  question: z.string().trim().min(1).max(2_000),
  topic: z.string().trim().min(1).max(120).optional(),
  difficulty: tutorDifficultySchema.optional(),
  mermaid: z.string().trim().min(1).max(12_000).optional(),
};

const tutorNormalContentResultSchema = z.object({
  ...tutorContentFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
}).strict();

const tutorPhilosophicalContentResultSchema = z.object({
  ...tutorContentFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
}).strict();

const tutorContentResultUnionSchema = z.discriminatedUnion("responseStyle", [
  tutorNormalContentResultSchema,
  tutorPhilosophicalContentResultSchema,
]);

export function clampTutorDifficulty(value: number): TutorDifficulty {
  const normalized = Number.isFinite(value) ? Math.round(value) : TUTOR_DEFAULT_DIFFICULTY;
  return Math.min(TUTOR_DIFFICULTY_MAX, Math.max(TUTOR_DIFFICULTY_MIN, normalized));
}

export function calculateNextTutorDifficulty(
  currentDifficulty: TutorDifficulty,
  ratings: readonly TutorAnswerRating[],
): TutorDifficulty {
  const recentRatings = ratings.slice(-TUTOR_ADAPTIVE_RATING_WINDOW);
  if (recentRatings.length === 0) return currentDifficulty;

  const weightedSum = recentRatings.reduce((sum, rating, index) => sum + TUTOR_RATING_DIFFICULTY_DELTAS[rating] * (index + 1), 0);
  const weightSum = recentRatings.reduce((sum, _rating, index) => sum + index + 1, 0);
  const dampedStep = Math.max(TUTOR_ADAPTIVE_MIN_STEP, Math.min(TUTOR_ADAPTIVE_MAX_STEP, Math.round(weightedSum / weightSum)));
  return clampTutorDifficulty(currentDifficulty + dampedStep);
}

export const tutorQuestionRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
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

export const tutorContentResultSchema = z.preprocess(withDefaultResponseStyle, tutorContentResultUnionSchema);

export type TutorContentResult = z.infer<typeof tutorContentResultSchema>;

/** Backwards-compatible name for the initial single-question endpoint. */
export const learningQuestionResultSchema = tutorContentResultSchema;

const tutorDialogFields = {
  question: z.string().trim().min(1).max(2_000),
  answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
};

const tutorNormalDialogTurnSchema = z.object({
  ...tutorDialogFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
}).strict();

const tutorPhilosophicalDialogTurnSchema = z.object({
  ...tutorDialogFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
}).strict();

export const tutorDialogTurnSchema = z.preprocess(
  withDefaultResponseStyle,
  z.discriminatedUnion("responseStyle", [tutorNormalDialogTurnSchema, tutorPhilosophicalDialogTurnSchema]),
);

export type TutorDialogTurn = z.infer<typeof tutorDialogTurnSchema>;

export const tutorDialogRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    history: z.array(tutorDialogTurnSchema).max(INPUT_LIMITS.tutor.maxHistoryEntries),
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
  })
  .strict();

export type TutorDialogRequest = z.infer<typeof tutorDialogRequestSchema>;

const tutorResponseFields = {
  provider: z.string().min(1).max(64),
  mode: z.enum(["user-key", "managed"]),
  model: z.string().min(1).max(128),
};

const tutorNormalResponseSchema = z.object({
  ...tutorContentFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
  ...tutorResponseFields,
}).strict();

const tutorPhilosophicalResponseSchema = z.object({
  ...tutorContentFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
  ...tutorResponseFields,
}).strict();

export const tutorResponseSchema = z.preprocess(
  withDefaultResponseStyle,
  z.discriminatedUnion("responseStyle", [tutorNormalResponseSchema, tutorPhilosophicalResponseSchema]),
);

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
