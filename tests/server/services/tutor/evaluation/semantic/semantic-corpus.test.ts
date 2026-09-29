import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  compareSemanticCorpusVersions,
  parseSemanticCorpus,
  semanticCorpusDigest,
} from "../../../../../../server/services/tutor/evaluation/semantic/semantic-corpus";
import { semanticSha256 } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-canonical";
import { createFrozenPreTurnContext } from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";
import {
  INPUT_PULLUP_SKETCH_DIGEST,
  INPUT_PULLUP_SKETCH_REF,
  validFrozenPreTurnContextInput,
  validSemanticCorpusReferences,
  validSemanticCorpusSource,
} from "./semantic-test-fixtures";

function source() {
  return validSemanticCorpusSource(createFrozenPreTurnContext(validFrozenPreTurnContextInput()));
}

describe("Stage-2B Semantic Corpus", () => {
  it("loads the single complete executable TQ-SEM-001 development case", () => {
    const yamlPath = fileURLToPath(new URL("../../../../../../evals/tutor-quality/semantic-corpus.yaml", import.meta.url));
    const sketchPath = fileURLToPath(new URL("../../../../../../evals/tutor-quality/semantic-fixtures/TQ-SEM-001-input-pullup.ino", import.meta.url));
    const sketch = readFileSync(sketchPath, "utf8");
    const references = validSemanticCorpusReferences();
    references.sketches.set(INPUT_PULLUP_SKETCH_REF, sketch);
    const corpus = parseSemanticCorpus(parseYaml(readFileSync(yamlPath, "utf8")), references);

    expect(semanticSha256(sketch)).toBe(INPUT_PULLUP_SKETCH_DIGEST);
    expect(corpus.corpusId).toBe("tutor-quality-semantic");
    expect(corpus.corpusVersion).toBe(1);
    expect(corpus.cases.map(({ id }) => id)).toEqual(["TQ-SEM-001"]);
    expect(corpus.cases[0]).toMatchObject({
      role: "development",
      sketch: { reference: INPUT_PULLUP_SKETCH_REF, digest: INPUT_PULLUP_SKETCH_DIGEST },
      frozenPreTurnContext: {
        question: "Welche logische Bedingung muss erfüllt sein, damit die LED eingeschaltet wird?",
        learnerAnswer: {
          text: "buttonPin, also an PIN2 muss GND anliegen!",
          bindsToQuestion: "Welche logische Bedingung muss erfüllt sein, damit die LED eingeschaltet wird?",
          category: "fully-correct",
        },
        courseContent: { kind: "free-tutor" },
      },
      humanReference: { status: "pending-review" },
    });
  });

  it("rejects duplicate case IDs, unsupported roles, missing evidence, and broken answer bindings", () => {
    const input = source();
    const semanticCase = input.cases[0]!;

    expect(() => parseSemanticCorpus({ ...input, cases: [semanticCase, semanticCase] }, validSemanticCorpusReferences())).toThrow(/duplicate/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, role: "held-out" }] }, validSemanticCorpusReferences())).toThrow(/role/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, humanReference: { status: "reviewed" } }] }, validSemanticCorpusReferences())).toThrow(/humanReference|reviewed/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, sketch: { ...semanticCase.sketch, reference: "missing.ino" } }] }, validSemanticCorpusReferences())).toThrow(/sketch/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, frozenPreTurnContext: { ...semanticCase.frozenPreTurnContext, learnerAnswer: { ...semanticCase.frozenPreTurnContext.learnerAnswer, bindsToQuestion: "another question" } } }] }, validSemanticCorpusReferences())).toThrow(/bind/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, frozenPreTurnContext: { ...semanticCase.frozenPreTurnContext, sketchDigest: "d".repeat(64) } }] }, validSemanticCorpusReferences())).toThrow(/sketch|digest/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, evidenceSources: [{ id: "unsupported", kind: "judge-opinion", reference: "x", digest: "d" }] }] }, validSemanticCorpusReferences())).toThrow(/evidence|source/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, assessableDimensions: ["factual-correctness", "factual-correctness"] }] }, validSemanticCorpusReferences())).toThrow(/duplicate/i);
    expect(() => parseSemanticCorpus({ ...input, cases: [{ ...semanticCase, dimensionEvidenceLimitations: { ...semanticCase.dimensionEvidenceLimitations, inventedDimension: "unknown rubric dimension" } }] }, validSemanticCorpusReferences())).toThrow(/unknown rubric dimension/i);
  });

  it("requires a semantic corpus version increase when case evidence or role changes", () => {
    const previous = parseSemanticCorpus(source(), validSemanticCorpusReferences());
    const altered = source();
    altered.cases[0]!.role = "calibration";
    const currentSameVersion = parseSemanticCorpus(altered, validSemanticCorpusReferences());
    const currentBumpedVersion = parseSemanticCorpus({ ...altered, corpusVersion: 2 }, validSemanticCorpusReferences());

    expect(compareSemanticCorpusVersions(previous, currentSameVersion)).toMatchObject({ valid: false, reason: "version-not-increased" });
    expect(compareSemanticCorpusVersions(previous, currentBumpedVersion)).toMatchObject({ valid: true });
  });

  it("rejects corpus-version rollback even when parsed content is otherwise identical", () => {
    const previous = parseSemanticCorpus({ ...source(), corpusVersion: 2 }, validSemanticCorpusReferences());
    const rolledBack = parseSemanticCorpus(source(), validSemanticCorpusReferences());

    expect(compareSemanticCorpusVersions(previous, rolledBack)).toMatchObject({ valid: false, reason: "version-regressed" });
  });

  it("does not put Candidate exposure into the static corpus digest", () => {
    const corpus = parseSemanticCorpus(source(), validSemanticCorpusReferences());
    const before = semanticCorpusDigest(corpus);

    expect(semanticCorpusDigest(corpus)).toBe(before);
    expect(JSON.stringify(corpus)).not.toContain("candidateIdentity");
    expect(JSON.stringify(corpus)).not.toContain("targetedChange");
  });

  it("canonicalizes unordered case sets and linked evidence records without separating bindings", () => {
    const original = source();
    const originalCase = original.cases[0]!;
    const reordered = {
      ...original,
      cases: [{
        ...originalCase,
        acceptableTutorResponses: {
          diagnoses: [...originalCase.acceptableTutorResponses.diagnoses].reverse(),
          feedbackApproaches: [...originalCase.acceptableTutorResponses.feedbackApproaches].reverse(),
          followUps: [...originalCase.acceptableTutorResponses.followUps].reverse(),
        },
        knownFailurePatterns: [...originalCase.knownFailurePatterns].reverse(),
        assessableDimensions: [...originalCase.assessableDimensions].reverse(),
        evidenceSources: [...originalCase.evidenceSources].reverse(),
        factualReferenceBundle: {
          ...originalCase.factualReferenceBundle,
          limitations: [...originalCase.factualReferenceBundle.limitations].reverse(),
          facts: [...originalCase.factualReferenceBundle.facts].reverse(),
        },
      }],
    };

    expect(semanticCorpusDigest(reordered)).toBe(semanticCorpusDigest(original));
    const relinked = structuredClone(reordered);
    const sources = relinked.cases[0]!.evidenceSources;
    [sources[0]!.digest, sources[1]!.digest] = [sources[1]!.digest, sources[0]!.digest];
    expect(semanticCorpusDigest(relinked)).not.toBe(semanticCorpusDigest(original));
  });

  it("canonicalizes case-list order when multiple cases are present", () => {
    const oneCase = source();
    const secondCase = { ...oneCase.cases[0]!, id: "TQ-SEM-001-SECOND" };
    const twoCases = { ...oneCase, cases: [oneCase.cases[0]!, secondCase] };

    expect(semanticCorpusDigest(twoCases)).toBe(semanticCorpusDigest({ ...twoCases, cases: [...twoCases.cases].reverse() }));
  });

  it("rejects a sketch fixture whose bytes do not match the pinned digest", () => {
    const references = validSemanticCorpusReferences();
    references.sketches.set(INPUT_PULLUP_SKETCH_REF, "different sketch");

    expect(() => parseSemanticCorpus(source(), references)).toThrow(/digest/i);
  });
});
