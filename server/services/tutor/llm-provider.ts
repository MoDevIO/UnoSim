import type { TutorContentResult } from "@shared/tutor";

export interface LLMProviderRequest {
  /** Called after alias/automatic selection with the callable ID actually sent, not response metadata. */
  readonly onModelSelected?: (model: string) => void;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface ProviderQuestionResult {
  /** Untrusted model proposal, isolated from valid learning content. */
  readonly diagramProposal?: unknown;
  readonly model: string;
  readonly result: TutorContentResult;
}

export interface StructuredLLMProviderRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly temperature: number;
}

export interface ProviderStructuredResult {
  readonly model: string | undefined;
  readonly result: unknown;
}

export interface StructuredLLMProvider {
  generateStructuredResponse(
    request: StructuredLLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderStructuredResult>;
}

export type TutorProviderErrorKind =
  | "credential-invalid"
  | "provider-unavailable"
  | "provider-timeout"
  | "rate-limited"
  | "model-unavailable"
  /** `Automatic` has no approved model the provider offers; a manual choice still works. */
  | "auto-model-unavailable"
  | "invalid-response";

export class TutorProviderError extends Error {
  constructor(
    readonly kind: TutorProviderErrorKind,
    readonly retryAfter?: number,
  ) {
    super(kind);
    this.name = "TutorProviderError";
  }
}

export interface LLMProvider {
  /** One graphic-only generation, counted as a Tutor call rather than a Judge call. */
  generateGraphic?(request: LLMProviderRequest, credential: string, signal?: AbortSignal): Promise<ProviderStructuredResult>;
  listModels(credential: string, signal?: AbortSignal): Promise<readonly string[]>;
  generateLearningQuestion(
    request: LLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderQuestionResult>;
}
