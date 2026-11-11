import { beginTutorProviderAttempt, reportTutorDiagnostic, reportTutorMermaidField, reportTutorModel, reportTutorModelList, reportTutorReviewDraft } from "./tutor-diagnostics";
import { z } from "zod";
import { tutorDifficultySchema, tutorAnswerRatingSchema, tutorResponseStyleSchema, type TutorContentResult } from "@shared/tutor";
import { config } from "../../config";
import {
  TutorProviderError,
  type LLMProvider,
  type LLMProviderRequest,
  type ProviderQuestionResult,
  type ProviderStructuredResult,
  type StructuredLLMProvider,
  type StructuredLLMProviderRequest,
} from "./llm-provider";
import { automaticTutorModels } from "./model-preference";
import { tutorTemperatureFor } from "./model-profile";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function withProviderTimeout<T>(
  requestSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  requestSignal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abortFromRequest = () => controller.abort(requestSignal?.reason);
  requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.tutor.timeoutMs);

  try {
    const result = await operation(controller.signal);
    requestSignal?.throwIfAborted();
    return result;
  } catch (error) {
    if (requestSignal?.aborted) throw requestSignal.reason ?? error;
    if (error instanceof TutorProviderError) throw error;
    if (timedOut || isAbortError(error)) throw new TutorProviderError("provider-timeout");
    throw new TutorProviderError("provider-unavailable");
  } finally {
    globalThis.clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}

const completionChoicesSchema = z.array(z.object({
  message: z.object({
    content: z.unknown(),
  }),
})).min(1);

const completionSchema = z.object({
  model: z.string().min(1).optional(),
  choices: completionChoicesSchema,
});

const structuredCompletionSchema = z.object({
  model: z.string().min(1).optional(),
  choices: completionChoicesSchema,
});

const modelsSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(128) })),
});

interface ChatCompletionRequestBody {
  readonly model: string;
  readonly temperature: number;
  readonly messages: readonly [
    { readonly role: "system"; readonly content: string },
    { readonly role: "user"; readonly content: string },
  ];
  readonly response_format?: { readonly type: "json_object" };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1_000));
  return undefined;
}

function providerErrorForStatus(status: number, retryAfter: number | undefined): TutorProviderError {
  if (status === 401 || status === 403) return new TutorProviderError("credential-invalid");
  if (status === 404) return new TutorProviderError("model-unavailable");
  if (status === 429) return new TutorProviderError("rate-limited", retryAfter);
  if (status >= 500) return new TutorProviderError("provider-unavailable");
  return new TutorProviderError("invalid-response");
}

function extractJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const openingFence = trimmed.indexOf("```");
  const openingLineEnd = openingFence >= 0 ? trimmed.indexOf("\n", openingFence + 3) : -1;
  let openingLanguage = "";
  if (openingFence >= 0) {
    const openingEnd = openingLineEnd >= 0 ? openingLineEnd : trimmed.length;
    openingLanguage = trimmed.slice(openingFence + 3, openingEnd).trim();
  }
  let contentStart = openingFence + 3 + openingLanguage.length;
  if (openingLineEnd >= 0) contentStart = openingLineEnd + 1;
  const closingFence = openingFence >= 0 ? trimmed.indexOf("```", contentStart) : -1;
  const withoutFence = openingLanguage.toLowerCase() === "json" && closingFence >= 0
    ? trimmed.slice(contentStart, closingFence).trim()
    : trimmed;
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) return withoutFence;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return withoutFence;
    }
  }
}

function textContentFromMessage(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
      return part.text;
    }
    return "";
  }).join("").trim();
  return text || undefined;
}

function parseOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

function candidateValue(candidate: Record<string, unknown>, key: string): unknown {
  return candidate[key];
}

function parseOptionalDifficulty(value: unknown): TutorContentResult["difficulty"] {
  const numericValue = typeof value === "string" ? Number(value.trim()) : value;
  return tutorDifficultySchema.safeParse(numericValue).success ? numericValue as number : undefined;
}

function parseOptionalAnswerRating(value: unknown): TutorContentResult["answerRating"] {
  const numericValue = typeof value === "string" ? Number(value.trim()) : value;
  return tutorAnswerRatingSchema.safeParse(numericValue).success ? numericValue as number : undefined;
}

function parseOptionalResponseStyle(value: unknown): TutorContentResult["responseStyle"] | undefined {
  return tutorResponseStyleSchema.safeParse(value).success ? value as TutorContentResult["responseStyle"] : undefined;
}

function parseTutorContentObject(candidate: Record<string, unknown>): TutorContentResult {
  const question = parseOptionalText(candidateValue(candidate, "question"), 2_000);
  if (!question) throw new TutorProviderError("invalid-response");
  const feedback = parseOptionalText(candidateValue(candidate, "feedback"), 1_000);
  const topic = parseOptionalText(candidateValue(candidate, "topic"), 120);
  reportTutorMermaidField(candidateValue(candidate, "mermaid"));
  const mermaid = parseOptionalText(candidateValue(candidate, "mermaid"), 12_000);
  const difficulty = parseOptionalDifficulty(candidateValue(candidate, "difficulty"));
  const answerRating = parseOptionalAnswerRating(candidateValue(candidate, "answerRating"));
  const responseStyle = parseOptionalResponseStyle(candidateValue(candidate, "responseStyle"));
  if (responseStyle === "philosophical" && answerRating !== undefined) {
    throw new TutorProviderError("invalid-response");
  }
  const commonResult = {
    question,
    ...(feedback ? { feedback } : {}),
    ...(topic ? { topic } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(mermaid ? { mermaid } : {}),
  };
  if (responseStyle === "philosophical") {
    return { ...commonResult, responseStyle: "philosophical" };
  }
  return {
    ...commonResult,
    responseStyle: "normal",
    ...(answerRating === undefined ? {} : { answerRating }),
  };
}

function parseTutorContent(content: string): TutorContentResult {
  const candidate = extractJsonContent(content);
  if (typeof candidate === "string") {
    const question = candidate.trim();
    if (!question || question.length > 2_000) throw new TutorProviderError("invalid-response");
    reportTutorMermaidField(undefined);
    return { question, responseStyle: "normal" };
  }
  if (typeof candidate !== "object" || candidate === null || !("question" in candidate)) {
    throw new TutorProviderError("invalid-response");
  }
  return parseTutorContentObject(candidate);
}

/** The normalized fields of a provider result for the review block; never the raw body. */
function reviewDraftOf(result: TutorContentResult) {
  return {
    responseStyle: result.responseStyle,
    question: result.question,
    ...(result.feedback ? { feedback: result.feedback } : {}),
    ...(result.responseStyle === "normal" && result.answerRating !== undefined ? { answerRating: result.answerRating } : {}),
    ...(result.topic ? { topic: result.topic } : {}),
    ...(result.difficulty ? { difficulty: result.difficulty } : {}),
    ...(result.mermaid ? { mermaid: result.mermaid } : {}),
  };
}

function parseProviderQuestion(body: unknown): ProviderQuestionResult {
  const parsed = completionSchema.safeParse(body);
  if (!parsed.success || !parsed.data.model) throw new TutorProviderError("invalid-response");
  const content = textContentFromMessage(parsed.data.choices[0].message.content);
  if (!content) throw new TutorProviderError("invalid-response");

  return { model: parsed.data.model, result: parseTutorContent(content) };
}

export class KiconnectProvider implements LLMProvider, StructuredLLMProvider {
  private readonly baseUrl = config.tutor.baseUrl;

  async listModels(credential: string, signal?: AbortSignal): Promise<readonly string[]> {
    return withProviderTimeout(signal, async (providerSignal) => {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${credential}` },
        signal: providerSignal,
      });
      if (!response.ok) {
        throw providerErrorForStatus(response.status, parseRetryAfter(response.headers.get("retry-after")));
      }
      const parsed = modelsSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.data.length === 0) {
        throw new TutorProviderError("model-unavailable");
      }
      const models = [...new Set(parsed.data.data.map(({ id }) => id))];
      reportTutorModelList(models);
      return models;
    });
  }

  async generateLearningQuestion(
    request: LLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderQuestionResult> {
    const model = await this.resolveModel(request.model, credential, signal);
    beginTutorProviderAttempt();
    reportTutorModel(model);
    try {
    const body = await this.requestChatCompletion({
      model,
      temperature: tutorTemperatureFor(model),
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    }, credential, signal);
    const result = parseProviderQuestion(body);
    reportTutorModel(model, result.model);
    reportTutorReviewDraft(reviewDraftOf(result.result));
    return result;
    } catch (error) {
      reportTutorDiagnostic({ origin: "provider", stage: "provider", outcome: "failed", reason: error instanceof TutorProviderError ? error.kind : "provider-unavailable" });
      reportTutorDiagnostic({ origin: "provider", stage: "parsing", outcome: "unavailable" });
      throw error;
    }
  }

  async generateStructuredResponse(
    request: StructuredLLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderStructuredResult> {
    const body = await this.requestChatCompletion({
      model: request.model,
      temperature: request.temperature,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      response_format: { type: "json_object" },
    }, credential, signal);

    const parsed = structuredCompletionSchema.safeParse(body);
    if (!parsed.success) throw new TutorProviderError("invalid-response");

    const content = textContentFromMessage(parsed.data.choices[0].message.content);
    if (!content) throw new TutorProviderError("invalid-response");

    let result: unknown;
    try {
      result = JSON.parse(content);
    } catch {
      throw new TutorProviderError("invalid-response");
    }

    return { model: parsed.data.model, result };
  }

  private async requestChatCompletion(
    requestBody: ChatCompletionRequestBody,
    credential: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return withProviderTimeout(signal, async (providerSignal) => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify(requestBody),
        signal: providerSignal,
      });
      if (!response.ok) {
        throw providerErrorForStatus(response.status, parseRetryAfter(response.headers.get("retry-after")));
      }
      return await response.json().catch(() => null);
    });
  }

  private async resolveModel(model: string, credential: string, signal?: AbortSignal): Promise<string> {
    if (model !== "auto") return model;
    const modelId = automaticTutorModels(await this.listModels(credential, signal), config.tutor.autoModels)[0];
    // No approved model is offered: Automatic never falls back to an unapproved one (LearningQuestions 7.3).
    if (!modelId) throw new TutorProviderError("auto-model-unavailable");
    return modelId;
  }
}
