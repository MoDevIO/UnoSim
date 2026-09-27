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
  usedExpansionTargetTopicIds: Record<string, string[]>;
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
    usedExpansionTargetTopicIds: {},
  };
}

export function cloneTutorProgressionState(state: TutorProgressionState): TutorProgressionState {
  return {
    ...state,
    masteredTopicIds: [...state.masteredTopicIds],
    masteryEvidence: cloneEvidence(state.masteryEvidence),
    postMasteryEvidence: cloneEvidence(state.postMasteryEvidence),
    retainedPhases: { ...state.retainedPhases },
    usedExpansionTargetTopicIds: Object.fromEntries(
      Object.entries(state.usedExpansionTargetTopicIds).map(([topicId, targetIds]) => [topicId, [...targetIds]]),
    ),
  };
}

export function commitTutorProgressionState(target: TutorProgressionState, source: TutorProgressionState): void {
  target.revision = source.revision;
  target.activeTopicId = source.activeTopicId;
  target.phase = source.phase;
  target.masteredTopicIds = [...source.masteredTopicIds];
  target.masteryEvidence = cloneEvidence(source.masteryEvidence);
  target.postMasteryEvidence = cloneEvidence(source.postMasteryEvidence);
  target.retainedPhases = { ...source.retainedPhases };
  target.usedExpansionTargetTopicIds = Object.fromEntries(
    Object.entries(source.usedExpansionTargetTopicIds).map(([topicId, targetIds]) => [topicId, [...targetIds]]),
  );
  target.progressionBlockedReason = source.progressionBlockedReason;
}

function cloneEvidence(evidence: Record<string, Observation[]>): Record<string, Observation[]> {
  return Object.fromEntries(
    Object.entries(evidence).map(([topicId, observations]) => [topicId, observations.map((observation) => ({ ...observation }))]),
  );
}

export function resetTutorProgressionState(state: TutorProgressionState, revision = state.revision): void {
  state.activeTopicId = undefined;
  state.phase = undefined;
  state.masteredTopicIds.splice(0, state.masteredTopicIds.length);
  state.masteryEvidence = {};
  state.postMasteryEvidence = {};
  state.retainedPhases = {};
  state.usedExpansionTargetTopicIds = {};
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

export function markExpansionTargetUsed(state: TutorProgressionState, sourceTopicId: string, targetTopicId: string): void {
  const targets = state.usedExpansionTargetTopicIds[sourceTopicId] ?? [];
  if (!targets.includes(targetTopicId)) targets.push(targetTopicId);
  state.usedExpansionTargetTopicIds[sourceTopicId] = targets;
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
