import type { TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import {
  type DidacticContentRepository,
} from "./curriculum/content-repository";
import type { TutorCapability } from "../course-content/course-content-loader";
import type { ExampleTutorBinding } from "../course-content/course-content-schema";
import {
  resolveEffectiveTutorStrategy,
  type StrategyResolution,
} from "./strategy/effective-tutor-strategy";
import {
  DefaultLearningPlanner,
  type LearningPlanner,
} from "./curriculum/learning-planner";
import { DefaultSketchFactExtractor, type SketchFactExtractor } from "./curriculum/sketch-facts";
import { DefaultTopicMatcher, type TopicMatcher } from "./curriculum/topic-matcher";
import type { TutorPlan, TutorPlanningContentContext, TutorPlanningExtension } from "./tutor-planning";

export interface CurriculumTutorAdapterDependencies {
  readonly courseContent?: CourseContentSnapshotProvider;
  readonly repository?: DidacticContentRepository;
  readonly factExtractor?: SketchFactExtractor;
  readonly topicMatcher?: TopicMatcher;
  readonly planner?: LearningPlanner;
}

export interface CourseContentSnapshotProvider {
  getSnapshot(): Promise<{ readonly revision: string; readonly tutor?: TutorCapability; readonly exampleId?: string } | null>;
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

  async resolveStrategy(input: { courseContent?: TutorPlanningContentContext }): Promise<StrategyResolution> {
    try {
      const snapshot = input.courseContent ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      return this.resolveSnapshotStrategy(snapshot);
    } catch {
      return resolveEffectiveTutorStrategy({});
    }
  }

  async planInitial(input: { code: string; history: readonly TutorDialogTurn[]; difficulty: TutorDifficulty; exampleId?: string; courseContent?: TutorPlanningContentContext }): Promise<TutorPlan | null> {
    const context = await this.match(input.code, input.exampleId, input.courseContent);
    if (!context) return null;
    const plan = this.planner.start(context.topic, context.revision, context.facts, input.history, input.difficulty, context.strategy?.strategy);
    return plan ? normalizePlan(plan, context.strategy) : null;
  }

  async planFollowup(input: {
    code: string;
    history: readonly TutorDialogTurn[];
    currentQuestion: string;
    rating: Parameters<NonNullable<LearningPlanner["advance"]>>[5];
    difficulty: TutorDifficulty;
    exampleId?: string;
    courseContent?: TutorPlanningContentContext;
  }): Promise<TutorPlan | null> {
    const context = await this.match(input.code, input.exampleId, input.courseContent);
    if (!context) return null;
    const plan = this.planner.advance(context.topic, context.revision, context.facts, input.history, input.currentQuestion, input.rating, input.difficulty, context.strategy?.strategy);
    return plan ? normalizePlan(plan, context.strategy) : null;
  }

  private async match(code: string, exampleId?: string, supplied?: TutorPlanningContentContext) {
    try {
      const snapshot = supplied ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      if (snapshot) {
        return this.matchCourseContent(code, exampleId ?? snapshot.exampleId, snapshot);
      }
      if (!this.courseContent) {
        const legacy = this.repository ? await this.repository.getSnapshot() : null;
        if (!legacy) return null;
        const facts = this.factExtractor.extract(code);
        const match = this.topicMatcher.match(legacy.topics, facts)[0];
        return match ? { revision: legacy.revision, facts, topic: match.topic, strategy: resolveEffectiveTutorStrategy({}) } : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private matchCourseContent(code: string, exampleId: string | undefined, snapshot: TutorPlanningContentContext) {
    if (snapshot.tutor?.status !== "valid" || snapshot.tutor.topics.length === 0) return null;
    const facts = this.factExtractor.extract(code);
    const matches = this.topicMatcher.match(snapshot.tutor.topics, facts);
    const byId = new Map(matches.map((match) => [match.topic.id, match]));
    const binding = exampleId === undefined ? undefined : snapshot.tutor.bindings.get(exampleId);
    const boundIds = [
      ...(binding?.primaryTopic ? [binding.primaryTopic] : []),
      ...(binding?.topics ?? []),
    ];
    const boundMatch = boundIds
      .map((id) => byId.get(id))
      .find((match): match is NonNullable<typeof match> => match !== undefined);
    const match = boundMatch ?? matches[0];
    if (!match) return null;
    return {
      revision: snapshot.revision,
      facts,
      topic: match.topic,
      strategy: this.resolveSnapshotStrategy(snapshot, binding),
    };
  }

  private resolveSnapshotStrategy(
    snapshot: TutorPlanningContentContext | null,
    knownBinding?: ExampleTutorBinding,
  ): StrategyResolution {
    if (snapshot?.tutor?.status !== "valid") return resolveEffectiveTutorStrategy({});
    const tutor = snapshot.tutor;
    const binding = knownBinding ?? (snapshot.exampleId === undefined
      ? undefined
      : tutor.bindings.get(snapshot.exampleId));
    const repositoryDefault = tutor.manifest.defaultStrategy === undefined
      ? undefined
      : tutor.strategies.find(({ id }) => id === tutor.manifest.defaultStrategy);
    const perExample = binding?.strategy === undefined
      ? undefined
      : tutor.strategies.find(({ id }) => id === binding.strategy);
    return resolveEffectiveTutorStrategy({ perExample, repositoryDefault });
  }
}

function normalizePlan(plan: Awaited<ReturnType<LearningPlanner["start"]>>, strategy = resolveEffectiveTutorStrategy({})): TutorPlan {
  if (!plan) throw new Error("Cannot normalize an empty tutor plan");
  return {
    ...plan.brief,
    ...(plan.brief.scaffold ? { scaffold: { ...plan.brief.scaffold } } : {}),
    contentRevision: plan.contentRevision,
    strategyId: strategy.strategy.id,
    strategySource: strategy.source === "built-in" ? "built-in" : "repository",
  };
}
