import type { DebugMessage } from "@/hooks/use-debug-console";
import { describeTutorDiagnostic } from "@shared/tutor-diagnostic-description";

export interface DebugFilter { type?: string; category?: string; query?: string; stage?: string; outcome?: string; reason?: string }
export function decodeDebugFilter(value: string): DebugFilter {
  if (!value.startsWith("{")) return { type: value };
  try {
    const candidate: unknown = JSON.parse(value.slice(0, 1_024));
    if (typeof candidate !== "object" || candidate === null) return {};
    return Object.fromEntries(Object.entries(candidate).filter(([key, item]) =>
      ["type", "category", "query", "stage", "outcome", "reason"].includes(key) && typeof item === "string" && item.length <= 128));
  } catch { return {}; }
}
export function tutorMessageDetails(message: DebugMessage) {
  return message.category === "tutor" ? message.details : undefined;
}
export function debugMessageContent(message: DebugMessage): string {
  if (message.category !== "tutor") return message.content;
  const event = tutorMessageDetails(message);
  return event ? describeTutorDiagnostic(event) : "diagnostics-invalid";
}
export function filterDebugMessages(messages: readonly DebugMessage[], value: string): DebugMessage[] {
  const filter = decodeDebugFilter(value);
  const query = filter.query?.toLowerCase() ?? "";
  return messages.filter((message) => {
    if (filter.type && message.type.toLowerCase() !== filter.type.toLowerCase()) return false;
    if (filter.category && message.category !== filter.category) return false;
    const details = tutorMessageDetails(message);
    if (filter.stage && details?.stage !== filter.stage) return false;
    if (filter.outcome && details?.outcome !== filter.outcome) return false;
    if (filter.reason && details?.reason !== filter.reason) return false;
    return !query || `${message.type} ${debugMessageContent(message)} ${details ? JSON.stringify(details) : ""}`.toLowerCase().includes(query);
  });
}
export function formatDebugMessages(messages: readonly DebugMessage[]): string {
  return messages.map((message) => {
    const details = tutorMessageDetails(message);
    const detailText = details ? ` ${JSON.stringify(details)}` : "";
    return `[${message.timestamp.toLocaleTimeString()}] ${message.sender.toUpperCase()} (${message.type}): ${debugMessageContent(message)}${detailText}`;
  }).join("\n");
}
