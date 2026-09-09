import { z } from "zod";
import type { TutorContentResult } from "@shared/tutor";
import { config } from "../../config";
import { Logger } from "@shared/logger";
import {
  TutorProviderError,
  type LLMProvider,
  type LLMProviderRequest,
  type ProviderQuestionResult,
} from "./llm-provider";

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.unknown(),
    }),
  })).min(1),
});

const modelsSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(128) })),
});

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

function parseTutorContent(content: string): TutorContentResult {
  const candidate = extractJsonContent(content);
  if (typeof candidate === "string") {
    const question = candidate.trim();
    if (!question || question.length > 2_000) throw new TutorProviderError("invalid-response");
    return { question };
  }
  if (typeof candidate !== "object" || candidate === null || !("question" in candidate)) {
    throw new TutorProviderError("invalid-response");
  }
  const question = parseOptionalText(candidate.question, 2_000);
  if (!question) throw new TutorProviderError("invalid-response");
  const feedback = parseOptionalText("feedback" in candidate ? candidate.feedback : undefined, 1_000);
  const topic = parseOptionalText("topic" in candidate ? candidate.topic : undefined, 120);
  const mermaid = parseOptionalText("mermaid" in candidate ? candidate.mermaid : undefined, 12_000);
  const rawDifficulty = "difficulty" in candidate ? candidate.difficulty : undefined;
  const difficulty = rawDifficulty === "basic" || rawDifficulty === "intermediate" || rawDifficulty === "advanced"
    ? rawDifficulty
    : undefined;
  return {
    question,
    ...(feedback ? { feedback } : {}),
    ...(topic ? { topic } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(mermaid ? { mermaid } : {}),
  };
}

function parseProviderQuestion(body: unknown, model: string, logger: Logger): ProviderQuestionResult {
  const parsed = completionSchema.safeParse(body);
  const content = parsed.success ? textContentFromMessage(parsed.data.choices[0].message.content) : undefined;
  if (!content) throw new TutorProviderError("invalid-response");

  try {
    return { model, result: parseTutorContent(content) };
  } catch (error) {
    if (error instanceof TutorProviderError && error.kind === "invalid-response" && config.nodeEnv === "development") {
      logger.debug(`KI:connect model content (diagnostic, no credentials): ${content.slice(0, 12_000)}`);
    }
    throw error;
  }
}

export class KiconnectProvider implements LLMProvider {
  private readonly baseUrl = config.tutor.baseUrl;
  private readonly logger = new Logger("KiconnectProvider");

  async listModels(credential: string): Promise<readonly string[]> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), config.tutor.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${credential}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw providerErrorForStatus(response.status, parseRetryAfter(response.headers.get("retry-after")));
      }
      const parsed = modelsSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.data.length === 0) {
        throw new TutorProviderError("model-unavailable");
      }
      return [...new Set(parsed.data.data.map(({ id }) => id))];
    } catch (error) {
      if (error instanceof TutorProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TutorProviderError("provider-timeout");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new TutorProviderError("provider-timeout");
      }
      throw new TutorProviderError("provider-unavailable");
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  async generateLearningQuestion(
    request: LLMProviderRequest,
    credential: string,
  ): Promise<ProviderQuestionResult> {
    const model = await this.resolveModel(request.model, credential);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), config.tutor.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw providerErrorForStatus(response.status, parseRetryAfter(response.headers.get("retry-after")));
      }

      const body = await response.json().catch(() => null);
      return parseProviderQuestion(body, model, this.logger);
    } catch (error) {
      if (error instanceof TutorProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TutorProviderError("provider-timeout");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new TutorProviderError("provider-timeout");
      }
      throw new TutorProviderError("provider-unavailable");
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private async resolveModel(model: string, credential: string): Promise<string> {
    if (model !== "auto") return model;
    const models = await this.listModels(credential);
    const modelId = models[0];
    if (!modelId) throw new TutorProviderError("model-unavailable");
    return modelId;
  }
}
