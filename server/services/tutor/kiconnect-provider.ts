import { z } from "zod";
import { tutorDifficultySchema, tutorAnswerRatingSchema, tutorResponseStyleSchema, type TutorContentResult } from "@shared/tutor";
import { config } from "../../config";
import { Logger } from "@shared/logger";
import {
  TutorProviderError,
  type LLMProvider,
  type LLMProviderRequest,
  type ProviderQuestionResult,
  type ProviderStructuredResult,
  type StructuredLLMProvider,
  type StructuredLLMProviderRequest,
} from "./llm-provider";
import { rankTutorModels } from "./model-preference";

export const TUTOR_TEMPERATURE = 0.2;

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
    return { question, responseStyle: "normal" };
  }
  if (typeof candidate !== "object" || candidate === null || !("question" in candidate)) {
    throw new TutorProviderError("invalid-response");
  }
  return parseTutorContentObject(candidate);
}

function parseProviderQuestion(body: unknown, logger: Logger): ProviderQuestionResult {
  const parsed = completionSchema.safeParse(body);
  if (!parsed.success || !parsed.data.model) throw new TutorProviderError("invalid-response");
  const content = textContentFromMessage(parsed.data.choices[0].message.content);
  if (!content) throw new TutorProviderError("invalid-response");

  try {
    return { model: parsed.data.model, result: parseTutorContent(content) };
  } catch (error) {
    if (error instanceof TutorProviderError && error.kind === "invalid-response" && config.nodeEnv === "development") {
      logger.debug(`KI:connect model content (diagnostic, no credentials): ${content.slice(0, 12_000)}`);
    }
    throw error;
  }
}

export class KiconnectProvider implements LLMProvider, StructuredLLMProvider {
  private readonly baseUrl = config.tutor.baseUrl;
  private readonly logger = new Logger("KiconnectProvider");

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
      return [...new Set(parsed.data.data.map(({ id }) => id))];
    });
  }

  async generateLearningQuestion(
    request: LLMProviderRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<ProviderQuestionResult> {
    const model = await this.resolveModel(request.model, credential, signal);
    const body = await this.requestChatCompletion({
      model,
      temperature: TUTOR_TEMPERATURE,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    }, credential, signal);
    return parseProviderQuestion(body, this.logger);
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
    const modelId = rankTutorModels(await this.listModels(credential, signal))[0];
    if (!modelId) throw new TutorProviderError("model-unavailable");
    return modelId;
  }
}
