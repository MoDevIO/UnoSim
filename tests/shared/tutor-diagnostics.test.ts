import { describe, expect, it } from "vitest";
import { tutorDiagnosticEnvelopeSchema, tutorDiagnosticEventSchema } from "../../shared/tutor-diagnostics";

const traceId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const event = { version: 1, traceId, requestId, sequence: 1, timestamp: "2026-11-11T10:00:00.000Z", origin: "provider", operation: "question", stage: "parsing", outcome: "not-provided", reason: "not-provided" };

describe("bounded Tutor diagnostics", () => {
  it("accepts fixed metadata and rejects raw content and unknown codes", () => {
    expect(tutorDiagnosticEventSchema.safeParse(event).success).toBe(true);
    expect(tutorDiagnosticEventSchema.safeParse({ ...event, question: "PRIVATE_DIALOG" }).success).toBe(false);
    expect(tutorDiagnosticEventSchema.safeParse({ ...event, reason: "RAW_PROVIDER_ERROR" }).success).toBe(false);
    expect(tutorDiagnosticEventSchema.safeParse({ ...event, modelReturned: "x".repeat(2_049) }).success).toBe(false);
  });

  it("bounds event count and rejects mismatched request identities", () => {
    const envelope = { version: 1, traceId, requestId, events: [event], truncated: 0 };
    expect(tutorDiagnosticEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(tutorDiagnosticEnvelopeSchema.safeParse({ ...envelope, events: Array.from({ length: 65 }, () => event) }).success).toBe(false);
    expect(tutorDiagnosticEnvelopeSchema.safeParse({ ...envelope, events: [{ ...event, requestId: traceId }] }).success).toBe(false);
  });

  it("rejects an envelope above 32 KiB even if each event is individually valid", () => {
    const events = Array.from({ length: 64 }, (_, index) => ({ ...event, sequence: index + 1, modelRequested: "m".repeat(128), modelReturned: "r".repeat(128), diagramId: traceId, diagramType: "sequenceDiagram", chars: 12_000, durationMs: 120_000 }));
    expect(tutorDiagnosticEventSchema.safeParse(events[0]).success).toBe(true);
    expect(tutorDiagnosticEnvelopeSchema.safeParse({ version: 1, traceId, requestId, events, truncated: 0 }).success).toBe(false);
  });
});
