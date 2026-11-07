/**
 * The sampling parameters the Tutor sends (LearningQuestions SSOT, model profile). The default is a low
 * temperature; a model that accepts no other value gets the one it supports, so it can be used at all.
 * Each entry is a checked fact about the provider's API, not a tuning knob: the operator verified it
 * against KI:connect, and the evaluation records the value sent (Evaluation SSOT, R-ID-3).
 */
export const TUTOR_TEMPERATURE = 0.2;

/**
 * Exact model IDs whose API rejects the default temperature. `openai-gpt5.5` answers 0.2 with HTTP 400
 * ("Only the default (1) value is supported") and accepts 1 (checked on 2026-11-07).
 */
const MODEL_TEMPERATURES: ReadonlyMap<string, number> = new Map([["openai-gpt5.5", 1]]);

/** The temperature the Tutor sends for this exact (already resolved) model ID. */
export function tutorTemperatureFor(model: string): number {
  return MODEL_TEMPERATURES.get(model) ?? TUTOR_TEMPERATURE;
}
