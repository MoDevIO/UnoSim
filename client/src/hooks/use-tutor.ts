import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type TutorDialogTurn,
  calculateNextTutorDifficulty,
  clampTutorDifficulty,
  TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY,
  TUTOR_DEFAULT_DIFFICULTY,
  tutorDifficultySchema,
  tutorModelsResponseSchema,
  tutorQuestionResponseSchema,
  type TutorAnswerRating,
  type TutorDifficulty,
  type TutorMode,
  type TutorResponse,
} from "@shared/tutor";
import { INPUT_LIMITS } from "@shared/input-limits";

interface TutorConfig {
  readonly mode: TutorMode;
  readonly provider: string;
}

export interface TutorPanelState {
  readonly config: TutorConfig;
  readonly credential: string;
  readonly setCredential: (value: string) => void;
  readonly clearCredential: () => void;
  readonly selectedModel: string;
  readonly setSelectedModel: (value: string) => void;
  readonly lastUsedModel: string | null;
  readonly configuredDifficulty: TutorDifficulty;
  readonly effectiveDifficulty: TutorDifficulty;
  readonly setConfiguredDifficulty: (value: number) => void;
  readonly sessionRating: number | null;
  readonly ratedAnswerCount: number;
  readonly availableModels: readonly string[];
  readonly modelsLoading: boolean;
  readonly loadModels: () => Promise<void>;
  readonly question: TutorResponse | null;
  readonly history: readonly TutorDialogTurn[];
  readonly answer: string;
  readonly setAnswer: (value: string) => void;
  readonly submitAnswer: (code: string) => Promise<void>;
  readonly resetDialog: () => void;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly generateQuestion: (code: string) => Promise<void>;
}

const DEFAULT_CONFIG: TutorConfig = {
  mode: "disabled",
  provider: "kiconnect",
};

function getErrorMessage(body: unknown): string {
  const errorMessages: Record<string, string> = {
    TUTOR_DISABLED: "The Tutor feature is disabled.",
    CREDENTIAL_REQUIRED: "Enter your personal Tutor API key first.",
    CREDENTIAL_INVALID: "The Tutor access was rejected.",
    PROVIDER_UNAVAILABLE: "The Tutor service is currently unavailable.",
    PROVIDER_TIMEOUT: "The Tutor service took too long to respond.",
    RATE_LIMITED: "The Tutor request limit has been reached. Please try again later.",
    MODEL_UNAVAILABLE: "The selected Tutor model is unavailable.",
    INVALID_PROVIDER_RESPONSE: "The Tutor service returned an invalid response.",
    INVALID_REQUEST: "The Tutor request is invalid.",
  };
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "code" in body.error &&
    typeof body.error.code === "string" &&
    body.error.code in errorMessages
  ) {
    return errorMessages[body.error.code] ?? "The Tutor request failed.";
  }
  return "The Tutor request failed.";
}

function getSubmitAnswerValidationError({
  mode,
  question,
  code,
  answer,
  credential,
}: {
  mode: TutorMode;
  question: TutorResponse | null;
  code: string;
  answer: string;
  credential: string;
}): string | undefined {
  if (mode === "disabled") return "The Tutor feature is disabled.";
  if (!question) return "Generate a learning question first.";
  if (!code.trim()) return "Open a sketch with source code first.";
  if (!answer.trim()) return "Write an answer first.";
  if (mode === "user-key" && !credential.trim()) return "Enter your personal Tutor API key first.";
  return undefined;
}

function getRequestedModel(selectedModel: string, availableModels: readonly string[]): string | undefined {
  if (selectedModel === "auto") return undefined;
  return availableModels.includes(selectedModel) ? selectedModel : undefined;
}

function buildDialogTurn(
  question: string,
  answer: string,
  response: TutorResponse,
): TutorDialogTurn {
  const baseTurn = {
    question,
    answer,
    ...(response.feedback ? { feedback: response.feedback } : {}),
    ...(response.topicId ? { topicId: response.topicId } : {}),
    ...(response.conceptId ? { conceptId: response.conceptId } : {}),
    ...(response.questionId ? { questionId: response.questionId } : {}),
    ...(response.indicatorId ? { indicatorId: response.indicatorId } : {}),
    ...(response.questionKind ? { questionKind: response.questionKind } : {}),
    ...(response.strategyId ? { strategyId: response.strategyId } : {}),
    ...(response.contentRevision ? { contentRevision: response.contentRevision } : {}),
  };
  if (response.responseStyle === "philosophical") {
    return { ...baseTurn, responseStyle: "philosophical" };
  }
  return {
    ...baseTurn,
    responseStyle: "normal",
    ...(response.answerRating === undefined ? {} : { answerRating: response.answerRating }),
  };
}

function collectAnswerRatings(history: readonly TutorDialogTurn[]): readonly TutorAnswerRating[] {
  return history.flatMap((turn) => turn.answerRating === undefined ? [] : [turn.answerRating]);
}

function readConfiguredDifficulty(): TutorDifficulty {
  try {
    const stored = globalThis.localStorage?.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY);
    if (stored === null || stored === undefined) return TUTOR_DEFAULT_DIFFICULTY;
    const parsed = tutorDifficultySchema.safeParse(Number(stored));
    return parsed.success ? parsed.data : TUTOR_DEFAULT_DIFFICULTY;
  } catch {
    return TUTOR_DEFAULT_DIFFICULTY;
  }
}

function persistConfiguredDifficulty(value: TutorDifficulty): void {
  try {
    globalThis.localStorage?.setItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY, String(value));
  } catch {
    // Browser storage can be unavailable in private/restricted contexts.
  }
}

export function useTutor(): TutorPanelState {
  const [config, setConfig] = useState<TutorConfig>(DEFAULT_CONFIG);
  const [credential, setCredential] = useState("");
  const [selectedModel, setSelectedModel] = useState("auto");
  const [lastUsedModel, setLastUsedModel] = useState<string | null>(null);
  const [configuredDifficulty, setConfiguredDifficulty] = useState<TutorDifficulty>(readConfiguredDifficulty);
  const [effectiveDifficulty, setEffectiveDifficulty] = useState<TutorDifficulty>(() => configuredDifficulty);
  const [availableModels, setAvailableModels] = useState<readonly string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [question, setQuestion] = useState<TutorResponse | null>(null);
  const [history, setHistory] = useState<readonly TutorDialogTurn[]>([]);
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Tutor configuration is unavailable.");
        return response.json() as Promise<{ tutor?: Partial<TutorConfig> }>;
      })
      .then((data) => {
        if (cancelled || !data.tutor) return;
        setConfig({
          mode: data.tutor.mode ?? DEFAULT_CONFIG.mode,
          provider: data.tutor.provider ?? DEFAULT_CONFIG.provider,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setTutorCredential = useCallback((value: string) => {
    setCredential(value);
    setAvailableModels([]);
    setSelectedModel("auto");
  }, []);

  const clearCredential = useCallback(() => setTutorCredential(""), [setTutorCredential]);

  const loadModels = useCallback(async () => {
    setError(null);
    if (config.mode === "disabled") {
      setError("The Tutor feature is disabled.");
      return;
    }
    if (config.mode === "user-key" && !credential.trim()) {
      setError("Enter your personal Tutor API key first.");
      return;
    }

    setModelsLoading(true);
    try {
      const response = await fetch("/api/tutor/models", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config.mode === "user-key" ? { credential } : {}),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body));
      const parsed = tutorModelsResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The Tutor service returned an invalid model list.");
      setAvailableModels(parsed.data.models);
      setSelectedModel((current) => current === "auto" || parsed.data.models.includes(current) ? current : "auto");
    } catch (requestError) {
      setAvailableModels([]);
      setSelectedModel("auto");
      setError(requestError instanceof Error ? requestError.message : "The Tutor models could not be loaded.");
    } finally {
      setModelsLoading(false);
    }
  }, [config.mode, credential]);

  const requestQuestion = useCallback(async (code: string, requestDifficulty: TutorDifficulty) => {
    setError(null);
    if (config.mode === "disabled") {
      setError("The Tutor feature is disabled.");
      return;
    }
    if (!code.trim()) {
      setError("Open a sketch with source code first.");
      return;
    }
    if (config.mode === "user-key" && !credential.trim()) {
      setError("Enter your personal Tutor API key first.");
      return;
    }
    const requestedModel = getRequestedModel(selectedModel, availableModels);
    if (selectedModel !== "auto" && !requestedModel) setSelectedModel("auto");

    setIsLoading(true);
    try {
      const response = await fetch("/api/tutor/question", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...(config.mode === "user-key" ? { credential } : {}),
          ...(requestedModel ? { model: requestedModel } : {}),
          difficulty: requestDifficulty,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body));
      const parsed = tutorQuestionResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The Tutor service returned an invalid response.");
      setQuestion(parsed.data);
      setLastUsedModel(parsed.data.model);
      setAnswer("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The Tutor request failed.");
    } finally {
      setIsLoading(false);
    }
  }, [availableModels, config.mode, credential, selectedModel]);

  const resetDialog = useCallback(() => {
    setHistory([]);
    setQuestion(null);
    setAnswer("");
    setError(null);
    setEffectiveDifficulty(configuredDifficulty);
  }, [configuredDifficulty]);

  const generateQuestion = useCallback(async (code: string) => {
    if (question !== null || history.length > 0) {
      resetDialog();
      await requestQuestion(code, configuredDifficulty);
      return;
    }
    await requestQuestion(code, effectiveDifficulty);
  }, [configuredDifficulty, effectiveDifficulty, history.length, question, requestQuestion, resetDialog]);

  const submitAnswer = useCallback(async (code: string) => {
    setError(null);
    const validationError = getSubmitAnswerValidationError({
      mode: config.mode,
      question,
      code,
      answer,
      credential,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!question) return;
    const requestedModel = getRequestedModel(selectedModel, availableModels);
    if (selectedModel !== "auto" && !requestedModel) setSelectedModel("auto");
    const submittedAnswer = answer.trim();
    const currentQuestion = question.question;
    const currentHistory = history;

    setIsLoading(true);
    try {
      const response = await fetch("/api/tutor/dialog", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          history: currentHistory,
          question: currentQuestion,
          answer: submittedAnswer,
          ...(config.mode === "user-key" ? { credential } : {}),
          ...(requestedModel ? { model: requestedModel } : {}),
          difficulty: effectiveDifficulty,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body));
      const parsed = tutorQuestionResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The Tutor service returned an invalid response.");
      const nextHistory = [
        ...currentHistory,
        buildDialogTurn(currentQuestion, submittedAnswer, parsed.data),
      ].slice(-INPUT_LIMITS.tutor.maxHistoryEntries);
      setHistory(nextHistory);
      if (parsed.data.responseStyle === "normal" && parsed.data.answerRating !== undefined) {
        const ratings = collectAnswerRatings(nextHistory);
        setEffectiveDifficulty((current) => calculateNextTutorDifficulty(current, ratings));
      }
      setQuestion(parsed.data);
      if (parsed.data.responseStyle === "normal") setLastUsedModel(parsed.data.model);
      setAnswer("");
    } catch (requestError) {
      // Keep the current question, answer, and history intact so a failed
      // request can be retried deliberately by the learner.
      setError(requestError instanceof Error ? requestError.message : "The Tutor request failed.");
    } finally {
      setIsLoading(false);
    }
  }, [answer, availableModels, config.mode, credential, effectiveDifficulty, history, question, selectedModel]);

  const updateConfiguredDifficulty = useCallback((value: number) => {
    const nextDifficulty = clampTutorDifficulty(value);
    setConfiguredDifficulty(nextDifficulty);
    persistConfiguredDifficulty(nextDifficulty);
    if (history.length === 0 && question === null) setEffectiveDifficulty(nextDifficulty);
  }, [history.length, question]);

  const { sessionRating, ratedAnswerCount } = useMemo(() => {
    const ratings = history.flatMap((turn) => turn.answerRating === undefined ? [] : [turn.answerRating]);
    if (ratings.length === 0) return { sessionRating: null, ratedAnswerCount: 0 };
    return {
      sessionRating: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
      ratedAnswerCount: ratings.length,
    };
  }, [history]);

  return useMemo(() => ({
    config,
    credential,
    setCredential: setTutorCredential,
    clearCredential,
    selectedModel,
    setSelectedModel,
    lastUsedModel,
    configuredDifficulty,
    effectiveDifficulty,
    setConfiguredDifficulty: updateConfiguredDifficulty,
    sessionRating,
    ratedAnswerCount,
    availableModels,
    modelsLoading,
    loadModels,
    question,
    history,
    answer,
    setAnswer,
    submitAnswer,
    resetDialog,
    isLoading,
    error,
    generateQuestion,
  }), [
    config,
    credential,
    clearCredential,
    error,
    generateQuestion,
    loadModels,
    isLoading,
    modelsLoading,
    question,
    history,
    answer,
    submitAnswer,
    resetDialog,
    selectedModel,
    setTutorCredential,
    availableModels,
    lastUsedModel,
    configuredDifficulty,
    effectiveDifficulty,
    updateConfiguredDifficulty,
    sessionRating,
    ratedAnswerCount,
  ]);
}
