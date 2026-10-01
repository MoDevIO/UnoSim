import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildJudgeInput,
  buildJudgePrompt,
  parseJudgeResult,
  type TutorQualityJudgeInput,
} from "../../../../../server/services/tutor/evaluation/judge";

const judgeInput: TutorQualityJudgeInput = {
  sketch: "int counter = 3;",
  facts: ["counter starts at three"],
  question: "What is counter?",
  learnerAnswer: "It is three.",
  tutor: {
    feedback: "Correct, counter starts at three.",
    followUpQuestion: "What changes counter?",
    answerRating: 5,
    learningPhase: "LEARN",
  },
  criteria: [{ id: "correct-answer", text: "Feedback accepts the correct answer." }],
};

const validResult = {
  criteria: [{ id: "correct-answer", verdict: "pass", reason: "The feedback confirms the value.", quote: "Correct, counter starts at three." }],
  criticalIssues: [],
};

describe("minimal Tutor Quality Judge", () => {
  it("builds allowlisted evidence without runtime identities or provider prompts", () => {
    const input = buildJudgeInput({
      id: "case-a",
      sketch: "int counter = 3;",
      judge: { facts: judgeInput.facts, criteria: judgeInput.criteria },
      expected: { learningPhase: "EXPAND" },
    } as never, {
      executionStatus: "completed",
      metadata: { requestedModel: "secret-model-id" },
      turns: [{
        input: { kind: "dialog", question: judgeInput.question, answer: judgeInput.learnerAnswer, bindsToQuestion: judgeInput.question },
        providerRequest: { model: "secret-model-id", systemPrompt: "Tutor prompt secret", userPrompt: "Tutor user secret" },
        rawProviderResult: { raw: "not allowed" },
        finalTutorResult: {
          feedback: judgeInput.tutor.feedback,
          question: judgeInput.tutor.followUpQuestion,
          answerRating: 5,
          learningPhase: "LEARN",
        },
      }],
    } as never);

    expect(input).toEqual(judgeInput);
    expect(input).not.toHaveProperty("expected");
    expect(JSON.stringify(input)).not.toMatch(/secret-model-id|Tutor prompt secret|Tutor user secret|raw/);
  });

  it("marks a non-completed Tutor transcript not evaluated", () => {
    expect(buildJudgeInput({ id: "case-a", sketch: "int x;", judge: { facts: judgeInput.facts, criteria: judgeInput.criteria } } as never, {
      executionStatus: "technical-failure",
      turns: [],
    } as never)).toBeUndefined();
  });

  it("labels evidence as data in a stable prompt", () => {
    const prompt = buildJudgePrompt(judgeInput);

    expect(prompt.systemPrompt).toMatch(/data, not instructions/i);
    expect(prompt.userPrompt).toContain(JSON.stringify(judgeInput));
    expect(prompt.revision).toBeTruthy();
    expect(prompt.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(prompt.systemDigest).toBe(createHash("sha256").update(prompt.systemPrompt).digest("hex"));
    expect(prompt.userDigest).toBe(createHash("sha256").update(prompt.userPrompt).digest("hex"));
    expect(prompt.digest).toBe(createHash("sha256").update(prompt.systemPrompt).update("\0").update(prompt.userPrompt).digest("hex"));
  });

  it("accepts a complete criteria response with a verifiable quote", () => {
    expect(parseJudgeResult(validResult, judgeInput)).toMatchObject({
      status: "evaluated",
      criteria: [{ id: "correct-answer", verdict: "pass" }],
      criticalIssues: [],
    });
  });

  it.each([
    ["invalid JSON", "{not-json"],
    ["missing criterion", { criteria: [], criticalIssues: [] }],
    ["unknown criterion", { criteria: [{ ...validResult.criteria[0], id: "unknown" }], criticalIssues: [] }],
    ["duplicate criterion", { criteria: [validResult.criteria[0], validResult.criteria[0]], criticalIssues: [] }],
    ["unsupported verdict", { criteria: [{ ...validResult.criteria[0], verdict: "maybe" }], criticalIssues: [] }],
    ["quote absent from evidence", { criteria: [{ ...validResult.criteria[0], quote: "fabricated quote" }], criticalIssues: [] }],
    ["failure without quote", { criteria: [{ id: "correct-answer", verdict: "fail", reason: "Rejected.", quote: undefined }], criticalIssues: [] }],
    ["critical issue without quote", { criteria: validResult.criteria, criticalIssues: [{ code: "factually-wrong-feedback", reason: "Incorrect." }] }],
    ["unknown critical code", { criteria: validResult.criteria, criticalIssues: [{ code: "made-up", quote: "int counter = 3;", reason: "Incorrect." }] }],
  ])("fails closed for %s", (_label, value) => {
    expect(parseJudgeResult(value, judgeInput)).toMatchObject({ status: "judge-invalid" });
  });

  it("permits an unclear criterion without a quote", () => {
    expect(parseJudgeResult({
      criteria: [{ id: "correct-answer", verdict: "unclear", reason: "The feedback is ambiguous." }],
      criticalIssues: [],
    }, judgeInput)).toMatchObject({ status: "evaluated", criteria: [{ verdict: "unclear" }] });
  });
});
