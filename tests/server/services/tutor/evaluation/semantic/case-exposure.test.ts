import { describe, expect, it } from "vitest";
import { canonicalSemanticDigest } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-canonical";
import {
  createCaseExposureRecord,
  validateCaseExposureRecord,
  type CaseExposureSnapshot,
} from "../../../../../../server/services/tutor/evaluation/semantic/case-exposure";
import { parseSemanticCorpus } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-corpus";
import { createFrozenPreTurnContext } from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";
import {
  validFrozenPreTurnContextInput,
  validSemanticCorpusReferences,
  validSemanticCorpusSource,
} from "./semantic-test-fixtures";

const binding = {
  candidateIdentity: "a".repeat(64),
  corpusId: "tutor-quality-semantic",
  corpusVersion: 1,
  caseId: "TQ-SEM-001",
  semanticCaseDigest: "b".repeat(64),
};

function snapshot(
  availableArtifacts: CaseExposureSnapshot["availableArtifacts"],
  targetedChange: CaseExposureSnapshot["targetedChange"] = { status: "not-informed" },
  recordedAt = "2026-09-27T12:00:00.000Z",
): CaseExposureSnapshot {
  return { recordedAt, availableArtifacts, targetedChange };
}

describe("Candidate-specific CaseExposureRecord", () => {
  it.each([
    ["unexposed", { caseDefinition: "unavailable", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }],
    ["case-known", { caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }],
    ["outcome-exposed", { caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }],
    ["used-for-targeted-change", { caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "informed", rationale: "The observed correction error directly motivated this Candidate change." }],
    ["unknown", { caseDefinition: "unknown", tutorOutput: "unknown", humanReference: "unknown", judgeResult: "unknown" }, { status: "unknown" }],
  ] as const)("derives the SSOT exposure state %s from its evidence", (expected, availableArtifacts, targetedChange) => {
    const record = createCaseExposureRecord({
      ...binding,
      history: [snapshot(availableArtifacts, targetedChange)],
    });

    expect(record.exposureStatus).toBe(expected);
    expect(validateCaseExposureRecord(record, binding)).toMatchObject({ valid: true });
    expect(record.identity).toMatch(/^[0-9a-f]{64}$/);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds exposure to one Candidate and the exact case version", () => {
    const record = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });

    expect(validateCaseExposureRecord(record, { ...binding, candidateIdentity: "c".repeat(64) })).toMatchObject({ valid: false });
    expect(validateCaseExposureRecord(record, { ...binding, corpusVersion: 2 })).toMatchObject({ valid: false });
  });

  it("appends a new immutable revision without rewriting prior exposure history", () => {
    const first = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });
    const second = createCaseExposureRecord({
      ...binding,
      history: [
        ...first.history,
        snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z"),
      ],
    }, first);

    expect(second.recordVersion).toBe(2);
    expect(second.previousRecordDigest).toBe(first.digest);
    expect(second.exposureStatus).toBe("outcome-exposed");
    expect(first.recordVersion).toBe(1);
    expect(validateCaseExposureRecord(second, binding)).toMatchObject({ valid: true });
    expect(first.exposureStatus).toBe("case-known");
    expect(first.history).toHaveLength(1);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("validates exposure chains beyond two revisions", () => {
    const first = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });
    const second = createCaseExposureRecord({
      ...binding,
      history: [
        ...first.history,
        snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z"),
      ],
    }, first);
    const third = createCaseExposureRecord({
      ...binding,
      history: [
        ...second.history,
        snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "available", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-29T10:00:00.000Z"),
      ],
    }, second);

    expect(validateCaseExposureRecord(third, binding)).toMatchObject({ valid: true });
  });

  it("verifies the previous-record digest against the actual history prefix", () => {
    const first = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });
    const second = createCaseExposureRecord({
      ...binding,
      history: [
        ...first.history,
        snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z"),
      ],
    }, first);
    const { digest: _originalDigest, ...secondWithoutDigest } = second;
    const forgedBase = { ...secondWithoutDigest, previousRecordDigest: "f".repeat(64) };
    const forgedIdentity = canonicalSemanticDigest({
      schemaVersion: forgedBase.schemaVersion,
      candidateIdentity: forgedBase.candidateIdentity,
      corpusId: forgedBase.corpusId,
      corpusVersion: forgedBase.corpusVersion,
      caseId: forgedBase.caseId,
      semanticCaseDigest: forgedBase.semanticCaseDigest,
      recordVersion: forgedBase.recordVersion,
      previousRecordDigest: forgedBase.previousRecordDigest,
    });
    const forgedWithoutDigest = { ...forgedBase, identity: forgedIdentity };
    const forged = { ...forgedWithoutDigest, digest: canonicalSemanticDigest(forgedWithoutDigest) };

    expect(validateCaseExposureRecord(forged, binding)).toMatchObject({ valid: false, reason: "previous-record-digest-history-mismatch" });
  });

  it("requires a verifiable previous-record link after the initial exposure version", () => {
    const first = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });
    const second = createCaseExposureRecord({
      ...binding,
      history: [
        ...first.history,
        snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z"),
      ],
    }, first);
    const { previousRecordDigest: _previousRecordDigest, digest: _originalDigest, ...withoutPrevious } = second;
    const withoutPreviousIdentity = canonicalSemanticDigest({
      schemaVersion: withoutPrevious.schemaVersion,
      candidateIdentity: withoutPrevious.candidateIdentity,
      corpusId: withoutPrevious.corpusId,
      corpusVersion: withoutPrevious.corpusVersion,
      caseId: withoutPrevious.caseId,
      semanticCaseDigest: withoutPrevious.semanticCaseDigest,
      recordVersion: withoutPrevious.recordVersion,
    });
    const withoutPreviousBase = { ...withoutPrevious, identity: withoutPreviousIdentity };
    const forged = { ...withoutPreviousBase, digest: canonicalSemanticDigest(withoutPreviousBase) };

    expect(validateCaseExposureRecord(forged, binding)).toMatchObject({ valid: false, reason: "previous-record-digest-history-mismatch" });
  });

  it("rejects a revision that drops prior events or changes Candidate/case ownership", () => {
    const first = createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });

    expect(() => createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "unavailable", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    }, first)).toThrow(/append|history/i);
    expect(() => createCaseExposureRecord({
      ...binding,
      candidateIdentity: "c".repeat(64),
      history: [...first.history, snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z")],
    }, first)).toThrow(/candidate|binding/i);
    expect(() => createCaseExposureRecord({
      ...binding,
      history: [...first.history, snapshot({ caseDefinition: "available", tutorOutput: "available", humanReference: "unavailable", judgeResult: "unavailable" }, { status: "not-informed" }, "2026-09-28T10:00:00.000Z")],
    }, { ...first, digest: "f".repeat(64) })).toThrow(/valid prior record/i);
  });

  it("does not change the Semantic Corpus digest when Candidate exposure is added", () => {
    const corpus = parseSemanticCorpus(validSemanticCorpusSource(createFrozenPreTurnContext(validFrozenPreTurnContextInput())), validSemanticCorpusReferences());
    const digestBefore = corpus.digest;

    createCaseExposureRecord({
      ...binding,
      history: [snapshot({ caseDefinition: "available", tutorOutput: "unavailable", humanReference: "unavailable", judgeResult: "unavailable" })],
    });

    expect(corpus.digest).toBe(digestBefore);
  });
});
