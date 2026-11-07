import { tutorModelSchema } from "@shared/tutor";

/**
 * Server-side resolution of the `Automatic` Tutor model (LearningQuestions 7.3).
 *
 * The operator approves the models Automatic may use as exact IDs in `UNOSIM_TUTOR_AUTO_MODELS`, in order.
 * Automatic takes the first of them that the current provider list contains, and only those: a model that
 * did not pass the operator's quality check is never chosen automatically, however the provider lists it.
 * When none of them is available, Automatic has no model and the learner is pointed to the manual choice.
 * Models that are clearly not chat models (embeddings, rerankers, speech) are never approved.
 */
const NON_CHAT_MODEL = /embed|rerank|whisper|(?:^|[-_:/.])(?:tts|e5)(?:[-_:/.]|$)/i;

/** The approved models the provider currently offers, in the approved order; the first one is Automatic's. */
export function automaticTutorModels(models: readonly string[], approved: readonly string[]): readonly string[] {
  const available = new Set(models);
  // The start rejects a non-chat model in the list; the filter keeps that true for any caller (review F5).
  return approved.filter((model) => available.has(model) && !NON_CHAT_MODEL.test(model));
}

const MAX_AUTO_MODELS = 16;

/**
 * The approved models when `UNOSIM_TUTOR_AUTO_MODELS` is unset: the only model that passed the live
 * comparison of 2026-11-07 (LearningQuestions TUT-07).
 */
export const DEFAULT_TUTOR_AUTO_MODELS: readonly string[] = ["openai-gpt5.5"];

/**
 * Parses `UNOSIM_TUTOR_AUTO_MODELS`: comma-separated exact model IDs; unset means the default, an empty
 * value turns Automatic off (manual choice only). An invalid entry stops the start.
 */
export function parseTutorAutoModels(value: string | undefined): readonly string[] {
  if (value === undefined) return DEFAULT_TUTOR_AUTO_MODELS;
  const models = value.split(",").map((model) => model.trim()).filter((model) => model.length > 0);
  if (models.length > MAX_AUTO_MODELS) throw new Error(`Invalid UNOSIM_TUTOR_AUTO_MODELS: at most ${MAX_AUTO_MODELS} models`);
  for (const model of models) {
    if (!tutorModelSchema.safeParse(model).success) throw new Error(`Invalid UNOSIM_TUTOR_AUTO_MODELS: ${JSON.stringify(model)} is no model ID`);
    if (NON_CHAT_MODEL.test(model)) throw new Error(`Invalid UNOSIM_TUTOR_AUTO_MODELS: ${JSON.stringify(model)} is no chat model (embedding, reranking or speech)`);
  }
  if (new Set(models).size !== models.length) throw new Error("Invalid UNOSIM_TUTOR_AUTO_MODELS: a model is listed twice");
  return models;
}
