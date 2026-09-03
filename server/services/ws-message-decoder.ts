import { clientToServerWSMessageSchema, type ClientToServerWSMessage } from "@shared/schema";

export function decodeClientMessage(text: string): ClientToServerWSMessage | null {
  try {
    const result = clientToServerWSMessageSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
