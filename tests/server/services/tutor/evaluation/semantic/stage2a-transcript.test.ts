import { describe, expect, it } from "vitest";
import { parseSemanticCorpus } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-corpus";
import { createFrozenPreTurnContext } from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";
import { toStage2AScenario } from "../../../../../../server/services/tutor/evaluation/semantic/stage2a-adapter";
import {
  createExistingTranscriptCompatibilityMapping,
  stage2bTranscriptDigest,
  validateStage2ATranscript,
} from "../../../../../../server/services/tutor/evaluation/semantic/stage2a-transcript";
import {
  canonicalStage2ATranscriptJson,
  createStage2ATranscriptReference,
} from "../../../../../../server/services/tutor/evaluation/semantic/transcript-reference";
import { canonicalSemanticDigest } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-canonical";
import {
  validFrozenPreTurnContextInput,
  validSemanticCorpusReferences,
  validSemanticCorpusSource,
  validStageAScenario,
  validStageATranscript,
} from "./semantic-test-fixtures";

function parsedCorpus() {
  return parseSemanticCorpus(validSemanticCorpusSource(createFrozenPreTurnContext(validFrozenPreTurnContextInput())), validSemanticCorpusReferences());
}

describe("Stage-2A transcript compatibility and Stage-B digest", () => {
  it("validates an adapter-generated transcript without changing its Stage-A identity or invariant array", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const invariantViolations = [{ code: "raw-response-repaired", source: "raw-provider" as const, turnIndex: 0 }];
    const transcript = validStageATranscript(adapted.scenario, { invariantViolations });
    const transcriptBytes = JSON.stringify(transcript);
    const evaluationIdentity = transcript.evaluationIdentity;

    const result = validateStage2ATranscript(transcript, semanticCase, adapted.provenance);

    expect(result).toMatchObject({ valid: true, semanticEligibility: "eligible" });
    if (!result.valid) throw new Error("expected compatible Stage-A transcript");
    expect(result.transcriptDigest).toBe(stage2bTranscriptDigest(transcript));
    expect(result.transcript.evaluationIdentity).toBe(evaluationIdentity);
    expect(result.transcript.invariantViolations).toBe(invariantViolations);
    expect(JSON.stringify(transcript)).toBe(transcriptBytes);
  });

  it("accepts different legacy case/scenario IDs only after explicit full-context compatibility mapping", () => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({ id: "legacy-input-pullup", corpusId: "legacy-anchor-corpus", corpusVersion: 3 });
    const transcript = validStageATranscript(sourceScenario);
    const mapping = createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/run-123/transcript-legacy-input-pullup-0.json",
      transcript,
      sourceScenario,
      semanticCase,
    });
    const bytesBefore = JSON.stringify(transcript);

    const result = validateStage2ATranscript(transcript, semanticCase, mapping);

    expect(result).toMatchObject({ valid: true, semanticEligibility: "eligible" });
    if (!result.valid) throw new Error("expected explicit compatible mapping");
    const reference = createStage2ATranscriptReference(transcript, result.transcriptDigest, result.compatibilityMapping);
    expect(reference.stageAEvaluationIdentity).toBe("a".repeat(64));
    expect(reference.transcriptDigest).toBe(result.transcriptDigest);
    expect(reference.compatibilityMappingIdentity).toBe(mapping.identity);
    expect(transcript.scenario.id).toBe("legacy-input-pullup");
    expect(transcript.evaluationIdentity).toBe("a".repeat(64));
    expect(JSON.stringify(transcript)).toBe(bytesBefore);
  });

  it.each([0x00, 0x1f, 0x7f])("rejects ASCII control character with code point %i in existing-transcript source identities", (code) => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({ id: "legacy-input-pullup", corpusId: "legacy-anchor-corpus", corpusVersion: 3 });
    const transcript = validStageATranscript(sourceScenario);
    const validMapping = createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-identity",
      transcript,
      sourceScenario,
      semanticCase,
    });
    const sourceId = `stage-a/source${String.fromCharCode(code)}identity`;

    expect(() => createExistingTranscriptCompatibilityMapping({
      sourceId,
      transcript,
      sourceScenario,
      semanticCase,
    })).toThrow(/control characters/i);

    const { identity: _identity, ...mappingContent } = { ...validMapping, sourceId };
    const invalidMapping = { ...mappingContent, identity: canonicalSemanticDigest(mappingContent) };
    expect(validateStage2ATranscript(transcript, semanticCase, invalidMapping)).toMatchObject({
      valid: false,
      reason: "existing-transcript-source-identity-missing-or-invalid",
    });
  });

  it("rejects an expected learning phase that only string-coerces to a supported value", () => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({
      id: "legacy-input-pullup",
      corpusId: "legacy-anchor-corpus",
      corpusVersion: 3,
      expected: { learningPhase: ["LEARN"] as unknown as "LEARN" },
    });
    const transcript = validStageATranscript(sourceScenario);

    expect(() => createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-identity",
      transcript,
      sourceScenario,
      semanticCase,
    })).toThrow(/invalid or unsupported fields/i);
  });

  it.each(["LEARN", "DEEPEN", "EXPAND"] as const)("accepts the exact Stage-A learning phase %s", (learningPhase) => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({
      id: "legacy-input-pullup",
      corpusId: "legacy-anchor-corpus",
      corpusVersion: 3,
      expected: { learningPhase },
    });
    const transcript = validStageATranscript(sourceScenario);
    const mapping = createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-identity",
      transcript,
      sourceScenario,
      semanticCase,
    });

    expect(validateStage2ATranscript(transcript, semanticCase, mapping)).toMatchObject({ valid: true });
  });

  it("treats an omitted legacy dialog history as Stage-A's empty-history default", () => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({
      id: "legacy-no-history-field",
      corpusId: "legacy-anchor-corpus",
      corpusVersion: 3,
      turns: [{
        kind: "dialog",
        question: semanticCase.frozenPreTurnContext.question,
        answer: semanticCase.frozenPreTurnContext.learnerAnswer.text,
        bindsToQuestion: semanticCase.frozenPreTurnContext.question,
        difficulty: semanticCase.frozenPreTurnContext.difficulty,
      }],
    });
    const transcript = validStageATranscript(sourceScenario);
    const mapping = createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-with-default-history",
      transcript,
      sourceScenario,
      semanticCase,
    });

    expect(sourceScenario.turns[0]).not.toHaveProperty("history");
    expect(validateStage2ATranscript(transcript, semanticCase, mapping)).toMatchObject({ valid: true, semanticEligibility: "eligible" });
  });

  it("rejects missing mappings and any unproven question, answer, sketch, order, or context change", () => {
    const semanticCase = parsedCorpus().cases[0]!;
    const sourceScenario = validStageAScenario({ id: "legacy-input-pullup", corpusId: "legacy-anchor-corpus", corpusVersion: 3 });
    const transcript = validStageATranscript(sourceScenario);
    const mapping = createExistingTranscriptCompatibilityMapping({ sourceId: "stage-a/source-identity", transcript, sourceScenario, semanticCase });

    expect(validateStage2ATranscript(transcript, semanticCase, undefined)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({ ...transcript, scenario: { ...transcript.scenario, sketch: "other sketch" } }, semanticCase, mapping)).toMatchObject({ valid: false });
    expect(() => createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-identity",
      transcript,
      sourceScenario: { ...sourceScenario, turns: [{ kind: "dialog", question: "Other?", answer: "Answer", bindsToQuestion: "Other?", difficulty: 30, history: [] }] },
      semanticCase,
    })).toThrow(/compatib|context|question/i);
    expect(() => createExistingTranscriptCompatibilityMapping({
      sourceId: "stage-a/source-identity",
      transcript,
      sourceScenario: { ...sourceScenario, unexpected: "must not enter a Stage-B mapping" } as typeof sourceScenario,
      semanticCase,
    })).toThrow(/unsupported fields/i);
    expect(validateStage2ATranscript(transcript, semanticCase, { ...mapping, unexpected: "must be rejected" })).toMatchObject({ valid: false, reason: "stage-b-transcript-mapping-schema-invalid" });
  });

  it("keeps a compatible non-completed Stage-A sample not-evaluated and preserves invariant violations", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const invariantViolations = [{ code: "not-run", source: "scenario" as const }];
    const transcript = validStageATranscript(adapted.scenario, { executionStatus: "technical-failure", invariantViolations });

    const result = validateStage2ATranscript(transcript, semanticCase, adapted.provenance);

    expect(result).toMatchObject({ valid: true, semanticEligibility: "not-evaluated" });
    if (!result.valid) throw new Error("expected structurally compatible Stage-A transcript");
    expect(result.transcript.invariantViolations).toBe(invariantViolations);
  });

  it("admits a not-run Stage-A sample with no executed turns for reliability accounting only", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const transcript = validStageATranscript(adapted.scenario, {
      executionStatus: "not-run",
      turns: [],
      deterministicChecks: [],
      metadata: {
        ...validStageATranscript(adapted.scenario).metadata,
        providerCalls: { total: 0, modelListCalls: 0, generationCalls: 0 },
      },
    });

    const result = validateStage2ATranscript(transcript, semanticCase, adapted.provenance);

    expect(result).toMatchObject({ valid: true, semanticEligibility: "not-evaluated" });
  });

  it("canonicalizes object keys in UTF-8 order while preserving array order and not mutating the Stage-A object", () => {
    const transcript = validStageATranscript();
    const withUnicodeKeys = {
      ...transcript,
      metadata: { ...transcript.metadata, "ä": "umlaut", z: "ascii" },
    } as typeof transcript;
    const before = JSON.stringify(withUnicodeKeys);
    const canonical = canonicalStage2ATranscriptJson(withUnicodeKeys);
    const reorderedKeys = {
      ...withUnicodeKeys,
      metadata: { ...transcript.metadata, z: "ascii", "ä": "umlaut" },
    } as typeof transcript;

    expect(canonical).toContain('"z":"ascii","ä":"umlaut"');
    expect(stage2bTranscriptDigest(withUnicodeKeys)).toBe(stage2bTranscriptDigest(reorderedKeys));
    const ordered = {
      ...transcript,
      turns: [
        transcript.turns[0]!,
        { ...transcript.turns[0]!, index: 1, input: { ...transcript.turns[0]!.input, question: "Second question", answer: "Second answer", bindsToQuestion: "Second question" } },
      ],
    } as typeof transcript;
    expect(stage2bTranscriptDigest(ordered)).not.toBe(stage2bTranscriptDigest({ ...ordered, turns: [...ordered.turns].reverse() }));
    expect(JSON.stringify(withUnicodeKeys)).toBe(before);
  });

  it("rejects a transcript with a changed question-to-answer binding or a missing Stage-A identity", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const transcript = validStageATranscript(adapted.scenario);

    expect(validateStage2ATranscript({ ...transcript, turns: [{ ...transcript.turns[0]!, input: { ...transcript.turns[0]!.input, bindsToQuestion: "different" } }] }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({ ...transcript, evaluationIdentity: "" }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({ ...transcript, metadata: { ...transcript.metadata, promptRevision: undefined } }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
  });

  it("rejects malformed invariant and deterministic-check entries, not only malformed arrays", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const transcript = validStageATranscript(adapted.scenario);

    expect(validateStage2ATranscript({ ...transcript, invariantViolations: [null] }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({ ...transcript, invariantViolations: [{ code: "", source: "invented" }] }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({ ...transcript, deterministicChecks: [null] }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({
      ...transcript,
      deterministicChecks: [{ name: "", passed: "yes" }],
    }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
    expect(validateStage2ATranscript({
      ...transcript,
      turns: [{ ...transcript.turns[0]!, deterministicChecks: [null] }],
    }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
  });

  it("rejects a completed transcript whose normalized final Tutor result is not valid Tutor content", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());
    const transcript = validStageATranscript(adapted.scenario);

    expect(validateStage2ATranscript({
      ...transcript,
      turns: [{ ...transcript.turns[0]!, finalTutorResult: {} }],
    }, semanticCase, adapted.provenance)).toMatchObject({ valid: false });
  });
});
