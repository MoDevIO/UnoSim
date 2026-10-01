import { createHash } from "node:crypto";
import type { TutorQualityEvaluationScenario, TutorQualityTranscript } from "../../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import type { TutorPlanningContentContext } from "../../../../../../server/services/tutor/tutor-planning";
import { factualReferenceBundleDigest } from "../../../../../../server/services/tutor/evaluation/semantic/semantic-corpus";
import type { FrozenPreTurnContextInput } from "../../../../../../server/services/tutor/evaluation/semantic/frozen-context";

export const INPUT_PULLUP_SKETCH_REF = "semantic-fixtures/TQ-SEM-001-input-pullup.ino";
export const INPUT_PULLUP_SKETCH = `const int buttonPin = 2;
const int ledPin = LED_BUILTIN;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(
    ledPin,
    digitalRead(buttonPin) == LOW ? HIGH : LOW
  );
}
`;
export const INPUT_PULLUP_SKETCH_DIGEST = createHash("sha256").update(INPUT_PULLUP_SKETCH, "utf8").digest("hex");
export const INPUT_PULLUP_QUESTION = "Welche logische Bedingung muss erfüllt sein, damit die LED eingeschaltet wird?";
export const INPUT_PULLUP_ANSWER = "buttonPin, also an PIN2 muss GND anliegen!";

export function validFrozenPreTurnContextInput(): FrozenPreTurnContextInput {
  return {
    schemaVersion: "tutor-quality-frozen-context-v1",
    sketchRef: INPUT_PULLUP_SKETCH_REF,
    sketchDigest: INPUT_PULLUP_SKETCH_DIGEST,
    question: INPUT_PULLUP_QUESTION,
    learnerAnswer: {
      text: INPUT_PULLUP_ANSWER,
      category: "fully-correct",
      bindsToQuestion: INPUT_PULLUP_QUESTION,
    },
    priorDialog: [],
    courseContent: { kind: "free-tutor" },
    difficulty: 30,
  };
}

export function validSemanticCaseSource<T extends object>(frozenPreTurnContext: T) {
  const factualReferenceBundle = {
    id: "TQ-SEM-001-factual-reference",
    version: 1,
    sourceKind: "draft-factual-reference",
    reviewStatus: "pending-review",
    provenance: "Draft facts derived from the pinned sketch and requiring reviewer confirmation of board and wiring assumptions.",
    limitations: ["Confirm the target board, button-to-GND wiring, and LED_BUILTIN active-high behavior before Gold use."],
    facts: [
      { id: "internal-pullup", statement: "pinMode(buttonPin, INPUT_PULLUP) enables the microcontroller's internal pull-up for buttonPin." },
      { id: "grounded-input-low", statement: "With the declared button-to-GND wiring, pressing the button makes digitalRead(buttonPin) return LOW." },
      { id: "sketch-condition", statement: "The sketch writes HIGH to ledPin, which is LED_BUILTIN, when digitalRead(buttonPin) == LOW." },
    ],
  };
  const factualDigest = factualReferenceBundleDigest(factualReferenceBundle);
  return {
    id: "TQ-SEM-001",
    caseVersion: 1,
    purpose: "Check that a substantively correct INPUT_PULLUP answer is recognized without false correction.",
    role: "development",
    sketch: {
      reference: INPUT_PULLUP_SKETCH_REF,
      digest: INPUT_PULLUP_SKETCH_DIGEST,
    },
    frozenPreTurnContext,
    expectedAnswerInterpretation: "When the button connects buttonPin to GND, INPUT_PULLUP makes the input read LOW; this sketch writes HIGH to ledPin when digitalRead(buttonPin) == LOW.",
    acceptableTutorResponses: {
      diagnoses: ["Recognizes the learner's core condition as correct, allowing substantively equivalent wording."],
      feedbackApproaches: ["May clarify the active-low input without claiming the learner's answer is wrong."],
      followUps: ["May ask a sketch-grounded question that adds a distinct reasoning demand."],
    },
    answerCategory: "fully-correct",
    knownFailurePatterns: ["correct-answer-rejected"],
    assessableDimensions: ["factual-correctness", "sketch-code-grounding", "learner-answer-diagnosis", "precision"],
    dimensionEvidenceLimitations: {
      "instructional-usefulness": "No learner history beyond this synthetic answer is represented.",
      scaffolding: "No learner history beyond this synthetic answer is represented.",
      "dialogic-progression": "The case has no preceding dialog turn.",
      "non-repetition": "The case has no preceding dialog turn.",
      "difficulty-appropriateness": "The case scopes any judgment to its fixed synthetic input only.",
    },
    evidenceSources: [
      {
        id: "sketch",
        kind: "repository/sketch",
        reference: INPUT_PULLUP_SKETCH_REF,
        digest: INPUT_PULLUP_SKETCH_DIGEST,
      },
      {
        id: "input-pullup-reference-draft",
        kind: "draft-factual-reference",
        reference: factualReferenceBundle.id,
        digest: factualDigest,
      },
    ],
    permittedExternalKnowledge: false,
    factualReferenceBundle,
    humanReference: { status: "pending-review" },
  };
}

export function validSemanticCorpusSource<T extends object>(frozenPreTurnContext: T) {
  return {
    schemaVersion: "tutor-quality-semantic-corpus-v1",
    corpusId: "tutor-quality-semantic",
    corpusVersion: 1,
    cases: [validSemanticCaseSource(frozenPreTurnContext)],
  };
}

export function validSemanticCorpusReferences() {
  return {
    sketches: new Map([[INPUT_PULLUP_SKETCH_REF, INPUT_PULLUP_SKETCH]]),
    courseContent: new Map<string, TutorPlanningContentContext>(),
  };
}

export function validStageAScenario(overrides: Partial<TutorQualityEvaluationScenario> = {}): TutorQualityEvaluationScenario {
  return {
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
    ...overrides,
  };
}

export function validStageATranscript(
  scenario: TutorQualityEvaluationScenario = validStageAScenario(),
  overrides: Partial<TutorQualityTranscript> = {},
): TutorQualityTranscript {
  const turn = scenario.turns[0]!;
  return {
    schemaVersion: "tutor-quality-transcript-v1",
    runId: "tq2a-20260928T000000Z-test-run",
    evaluationIdentity: "a".repeat(64),
    metadata: {
      providerId: "fixture-provider",
      requestedModel: "fixed-model-v1",
      returnedModels: ["fixed-model-v1"],
      promptRevision: { id: "tutor-prompt-v1", templateDigest: "b".repeat(64) },
      courseContentRevision: scenario.courseContent?.revision ?? "free-tutor",
      corpusId: scenario.corpusId,
      corpusVersion: scenario.corpusVersion,
      gitSha: "c".repeat(40),
      gitState: "clean",
      sampleIndex: 0,
      sampleCount: 1,
      sampleStartedAt: "2026-09-28T00:00:00.000Z",
      sampleDurationMs: 1,
      providerCalls: { total: 2, modelListCalls: 1, generationCalls: 1 },
      maxCalls: 10,
    },
    scenario: {
      id: scenario.id,
      corpusId: scenario.corpusId,
      corpusVersion: scenario.corpusVersion,
      sketchRef: scenario.sketchRef,
      sketch: scenario.sketch,
      syntheticTurns: scenario.turns,
    },
    turns: [{
      index: 0,
      input: turn,
      startedAt: "2026-09-28T00:00:00.000Z",
      durationMs: 1,
      providerCalls: { total: 2, modelListCalls: 1, generationCalls: 1 },
      finalTutorResult: { feedback: "Richtig erkannt.", question: "Was bewirkt INPUT_PULLUP?" },
      returnedModel: "fixed-model-v1",
      deterministicChecks: [],
    }],
    deterministicChecks: [],
    executionStatus: "completed",
    invariantViolations: [],
    ...overrides,
  };
}
