import type { TutorContentResult } from "@shared/tutor";

export interface LLMProviderRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface ProviderQuestionResult {
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
  listModels(credential: string, signal?: AbortSignal): Promise<readonly string[]>;
  generateLearningQuestion(
    request: LLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderQuestionResult>;
}
