import { z } from "zod";
import { INPUT_LIMITS } from "./input-limits";
import { examplesRefSchema, fullCommitShaSchema, repositorySlugSchema } from "./examples";
import { boundedArray } from "./bounded-array";

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

export const tutorQuestionKindSchema = z.enum(["recall", "concept", "application", "prediction", "transfer"]);
export const tutorLearningPhaseSchema = z.enum(["LEARN", "DEEPEN", "EXPAND"]);
export const tutorStrategySourceSchema = z.enum(["built-in", "repository"]);
export const tutorCourseContentContextSchema = z.object({
  repository: repositorySlugSchema,
  ref: examplesRefSchema,
  revision: fullCommitShaSchema,
  exampleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/).optional(),
}).strict();
export const tutorCourseContentSessionSchema = z.uuid();
export type TutorCourseContentContext = z.infer<typeof tutorCourseContentContextSchema>;
const tutorLearningMetadataFields = {
  topicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  conceptId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  questionId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  indicatorId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  questionKind: tutorQuestionKindSchema.optional(),
  strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  strategySource: tutorStrategySourceSchema.optional(),
  contentRevision: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  learningPhase: tutorLearningPhaseSchema.optional(),
  activeTopicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  masteredTopicIds: boundedArray(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), 64).optional(),
  progressionBlockedReason: z.literal("content-exhausted").optional(),
  extensionTargetTopicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
};

/**
 * The learner's place in the teacher's focus of an Example: `active` asks its questions, `completed` means
 * every area was understood, `open` that the questions ran out first, `paused` that the sketch no longer
 * fits the focus. The free Tutor answers in all but `active`.
 */
export const tutorFocusProgressSchema = z.object({
  state: z.enum(["active", "completed", "open", "paused"]),
  understoodAreas: z.number().int().min(0).max(8),
  totalAreas: z.number().int().min(1).max(8),
  openAreas: boundedArray(z.string().trim().min(1).max(160), 8),
}).strict();
export type TutorFocusProgress = z.infer<typeof tutorFocusProgressSchema>;

/** Own answer attempts after which the reference answer may be requested (LearningQuestions R-SUP-3). */
export const TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS = 3;
/** Answered clarification requests after which the question may be skipped (LearningQuestions R-SUP-4). */
export const TUTOR_SKIP_AFTER_CLARIFICATIONS = 2;

/** The learner's explicit actions on the asked question besides answering it (LearningQuestions 9.1). */
export const tutorSupportActionSchema = z.enum(["clarify", "hint", "reveal", "skip"]);
export type TutorSupportAction = z.infer<typeof tutorSupportActionSchema>;

/**
 * How the asked question was dealt with in this session (R-SUP-5): still `open`, `answered` on one's own,
 * `assisted` (closed after the reference answer was shown) or `skipped`.
 */
export const tutorQuestionOutcomeSchema = z.enum(["open", "answered", "assisted", "skipped"]);
export type TutorQuestionOutcome = z.infer<typeof tutorQuestionOutcomeSchema>;

/** How the server understood a typed input: an answer, a question about the question, or a request for help. */
export const tutorLearnerInputSchema = z.enum(["answer", "clarification", "help"]);
export type TutorLearnerInput = z.infer<typeof tutorLearnerInputSchema>;

const supportCountSchema = z.number().int().min(0).max(1_000);

/** The server-owned learning-support state of the asked question (LearningQuestions R-SUP-6). */
export const tutorSupportStateSchema = z.object({
  session: z.uuid(),
  questionHandle: z.uuid(),
  answerAttempts: supportCountSchema,
  clarifications: supportCountSchema,
  canRevealReference: z.boolean(),
  canSkip: z.boolean(),
  /** Whether a reviewed reference answer fits the question and the current code. */
  referenceAvailable: z.boolean(),
  /** The reference answer was shown for this question. */
  referenceShown: z.boolean(),
  outcome: tutorQuestionOutcomeSchema,
}).strict();
export type TutorSupportState = z.infer<typeof tutorSupportStateSchema>;

/** Binds an action to the server's support session and question; a retry repeats the same `actionId`. */
export const tutorSupportBindingFields = {
  supportSession: z.uuid(),
  questionHandle: z.uuid(),
  actionId: z.uuid(),
};


function withDefaultResponseStyle(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "responseStyle" in value) return value;
  return { ...value, responseStyle: "normal" };
}

export const tutorContentFields = {
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  question: z.string().trim().min(1).max(2_000),
  topic: z.string().trim().min(1).max(120).optional(),
  difficulty: tutorDifficultySchema.optional(),
  mermaid: z.string().trim().min(1).max(12_000).optional(),
  focusProgress: tutorFocusProgressSchema.optional(),
  ...tutorLearningMetadataFields,
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



export const tutorModelsResponseSchema = z
  .object({
    models: boundedArray(tutorModelSchema, 256),
  })
  .strict();

export const tutorContentResultSchema = z.preprocess(withDefaultResponseStyle, tutorContentResultUnionSchema);

export type TutorContentResult = z.infer<typeof tutorContentResultSchema>;

const tutorDialogFields = {
  question: z.string().trim().min(1).max(2_000),
  answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  ...tutorLearningMetadataFields,
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




const tutorResponseFields = {
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  courseContentSession: tutorCourseContentSessionSchema.optional(),
  /** Present when the request opted into the learning-support cycle. */
  support: tutorSupportStateSchema.optional(),
  /** How a typed input was understood; only `answer` is rated. */
  learnerInput: tutorLearnerInputSchema.optional(),
  /**
   * Whether an answer in the support cycle closed its question (`closed`, the response asks the next one) or
   * left it open (`open`, the same question again, possibly bound anew to changed code). The server decides;
   * a new question handle alone does not mean the question was closed (LearningQuestions 10.7).
   */
  questionStatus: z.enum(["open", "closed"]).optional(),
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
