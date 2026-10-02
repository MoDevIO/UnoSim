import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildJudgeInput,
  buildJudgePrompt,
  JUDGE_QUOTE_SOURCES,
  parseJudgeResult,
  TUTOR_QUALITY_JUDGE_PROMPT_REVISION,
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
        input: { kind: "dialog", question: judgeInput.question, answer: judgeInput.learnerAnswer },
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
    ["learner answer quote outside allowlist", { criteria: [{ ...validResult.criteria[0], quote: judgeInput.learnerAnswer }], criticalIssues: [] }],
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

  it.each([
    ["pass without quote", "pass", false, undefined, true],
    ["pass with empty quote", "pass", true, "", true],
    ["pass with whitespace quote", "pass", true, "   ", true],
    ["pass with null quote", "pass", true, null, true],
    ["unclear with empty quote", "unclear", true, "", true],
    ["fail without quote", "fail", false, undefined, false],
    ["fail with empty quote", "fail", true, "", false],
    ["fail with null quote", "fail", true, null, false],
    ["fail with an exact evidence quote", "fail", true, "Correct, counter starts at three.", true],
    ["pass with a number quote", "pass", true, 7, false],
    ["pass with an object quote", "pass", true, { text: "evidence" }, false],
    ["pass with an array quote", "pass", true, ["evidence"], false],
    ["pass with a boolean quote", "pass", true, true, false],
  ] as const)("normalizes quote contract for %s", (_label, verdict, quoteProvided, quote, valid) => {
    const criterion: Record<string, unknown> = {
      id: "correct-answer",
      verdict,
      reason: "The criterion was evaluated.",
    };
    if (quoteProvided) criterion.quote = quote;
    const result = parseJudgeResult({ criteria: [criterion], criticalIssues: [] }, judgeInput);

    expect(result.status).toBe(valid ? "evaluated" : "judge-invalid");
    if (valid && verdict !== "fail") {
      expect(result.criteria?.[0]).not.toHaveProperty("quote");
    }
  });

  it("states the quote omission and null/empty normalization contract in the prompt", () => {
    const prompt = buildJudgePrompt(judgeInput);

    expect(prompt.systemPrompt).toMatch(/only the sketch, tutor\.feedback, and tutor\.followUpQuestion.*quote sources/i);
    expect(prompt.systemPrompt).toMatch(/fail verdict.*non-empty exact quote from the allowed evidence/i);
    expect(prompt.systemPrompt).toMatch(/pass and unclear.*quote may be omitted, null, empty, or whitespace-only.*absent/i);
  });
  describe("quote allowlist and quote source boundary (R-EVD-1..4)", () => {
    const sourceText: Record<(typeof JUDGE_QUOTE_SOURCES)[number], string> = {
      sketch: judgeInput.sketch,
      "tutor.feedback": judgeInput.tutor.feedback,
      "tutor.followUpQuestion": judgeInput.tutor.followUpQuestion,
    };
    const quoteWith = (quote: string) => ({
      criteria: [{ ...validResult.criteria[0], verdict: "fail", quote }],
      criticalIssues: [],
    });

    it("defines the quote allowlist once, with exactly the three normative sources", () => {
      expect([...JUDGE_QUOTE_SOURCES]).toEqual(["sketch", "tutor.feedback", "tutor.followUpQuestion"]);
    });

    it("names exactly the allowlist constant in the prompt", () => {
      const sources = [...JUDGE_QUOTE_SOURCES];
      const list = `${sources.slice(0, -1).join(", ")}, and ${sources.at(-1)}`;

      expect(buildJudgePrompt(judgeInput).systemPrompt).toContain(`Only the ${list} fields are quote sources`);
    });

    it.each([...JUDGE_QUOTE_SOURCES])("accepts a quote taken from the allowed source %s", (source) => {
      expect(parseJudgeResult(quoteWith(sourceText[source]), judgeInput).status).toBe("evaluated");
    });

    it.each(["facts", "question", "learnerAnswer", "criterion text"] as const)("rejects a quote taken from the non-quotable %s", (field) => {
      // Distinct texts, so the quote cannot also occur inside an allowed source.
      const input: TutorQualityJudgeInput = {
        ...judgeInput,
        facts: ["Fakt nur in den Fakten."],
        question: "Frage nur in der Frage?",
        learnerAnswer: "Antwort nur von der lernenden Person.",
        criteria: [{ id: "correct-answer", text: "Kriterium nur im Kriterientext." }],
      };
      const quote = { facts: input.facts[0]!, question: input.question, learnerAnswer: input.learnerAnswer, "criterion text": input.criteria[0]!.text }[field];

      expect(parseJudgeResult(quoteWith(quote), input)).toMatchObject({ status: "judge-invalid", reason: "criterion-quote-not-in-evidence" });
    });

    it.each([
      ["feedback and follow-up question", "starts at three. What changes"],
      ["sketch and feedback", "counter = 3; Correct, counter"],
    ])("rejects a criterion quote spanning the boundary of %s", (_label, quote) => {
      expect(parseJudgeResult(quoteWith(quote), judgeInput)).toMatchObject({ status: "judge-invalid", reason: "criterion-quote-not-in-evidence" });
    });

    it("rejects a critical-issue quote spanning two sources and accepts one inside a single source", () => {
      const issue = (quote: string) => ({
        criteria: validResult.criteria,
        criticalIssues: [{ code: "factually-wrong-feedback", reason: "Incorrect.", quote }],
      });

      expect(parseJudgeResult(issue("starts at three. What changes"), judgeInput))
        .toMatchObject({ status: "judge-invalid", reason: "critical-issue-quote-not-in-evidence" });
      expect(parseJudgeResult(issue("counter starts at three"), judgeInput).status).toBe("evaluated");
    });

    it("still matches a single-source quote after NFKC normalization and whitespace collapsing", () => {
      expect(parseJudgeResult(quoteWith("Correct,   counter\nstarts at three."), judgeInput).status).toBe("evaluated");
    });
  });

  it("bumps the Judge prompt revision when the system prompt text changed (R-RSP-4)", () => {
    const prompt = buildJudgePrompt(judgeInput);

    expect(TUTOR_QUALITY_JUDGE_PROMPT_REVISION).toBe("tutor-quality-minimal-criteria-v2");
    // Pins the prompt text to its revision: changing the text requires a new revision and a new digest here.
    expect(prompt.revision).toBe("tutor-quality-minimal-criteria-v2");
    expect(prompt.systemDigest).toBe("71ac0c843a76de32142943ae1e6f98097b7e5324a1723b8b3935701e70da7e86");
  });
});
