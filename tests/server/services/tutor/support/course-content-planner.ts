import { CurriculumTutorAdapter } from "../../../../../server/services/tutor/curriculum-tutor-adapter";
import type { TutorPlanningContentContext, TutorPlanningExtension } from "../../../../../server/services/tutor/tutor-planning";

type ContextSource = () => TutorPlanningContentContext | null | Promise<TutorPlanningContentContext | null>;
type CourseContentPlanner = TutorPlanningExtension & Required<Pick<TutorPlanningExtension, "planAnswered" | "resolveStrategy">>;

/**
 * The adapter with one Course Content context supplied on every call, the way the
 * Tutor route passes a session's pinned context per request. A context passed
 * explicitly by the caller wins.
 */
export function plannerWithCourseContent(source: ContextSource, adapter = new CurriculumTutorAdapter()): CourseContentPlanner {
  const withContext = async <T extends { readonly courseContent?: TutorPlanningContentContext }>(input: T): Promise<T> =>
    input.courseContent ? input : { ...input, courseContent: (await source()) ?? undefined };
  return {
    resolveStrategy: async (input) => adapter.resolveStrategy(await withContext(input)),
    planInitial: async (input) => adapter.planInitial(await withContext(input)),
    planAnswered: async (input) => adapter.planAnswered(await withContext(input)),
    planFollowup: async (input) => adapter.planFollowup(await withContext(input)),
  };
}
