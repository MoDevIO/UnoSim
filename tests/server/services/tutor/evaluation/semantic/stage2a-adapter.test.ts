import { describe, expect, it } from "vitest";
import { parseSemanticCorpus } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-corpus";
import { createFrozenPreTurnContext } from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";
import { toStage2AScenario } from "../../../../../../server/services/tutor/evaluation/semantic/stage2a-adapter";
import {
  INPUT_PULLUP_ANSWER,
  INPUT_PULLUP_QUESTION,
  INPUT_PULLUP_SKETCH,
  INPUT_PULLUP_SKETCH_REF,
  validFrozenPreTurnContextInput,
  validSemanticCorpusReferences,
  validSemanticCorpusSource,
} from "./semantic-test-fixtures";

function parsedCorpus() {
  return parseSemanticCorpus(validSemanticCorpusSource(createFrozenPreTurnContext(validFrozenPreTurnContextInput())), validSemanticCorpusReferences());
}

describe("Stage-2A Case Adapter", () => {
  it("translates TQ-SEM-001 to the exact existing Stage-A scenario and dialog turn contract", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const adapted = toStage2AScenario(corpus, semanticCase, validSemanticCorpusReferences());

    expect(adapted.scenario).toEqual({
      id: "TQ-SEM-001",
      corpusId: "tutor-quality-semantic",
      corpusVersion: 1,
      sketchRef: INPUT_PULLUP_SKETCH_REF,
      sketch: INPUT_PULLUP_SKETCH,
      turns: [{
        kind: "dialog",
        question: INPUT_PULLUP_QUESTION,
        answer: INPUT_PULLUP_ANSWER,
        bindsToQuestion: INPUT_PULLUP_QUESTION,
        difficulty: 30,
        history: [],
      }],
    });
    expect(adapted.provenance).toMatchObject({
      kind: "adapter-generated",
      semanticCorpusId: "tutor-quality-semantic",
      semanticCorpusVersion: 1,
      semanticCaseId: "TQ-SEM-001",
      scenarioId: "TQ-SEM-001",
      frozenPreTurnContextDigest: semanticCase.frozenPreTurnContext.digest,
    });
  });

  it("keeps rubric, human labels, exposure, candidate, Judge, and Stage-B mapping out of Stage-A input", () => {
    const adapted = toStage2AScenario(parsedCorpus(), parsedCorpus().cases[0]!, validSemanticCorpusReferences());
    const scenarioJson = JSON.stringify(adapted.scenario);

    expect(adapted.scenario).not.toHaveProperty("rubric");
    expect(adapted.scenario).not.toHaveProperty("humanReference");
    expect(adapted.scenario).not.toHaveProperty("candidateIdentity");
    expect(adapted.scenario).not.toHaveProperty("exposure");
    expect(adapted.scenario).not.toHaveProperty("judge");
    expect(adapted.scenario).not.toHaveProperty("mappingIdentity");
    expect(scenarioJson).not.toContain("correct-answer-rejected");
    expect(scenarioJson).not.toContain("pending-review");
    expect(adapted.scenario).not.toHaveProperty("expected");
  });

  it("rejects a changed sketch or invalid Frozen Context before returning Stage-A inputs", () => {
    const corpus = parsedCorpus();
    const semanticCase = corpus.cases[0]!;
    const references = validSemanticCorpusReferences();
    references.sketches.set(INPUT_PULLUP_SKETCH_REF, "changed bytes");

    expect(() => toStage2AScenario(corpus, semanticCase, references)).toThrow(/sketch|digest/i);
    expect(() => toStage2AScenario(corpus, {
      ...semanticCase,
      frozenPreTurnContext: { ...semanticCase.frozenPreTurnContext, learnerAnswer: { ...semanticCase.frozenPreTurnContext.learnerAnswer, bindsToQuestion: "another question" } },
    }, validSemanticCorpusReferences())).toThrow(/context|bind/i);
  });

  it("rejects a forged Semantic Corpus digest before returning a Stage-A scenario", () => {
    const corpus = parsedCorpus();
    expect(() => toStage2AScenario({ ...corpus, digest: "f".repeat(64) }, corpus.cases[0]!, validSemanticCorpusReferences())).toThrow(/corpus digest/i);
  });
});
