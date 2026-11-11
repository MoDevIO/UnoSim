import { rejectTutorDiagnosticResponse, bindTutorDiagnosticResponse, tutorDiagnosticFetch } from "./tutor-diagnostics";
import { tutorSupportResponseSchema, type TutorSupportResponse } from "@shared/tutor-support";
import type { TutorResponse } from "@shared/tutor";
import type { TutorTranscriptContent } from "@/hooks/use-tutor";

/**
 * Sends one support action (`POST /api/tutor/support`, LearningQuestions 9.1) and checks the response.
 * Loaded with the first support action; the page's start does not need it.
 */
export async function sendTutorSupportAction(
  body: Record<string, unknown>,
  signal: AbortSignal,
  failure: (body: unknown) => Error,
  diagnosticTraceId?: string,
): Promise<TutorSupportResponse | null> {
  const response = await tutorDiagnosticFetch("/api/tutor/support", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  }, { traceId: diagnosticTraceId });
  const payload: unknown = await response.json().catch(() => null);
  if (signal.aborted) return null;
  if (!response.ok) throw failure(payload);
  const parsed = tutorSupportResponseSchema.safeParse(payload);
  if (!parsed.success) { rejectTutorDiagnosticResponse(payload); throw new Error("Der Tutor-Dienst hat eine ungültige Antwort geliefert."); }
  bindTutorDiagnosticResponse(payload, parsed.data);
  return parsed.data;
}

/** What the learner sees of a support result, and the question that follows a skip. */
export function supportOutcome(result: TutorSupportResponse, question: string): {
  readonly entry: TutorTranscriptContent;
  readonly next?: TutorResponse | null;
} {
  switch (result.action) {
    case "clarify":
      return { entry: { kind: "clarification", question, text: result.explanation ?? "" } };
    case "hint":
      return { entry: { kind: "hint", question, text: result.explanation ?? "" } };
    case "reveal":
      return { entry: { kind: "reference", question, reference: result.reference ?? { status: "unavailable", reason: "no-reference" } } };
    case "skip": {
      const next = result.next ? { ...result.next, provider: result.provider, model: result.model, ...(result.support ? { support: result.support } : {}) } : null;
      if (next && result.next) bindTutorDiagnosticResponse(result.next, next);
      return {
        entry: { kind: "skip", question },
        next,
      };
    }
  }
}
