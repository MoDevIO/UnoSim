import { z } from "zod";
import { boundedArray } from "./bounded-array";

export const TUTOR_DIAGNOSTIC_LIMITS = { events: 64, envelopeBytes: 32_768, eventBytes: 2_048 } as const;
export { describeTutorDiagnostic } from "./tutor-diagnostic-description";
import { TUTOR_DIAGNOSTIC_STAGES, TUTOR_DIAGNOSTIC_OUTCOMES, TUTOR_DIAGNOSTIC_REASONS } from "./tutor-diagnostic-vocabulary";
const smallNumber = z.number().int().min(0).max(1_000_000_000);
const model = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
export const diagnosticBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

export const tutorDiagnosticEventSchema = z.object({
  version: z.literal(1), traceId: z.uuid(), requestId: z.uuid(), sequence: smallNumber,
  timestamp: z.iso.datetime(), origin: z.enum(["provider", "service", "frontend", "renderer"]),
  operation: z.enum(["question", "answer", "support", "models"]),
  stage: z.enum(TUTOR_DIAGNOSTIC_STAGES), outcome: z.enum(TUTOR_DIAGNOSTIC_OUTCOMES),
  reason: z.enum(TUTOR_DIAGNOSTIC_REASONS).optional(),
  diagramId: z.uuid().optional(), diagramType: z.enum(["flowchart", "graph", "stateDiagram-v2", "sequenceDiagram", "unknown"]).optional(),
  providerAttempt: smallNumber.optional(), statusCode: z.number().int().min(100).max(599).optional(),
  durationMs: smallNumber.optional(), chars: smallNumber.optional(), nodes: smallNumber.optional(), edges: smallNumber.optional(),
  modelRequested: model.optional(), modelReturned: model.optional(),
  source: z.enum(["provider", "planner", "application-fallback", "support-cache"]).optional(),
  dropped: smallNumber.optional(),
}).strict().refine((event) => diagnosticBytes(event) <= TUTOR_DIAGNOSTIC_LIMITS.eventBytes);
export type TutorDiagnosticEvent = z.infer<typeof tutorDiagnosticEventSchema>;
export type TutorDiagnosticData = Omit<TutorDiagnosticEvent, "version" | "traceId" | "requestId" | "sequence" | "timestamp" | "operation">;

const OPERATION_BY_PATH_SUFFIX: ReadonlyArray<readonly [string, TutorDiagnosticEvent["operation"]]> = [
  ["/models", "models"], ["/dialog", "answer"], ["/support", "support"],
];

/** The Tutor endpoint a request path addresses; everything else asks for a question. */
export function tutorDiagnosticOperation(path: string): TutorDiagnosticEvent["operation"] {
  return OPERATION_BY_PATH_SUFFIX.find(([suffix]) => path.endsWith(suffix))?.[1] ?? "question";
}

export const tutorDiagnosticEnvelopeSchema = z.object({
  version: z.literal(1), traceId: z.uuid(), requestId: z.uuid(),
  events: boundedArray(tutorDiagnosticEventSchema, TUTOR_DIAGNOSTIC_LIMITS.events), truncated: smallNumber,
}).strict().superRefine((envelope, ctx) => {
  if (diagnosticBytes(envelope) > TUTOR_DIAGNOSTIC_LIMITS.envelopeBytes || envelope.events.some((event, index) =>
    event.traceId !== envelope.traceId || event.requestId !== envelope.requestId || (index > 0 && event.sequence <= envelope.events[index - 1].sequence))) {
    ctx.addIssue({ code: "custom", message: "Invalid diagnostic envelope" });
  }
});
export type TutorDiagnosticEnvelope = z.infer<typeof tutorDiagnosticEnvelopeSchema>;

