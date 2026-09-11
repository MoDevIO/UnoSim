import type { CurriculumTopic } from "./curriculum-schema";
import { matchesFactRequirement, type SketchFacts } from "./sketch-facts";

export interface TopicMatch {
  readonly topic: CurriculumTopic;
  readonly score: number;
}

export interface TopicMatcher {
  match(topics: readonly CurriculumTopic[], facts: SketchFacts): readonly TopicMatch[];
}

export class DefaultTopicMatcher implements TopicMatcher {
  match(topics: readonly CurriculumTopic[], facts: SketchFacts): readonly TopicMatch[] {
    return topics
      .map((topic) => {
        const matched = topic.activation.any.filter((requirement) => matchesFactRequirement(facts, requirement)).length;
        return { topic, score: matched };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.topic.id.localeCompare(right.topic.id));
  }
}
