import type { TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import {
  GitHubDidacticContentRepository,
  type DidacticContentRepository,
} from "./curriculum/content-repository";
import {
  DefaultLearningPlanner,
  type LearningPlanner,
} from "./curriculum/learning-planner";
import { DefaultSketchFactExtractor, type SketchFactExtractor } from "./curriculum/sketch-facts";
import { DefaultTopicMatcher, type TopicMatcher } from "./curriculum/topic-matcher";
import type { TutorPlan, TutorPlanningExtension } from "./tutor-planning";

export interface CurriculumTutorAdapterDependencies {
  readonly repository?: DidacticContentRepository;
  readonly factExtractor?: SketchFactExtractor;
  readonly topicMatcher?: TopicMatcher;
  readonly planner?: LearningPlanner;
}

export class CurriculumTutorAdapter implements TutorPlanningExtension {
  private readonly repository: DidacticContentRepository;
  private readonly factExtractor: SketchFactExtractor;
  private readonly topicMatcher: TopicMatcher;
  private readonly planner: LearningPlanner;

  constructor(deps: CurriculumTutorAdapterDependencies = {}) {
    this.repository = deps.repository ?? new GitHubDidacticContentRepository();
    this.factExtractor = deps.factExtractor ?? new DefaultSketchFactExtractor();
    this.topicMatcher = deps.topicMatcher ?? new DefaultTopicMatcher();
    this.planner = deps.planner ?? new DefaultLearningPlanner();
  }

  async planInitial(input: { code: string; history: readonly TutorDialogTurn[]; difficulty: TutorDifficulty }): Promise<TutorPlan | null> {
    const context = await this.match(input.code);
    if (!context) return null;
    const plan = this.planner.start(context.topic, context.revision, context.facts, input.history, input.difficulty);
    return plan ? normalizePlan(plan) : null;
  }

  async planFollowup(input: {
    code: string;
    history: readonly TutorDialogTurn[];
    currentQuestion: string;
    rating: Parameters<NonNullable<LearningPlanner["advance"]>>[5];
    difficulty: TutorDifficulty;
  }): Promise<TutorPlan | null> {
    const context = await this.match(input.code);
    if (!context) return null;
    const plan = this.planner.advance(context.topic, context.revision, context.facts, input.history, input.currentQuestion, input.rating, input.difficulty);
    return plan ? normalizePlan(plan) : null;
  }

  private async match(code: string) {
    try {
      const snapshot = await this.repository.getSnapshot();
      if (!snapshot) return null;
      const facts = this.factExtractor.extract(code);
      const match = this.topicMatcher.match(snapshot.topics, facts)[0];
      return match ? { revision: snapshot.revision, facts, topic: match.topic } : null;
    } catch {
      return null;
    }
  }
}

function normalizePlan(plan: Awaited<ReturnType<LearningPlanner["start"]>>): TutorPlan {
  if (!plan) throw new Error("Cannot normalize an empty tutor plan");
  return {
    ...plan.brief,
    ...(plan.brief.scaffold ? { scaffold: { ...plan.brief.scaffold } } : {}),
    contentRevision: plan.contentRevision,
  };
}
