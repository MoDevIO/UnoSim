import { describe, expect, it } from "vitest";
import {
  createFrozenPreTurnContext,
  validateFrozenPreTurnContext,
} from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";
import { deepFreeze } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-canonical";
import { INPUT_PULLUP_QUESTION, validFrozenPreTurnContextInput } from "./semantic-test-fixtures";

describe("Frozen Pre-Turn Context", () => {
  it("binds the synthetic answer to the exact declared preceding question", () => {
    const context = createFrozenPreTurnContext(validFrozenPreTurnContextInput());

    expect(validateFrozenPreTurnContext(context)).toMatchObject({ valid: true, context: { digest: context.digest } });
    expect(context.learnerAnswer.bindsToQuestion).toBe(INPUT_PULLUP_QUESTION);
  });

  it("rejects an answer silently rebound to another question", () => {
    const context = createFrozenPreTurnContext(validFrozenPreTurnContextInput());
    const invalid = { ...context, learnerAnswer: { ...context.learnerAnswer, bindsToQuestion: "Welche Farbe hat die LED?" } };

    expect(validateFrozenPreTurnContext(invalid)).toMatchObject({ valid: false });
  });

  it("preserves ordered prior dialog and detects every material context change", () => {
    const context = createFrozenPreTurnContext({
      ...validFrozenPreTurnContextInput(),
      priorDialog: [
        { question: "Erste Frage?", answer: "Erste Antwort.", responseStyle: "normal" },
        { question: "Zweite Frage?", answer: "Zweite Antwort.", responseStyle: "normal" },
      ],
    });
    const reordered = createFrozenPreTurnContext({ ...context, priorDialog: [...context.priorDialog].reverse(), digest: undefined });
    const changedDifficulty = createFrozenPreTurnContext({ ...context, difficulty: 31, digest: undefined });
    const changedSketch = createFrozenPreTurnContext({ ...context, sketchDigest: "f".repeat(64), digest: undefined });

    expect(reordered.digest).not.toBe(context.digest);
    expect(changedDifficulty.digest).not.toBe(context.digest);
    expect(changedSketch.digest).not.toBe(context.digest);
    expect(validateFrozenPreTurnContext({ ...context, digest: "0".repeat(64) })).toMatchObject({ valid: false });
  });

  it("rejects divergent frozen contexts instead of repairing them", () => {
    const left = createFrozenPreTurnContext(validFrozenPreTurnContextInput());
    const right = createFrozenPreTurnContext({ ...validFrozenPreTurnContextInput(), question: "A different question?", learnerAnswer: { ...validFrozenPreTurnContextInput().learnerAnswer, bindsToQuestion: "A different question?" } });

    expect(left.digest).not.toBe(right.digest);
    expect(validateFrozenPreTurnContext(right)).toMatchObject({ valid: true });
    expect(validateFrozenPreTurnContext({ ...right, digest: left.digest })).toMatchObject({ valid: false });
  });

  it("recursively freezes nested values even when a prior dialog turn is already shallow-frozen", () => {
    const turn = Object.freeze({
      question: "Which topic was mastered?",
      answer: "Timing.",
      responseStyle: "normal" as const,
      masteredTopicIds: ["timing"],
    });
    const context = createFrozenPreTurnContext({
      ...validFrozenPreTurnContextInput(),
      priorDialog: [turn],
    });

    expect(Object.isFrozen(context.priorDialog[0])).toBe(true);
    expect(Object.isFrozen(context.priorDialog[0]?.masteredTopicIds)).toBe(true);
  });

  it("recursively freezes descendants of any already-frozen object", () => {
    const nested = [] as string[];
    const frozenParent = Object.freeze({ nested });

    deepFreeze(frozenParent);

    expect(Object.isFrozen(nested)).toBe(true);
  });
});
