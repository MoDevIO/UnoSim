/**
 * Stable, server-side preference for Automatic tutor model selection.
 *
 * The preference is deliberately family-based: only IDs returned by the
 * provider are ever ranked or selected. Provider deployment names therefore
 * remain configuration data, not application prerequisites.
 */
const MODEL_FAMILY_SCORES: ReadonlyArray<readonly [RegExp, number]> = [
  [/(?:^|[-_:/.])qwen(?:\d|[-_:/.]|$)/i, 1_000],
  [/(?:instruct|instruction|reasoning|coder|chat)/i, 300],
  [/(?:^|[-_:/.])(?:llama|mistral|gemma|phi|deepseek)(?:[-_:/.]|$)/i, 200],
];

function scoreTutorModel(model: string): number {
  return MODEL_FAMILY_SCORES.reduce((score, [pattern, points]) => (
    pattern.test(model) ? score + points : score
  ), 0);
}

/**
 * Orders the current provider response for Automatic selection.
 * Equal scores retain the provider's order for deterministic fallback.
 */
export function rankTutorModels(models: readonly string[]): readonly string[] {
  return models
    .map((model, index) => ({ model, index, score: scoreTutorModel(model) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ model }) => model);
}
