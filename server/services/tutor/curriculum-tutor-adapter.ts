import type { TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import {
  type DidacticContentRepository,
} from "./curriculum/content-repository";
import type { TutorCapability } from "../course-content/course-content-loader";
import { resolveEffectiveTutorStrategy } from "./strategy/effective-tutor-strategy";
import {
  DefaultLearningPlanner,
  type LearningPlanner,
} from "./curriculum/learning-planner";
import { DefaultSketchFactExtractor, type SketchFactExtractor } from "./curriculum/sketch-facts";
import { DefaultTopicMatcher, type TopicMatcher } from "./curriculum/topic-matcher";
import type { TutorPlan, TutorPlanningExtension } from "./tutor-planning";

export interface CurriculumTutorAdapterDependencies {
  readonly courseContent?: CourseContentSnapshotProvider;
  readonly repository?: DidacticContentRepository;
  readonly factExtractor?: SketchFactExtractor;
  readonly topicMatcher?: TopicMatcher;
  readonly planner?: LearningPlanner;
}

export interface CourseContentSnapshotProvider {
  getSnapshot(): Promise<{ readonly revision: string; readonly tutor?: TutorCapability } | null>;
}

export class CurriculumTutorAdapter implements TutorPlanningExtension {
  private readonly courseContent?: CourseContentSnapshotProvider;
  private readonly repository?: DidacticContentRepository;
  private readonly factExtractor: SketchFactExtractor;
  private readonly topicMatcher: TopicMatcher;
  private readonly planner: LearningPlanner;

  constructor(deps: CurriculumTutorAdapterDependencies = {}) {
    this.courseContent = deps.courseContent;
    this.repository = deps.repository;
    this.factExtractor = deps.factExtractor ?? new DefaultSketchFactExtractor();
    this.topicMatcher = deps.topicMatcher ?? new DefaultTopicMatcher();
    this.planner = deps.planner ?? new DefaultLearningPlanner();
  }

  async planInitial(input: { code: string; history: readonly TutorDialogTurn[]; difficulty: TutorDifficulty }): Promise<TutorPlan | null> {
    const context = await this.match(input.code);
    if (!context) return null;
    const plan = this.planner.start(context.topic, context.revision, context.facts, input.history, input.difficulty, context.strategy?.strategy);
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
    const plan = this.planner.advance(context.topic, context.revision, context.facts, input.history, input.currentQuestion, input.rating, input.difficulty, context.strategy?.strategy);
    return plan ? normalizePlan(plan) : null;
  }

  private async match(code: string) {
    try {
      if (this.courseContent) {
        const snapshot = await this.courseContent.getSnapshot();
        if (!snapshot || snapshot.tutor?.status !== "valid" || snapshot.tutor.topics.length === 0) return null;
        const facts = this.factExtractor.extract(code);
        const match = this.topicMatcher.match(snapshot.tutor.topics, facts)[0];
        if (!match) return null;
        const tutor = snapshot.tutor;
        const repositoryDefault = tutor.manifest.defaultStrategy === undefined
          ? undefined
          : tutor.strategies.find(({ id }) => id === tutor.manifest.defaultStrategy);
        return {
          revision: snapshot.revision,
          facts,
          topic: match.topic,
          strategy: resolveEffectiveTutorStrategy({ repositoryDefault }),
        };
      }
      const snapshot = this.repository ? await this.repository.getSnapshot() : null;
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
