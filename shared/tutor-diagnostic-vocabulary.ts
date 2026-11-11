export const TUTOR_DIAGNOSTIC_STAGES = ["request", "provider", "parsing", "safety", "content", "browser", "renderer", "buffer"] as const;
export const TUTOR_DIAGNOSTIC_OUTCOMES = ["started", "completed", "failed", "aborted", "provided", "accepted", "rejected", "not-provided", "null", "empty", "unavailable", "received", "held", "displayed", "rendered", "discarded", "replayed", "truncated", "skipped"] as const;
export const TUTOR_DIAGNOSTIC_REASONS = [
  "not-provided", "null-field", "empty", "invalid-field-type", "too-long", "diagram-type-unsupported",
  "markup-disallowed", "external-content-disallowed", "directive-disallowed", "syntax-unsupported",
  "no-renderable-graph", "invalid-marker-id", "question-replaced", "support-graphics-not-supported",
  "awaiting-continue", "context-changed", "renderer-load-failed", "renderer-failed", "buffer-limit", "event-limit",
  "diagnostics-invalid", "diagnostics-disabled-by-server", "provider-timeout", "provider-unavailable", "invalid-response",
  "credential-invalid", "rate-limited", "model-unavailable", "auto-model-unavailable", "request-aborted",
  "request-failed", "model-id-not-listed", "model-id-withheld", "model-list-unavailable", "reference-only", "application-fallback", "support-cache",
] as const;

