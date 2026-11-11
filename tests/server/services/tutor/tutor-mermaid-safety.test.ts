import { describe, expect, it } from "vitest";
import { validateLearningQuestion } from "../../../../server/services/tutor/tutor-service";

describe("shared Tutor graphic policy", () => {
  it.each([
    "flowchart LR\nA -->|click| B",
    "flowchart LR\nA{x<b && c>d} --> B[Ende]",
  ])("preserves safe graphic labels in the server result: %s", (mermaid) => {
    expect(validateLearningQuestion({ question: "Welche Verbindung ist entscheidend?", mermaid }).mermaid).toBe(mermaid);
  });

  it.each([
    "flowchart LR\nA --> B\nclick A callback",
    "flowchart LR\nA[<svg onload=alert(1)>] --> B",
    "flowchart LR\nA --> B\n%%{init: {}}%%",
    "flowchart LR\nA[https://example.invalid] --> B",
  ])("drops unsafe graphics and retains the question: %s", (mermaid) => {
    expect(validateLearningQuestion({ question: "Welche Verbindung ist entscheidend?", mermaid })).toEqual({
      question: "Welche Verbindung ist entscheidend?", responseStyle: "normal",
    });
  });
});
