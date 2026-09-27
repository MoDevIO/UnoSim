import type { TutorContentResult, TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import type { LLMProvider, LLMProviderRequest } from "../../../../../server/services/tutor/llm-provider";
import { TutorService } from "../../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../../server/services/tutor/curriculum-tutor-adapter";
import type { TutorPlanningContentContext, TutorPlanningExtension } from "../../../../../server/services/tutor/tutor-planning";
import type { TutorProgressionState } from "../../../../../server/services/tutor/curriculum/progression-state";

type ProviderBehavior =
  | { readonly kind: "result"; readonly result: unknown; readonly model?: string }
  | { readonly kind: "error"; readonly error: Error };

type ScenarioAction =
  | { readonly kind: "initial" }
  | {
    readonly kind: "dialog";
    readonly history?: readonly TutorDialogTurn[];
    readonly question: string;
    readonly answer: string;
  };

export interface TutorQualityScenario {
  readonly id: string;
  readonly code: string;
  readonly action: ScenarioAction;
  readonly provider: ProviderBehavior;
  readonly difficulty?: TutorDifficulty;
  readonly courseContent?: TutorPlanningContentContext;
  readonly planning?: TutorPlanningExtension;
}

export interface TutorQualityScenarioTrace {
  readonly id: string;
  readonly result?: TutorContentResult;
  readonly error?: unknown;
  readonly providerRequests: readonly LLMProviderRequest[];
  readonly stateBefore?: TutorProgressionState;
  readonly stateAfter?: TutorProgressionState;
}

export async function runTutorQualityScenario(scenario: TutorQualityScenario): Promise<TutorQualityScenarioTrace> {
  const providerRequests: LLMProviderRequest[] = [];
  const provider: LLMProvider = {
    async listModels() {
      return ["fake-model"];
    },
    async generateLearningQuestion(request) {
      providerRequests.push(request);
      if (scenario.provider.kind === "error") throw scenario.provider.error;
      return {
        model: scenario.provider.model ?? "fake-model",
        result: scenario.provider.result as TutorContentResult,
      };
    },
  };
  const stateBefore = cloneState(scenario.courseContent?.progressionState);
  const planning = scenario.planning ?? (scenario.courseContent ? new CurriculumTutorAdapter() : undefined);
  const service = new TutorService(provider, planning);
  try {
    const response = scenario.action.kind === "initial"
      ? await service.generateQuestion(
        scenario.code,
        "fake-credential",
        undefined,
        scenario.difficulty,
        scenario.courseContent,
      )
      : await service.generateDialogResponse(
        scenario.code,
        scenario.action.history ?? [],
        scenario.action.question,
        scenario.action.answer,
        "fake-credential",
        undefined,
        scenario.difficulty,
        scenario.courseContent,
      );
    return {
      id: scenario.id,
      result: response.result,
      providerRequests,
      ...(stateBefore ? { stateBefore } : {}),
      ...(scenario.courseContent?.progressionState
        ? { stateAfter: cloneState(scenario.courseContent.progressionState) }
        : {}),
    };
  } catch (error) {
    return {
      id: scenario.id,
      error,
      providerRequests,
      ...(stateBefore ? { stateBefore } : {}),
      ...(scenario.courseContent?.progressionState
        ? { stateAfter: cloneState(scenario.courseContent.progressionState) }
        : {}),
    };
  }
}

function cloneState(state: TutorProgressionState | undefined): TutorProgressionState | undefined {
  return state === undefined ? undefined : structuredClone(state);
}
