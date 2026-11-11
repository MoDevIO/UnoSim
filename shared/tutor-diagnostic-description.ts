import type { TutorDiagnosticEvent } from "./tutor-diagnostics";

export function describeTutorDiagnostic(event: TutorDiagnosticEvent): string {
  const reason = event.reason ? ` (${event.reason})` : "";
  return `${event.stage}: ${event.outcome}${reason}`;
}
