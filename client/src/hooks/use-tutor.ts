import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type TutorDialogTurn,
  tutorModelsResponseSchema,
  tutorQuestionResponseSchema,
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

export function useTutor(): TutorPanelState {
  const [config, setConfig] = useState<TutorConfig>(DEFAULT_CONFIG);
  const [credential, setCredential] = useState("");
  const [selectedModel, setSelectedModel] = useState("auto");
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

  const generateQuestion = useCallback(async (code: string) => {
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
    const requestedModel = selectedModel !== "auto" && availableModels.includes(selectedModel)
      ? selectedModel
      : undefined;
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
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body));
      const parsed = tutorQuestionResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The Tutor service returned an invalid response.");
      setQuestion(parsed.data);
      setAnswer("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The Tutor request failed.");
    } finally {
      setIsLoading(false);
    }
  }, [availableModels, config.mode, credential, selectedModel]);

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
    const requestedModel = selectedModel !== "auto" && availableModels.includes(selectedModel)
      ? selectedModel
      : undefined;
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
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body));
      const parsed = tutorQuestionResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The Tutor service returned an invalid response.");
      setHistory([
        ...currentHistory,
        {
          question: currentQuestion,
          answer: submittedAnswer,
          ...(parsed.data.feedback ? { feedback: parsed.data.feedback } : {}),
        },
      ].slice(-INPUT_LIMITS.tutor.maxHistoryEntries));
      setQuestion(parsed.data);
      setAnswer("");
    } catch (requestError) {
      // Keep the current question, answer, and history intact so a failed
      // request can be retried deliberately by the learner.
      setError(requestError instanceof Error ? requestError.message : "The Tutor request failed.");
    } finally {
      setIsLoading(false);
    }
  }, [answer, availableModels, config.mode, credential, history, question, selectedModel]);

  const resetDialog = useCallback(() => {
    setHistory([]);
    setQuestion(null);
    setAnswer("");
    setError(null);
  }, []);

  return useMemo(() => ({
    config,
    credential,
    setCredential: setTutorCredential,
    clearCredential,
    selectedModel,
    setSelectedModel,
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
  ]);
}
