import type { CurriculumTopic, TopicDeepening } from "./curriculum-schema";
import type { Observation } from "./learning-planner";

export type DidacticPhase = "LEARN" | "DEEPEN" | "EXPAND";
export type ProgressionBlockedReason = "content-exhausted";

export interface TutorProgressionState {
  revision: string;
  activeTopicId?: string;
  phase?: DidacticPhase;
  masteredTopicIds: string[];
  masteryEvidence: Record<string, Observation[]>;
  postMasteryEvidence: Record<string, Observation[]>;
  retainedPhases: Record<string, "DEEPEN" | "EXPAND">;
  progressionBlockedReason?: ProgressionBlockedReason;
}

export const DEFAULT_DEEPENING: TopicDeepening = {
  minimumSuccessfulProbes: 2,
  successRatingAtLeast: 4,
  requiredQuestionKinds: ["transfer"],
  recentWeakAnswersAllowed: 0,
};

export function createTutorProgressionState(revision: string): TutorProgressionState {
  return {
    revision,
    masteredTopicIds: [],
    masteryEvidence: {},
    postMasteryEvidence: {},
    retainedPhases: {},
  };
}

export function resetTutorProgressionState(state: TutorProgressionState, revision = state.revision): void {
  state.activeTopicId = undefined;
  state.phase = undefined;
  state.masteredTopicIds.splice(0, state.masteredTopicIds.length);
  state.masteryEvidence = {};
  state.postMasteryEvidence = {};
  state.retainedPhases = {};
  state.progressionBlockedReason = undefined;
  state.revision = revision;
}

export function appendEvidence(
  state: TutorProgressionState,
  collection: "masteryEvidence" | "postMasteryEvidence",
  topicId: string,
  observation: Observation,
): void {
  const entries = state[collection][topicId] ?? [];
  entries.push(observation);
  state[collection][topicId] = entries;
}

export function markTopicMastered(state: TutorProgressionState, topicId: string): void {
  if (!state.masteredTopicIds.includes(topicId)) state.masteredTopicIds.push(topicId);
}

export function deepeningCriteria(topic: CurriculumTopic): TopicDeepening {
  return topic.schemaVersion === 2 && topic.deepening ? topic.deepening : DEFAULT_DEEPENING;
}

export function hasMetDeepeningCriteria(topic: CurriculumTopic, observations: readonly Observation[]): boolean {
  const criteria = deepeningCriteria(topic);
  const successful = observations.filter(({ rating }) => rating >= criteria.successRatingAtLeast);
  const weakTrailing = [...observations].reverse().findIndex(({ rating }) => rating > 2);
  const recentWeakCount = weakTrailing < 0 ? observations.length : weakTrailing;
  return successful.length >= criteria.minimumSuccessfulProbes
    && criteria.requiredQuestionKinds.every((kind) => successful.some((observation) => observation.kind === kind))
    && recentWeakCount <= criteria.recentWeakAnswersAllowed;
}
