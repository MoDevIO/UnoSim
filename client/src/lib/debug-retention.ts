import type { DebugMessage } from "@/hooks/use-debug-console";
export function retainTutorDebugMessages(messages: DebugMessage[]): DebugMessage[] {
  return messages.filter((message) => message.category === "tutor");
}
