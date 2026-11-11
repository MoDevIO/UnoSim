import { describe, expect, it } from "vitest";
import { filterDebugMessages, formatDebugMessages } from "@/lib/debug-messages";
import { retainTutorDebugMessages } from "@/lib/debug-retention";
import type { DebugMessage } from "@/hooks/use-debug-console";

const id = "11111111-1111-4111-8111-111111111111";
const graphic: DebugMessage = {
  id: "1", timestamp: new Date("2026-11-11T10:00:00Z"), sender: "server", protocol: "http", type: "tutor.parsing", category: "tutor", content: "RAW_CONTENT_MUST_NOT_BE_USED",
  details: { version: 1, traceId: id, requestId: id, sequence: 1, timestamp: "2026-11-11T10:00:00.000Z", origin: "provider", operation: "question", stage: "parsing", outcome: "not-provided", reason: "not-provided" },
};
const compile: DebugMessage = { id: "2", timestamp: graphic.timestamp, sender: "frontend", type: "compile", content: "Compiling", protocol: "http" };

describe("Debug filtering, copying and retention", () => {
  it("keeps the existing type filter and adds Tutor category and ID search", () => {
    const messages = [graphic, compile];
    expect(filterDebugMessages(messages, "compile")).toEqual([compile]);
    expect(filterDebugMessages(messages, JSON.stringify({ category: "tutor", query: id, stage: "parsing" }))).toEqual([graphic]);
    expect(filterDebugMessages(messages, JSON.stringify({ category: "tutor", query: "no-match" }))).toEqual([]);
  });
  it("exports validated Tutor details and never a raw message summary", () => {
    const copied = formatDebugMessages([graphic]);
    expect(copied).toContain(id);
    expect(copied).toContain('"reason":"not-provided"');
    expect(copied).not.toContain("RAW_CONTENT_MUST_NOT_BE_USED");
  });
  it("preserves only Tutor messages on automatic compile reset", () => {
    expect(retainTutorDebugMessages([graphic, compile])).toEqual([graphic]);
  });
});
