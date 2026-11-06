import { tutorModelSchema } from "@shared/tutor";

/**
 * Server-side resolution of the `Automatic` Tutor model (LearningQuestions 7.3).
 *
 * The operator names the preferred models as exact IDs in `UNOSIM_TUTOR_AUTO_MODELS`, in order. Automatic
 * takes the first of them that the current provider list contains. When none is configured or none is
 * available, it takes the provider's first chat model, in the provider's order; models that are clearly
 * not chat models (embeddings, rerankers, speech) are never chosen automatically. No model family is
 * preferred by the application, and only IDs from the current provider response are ever selected.
 */
const NON_CHAT_MODEL = /embed|rerank|whisper|(?:^|[-_:/.])(?:tts|e5)(?:[-_:/.]|$)/i;

export function rankTutorModels(models: readonly string[], preferred: readonly string[]): readonly string[] {
  const available = new Set(models);
  const configured = preferred.filter((model) => available.has(model));
  const rest = models.filter((model) => !configured.includes(model) && !NON_CHAT_MODEL.test(model));
  return [...configured, ...rest];
}

const MAX_AUTO_MODELS = 16;

/** Parses `UNOSIM_TUTOR_AUTO_MODELS`: comma-separated exact model IDs; an invalid entry stops the start. */
export function parseTutorAutoModels(value: string | undefined): readonly string[] {
  const models = (value ?? "").split(",").map((model) => model.trim()).filter((model) => model.length > 0);
  if (models.length > MAX_AUTO_MODELS) throw new Error(`Invalid UNOSIM_TUTOR_AUTO_MODELS: at most ${MAX_AUTO_MODELS} models`);
  for (const model of models) {
    if (!tutorModelSchema.safeParse(model).success) throw new Error(`Invalid UNOSIM_TUTOR_AUTO_MODELS: ${JSON.stringify(model)} is no model ID`);
  }
  if (new Set(models).size !== models.length) throw new Error("Invalid UNOSIM_TUTOR_AUTO_MODELS: a model is listed twice");
  return models;
}
