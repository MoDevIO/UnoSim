import { describe, expect, it } from "vitest";
import {
  TUTOR_PROMPT_REVISION,
  TUTOR_SYSTEM_PROMPT,
  buildDialogPrompt,
  buildTutorContext,
  buildUserPrompt,
  digestTutorPromptTemplates,
  type TutorPromptTemplateSources,
} from "../../../../../server/services/tutor/tutor-service";
import {
  BUILT_IN_TUTOR_STRATEGY,
  type EffectiveTutorStrategy,
} from "../../../../../server/services/tutor/strategy/effective-tutor-strategy";
import type { TutorPlan } from "../../../../../server/services/tutor/tutor-planning";
import type { TutorAnswerRating, TutorDialogTurn } from "../../../../../shared/tutor";

// R-ID-2: the revision digest covers the effective templates, so every application-owned
// instruction in a rendered prompt must come from the digested sources. Only scenario data
// (sketch, context, history, question, answer, objectives, plan) may be added at render time.

const ALTERNATIVE_STRATEGY: EffectiveTutorStrategy = {
  ...BUILT_IN_TUTOR_STRATEGY,
  id: "alternative-policy",
  sketchSpecificity: "strict",
  repetition: "relaxed",
  remediation: "question-first",
  clarification: "new-indicator",
  progression: "advance-immediately",
  scaffolding: "prefer-generated",
  feedbackVerbosity: "detailed",
  hintFirst: false,
};

const SKETCH = "int counter = 3;\nvoid setup() { Serial.begin(9600); Serial.println(counter); }\nvoid loop() { counter += 1; delay(1000); }";
const QUESTION = "Welche Ausgabe erzeugt Serial.println im aktuellen Sketch?";
const ANSWER = "setup gibt 3 aus.";
const OBJECTIVES = ["Den Zusammenhang zwischen Wert und Ausgabe erklären."];
const PLAN: TutorPlan = {
  topicId: "variables-and-serial", topicTitle: "Variablen", conceptId: "variable-values", conceptTitle: "Variablenwerte",
  objective: "Wert und Verwendung erklären.", questionId: "serial-output-prediction", questionKind: "prediction",
  indicatorId: "relates-value-to-use", indicator: "Ordnet einen Wert seiner Verwendung zu.", question: QUESTION,
  misconceptions: [], contentRevision: "2".repeat(40),
};

function turn(answerRating: TutorAnswerRating): TutorDialogTurn {
  return { question: `Frühere Frage ${answerRating}`, answer: "Frühere Antwort", responseStyle: "normal", answerRating };
}

// Every history shape that selects a different remediation or progression instruction.
const HISTORIES: readonly (readonly TutorDialogTurn[])[] = [
  [], [turn(3)], [turn(4)], [turn(5)], [turn(2)], [turn(1), turn(2)], [turn(2), turn(1), turn(2)],
];

function templateFragments(): readonly string[] {
  const { strategyGuidance, learningObjectivesGuidance, dialogGuidance, ...templates } = TUTOR_PROMPT_REVISION.sources;
  const guidance = [strategyGuidance, learningObjectivesGuidance, dialogGuidance]
    .flatMap((source) => Object.values(JSON.parse(source) as Record<string, string>));
  return [...Object.values(templates).flatMap((template) => template.split("\n")), ...guidance]
    .flatMap((fragment) => fragment.split("<difficulty>"))
    .filter((fragment) => fragment.trim().length > 0);
}

function weights(strategy: EffectiveTutorStrategy): string {
  return Object.entries(strategy.questionKindWeights).map(([kind, weight]) => `${kind}=${weight}`).join(", ");
}

/** The rendered prompt minus scenario data and digested fragments; any remaining word is undigested. */
function undigestedText(prompt: string, data: readonly string[]): string {
  let rest = prompt;
  for (const value of [...data, ...templateFragments()].sort((left, right) => right.length - left.length)) {
    rest = rest.split(value).join("\n");
  }
  return rest.split("\n").map((line) => line.replaceAll(/[\s\d.,:=]/g, "")).filter(Boolean).join(" | ");
}

function renderedPrompts(): readonly { readonly prompt: string; readonly data: readonly string[] }[] {
  const context = buildTutorContext(SKETCH);
  const prompts: { prompt: string; data: string[] }[] = [];
  for (const strategy of [BUILT_IN_TUTOR_STRATEGY, ALTERNATIVE_STRATEGY]) {
    for (const learningObjectives of [undefined, OBJECTIVES]) {
      for (const didacticBrief of [undefined, PLAN]) {
        const data = [SKETCH, JSON.stringify(context), JSON.stringify(OBJECTIVES), JSON.stringify(PLAN), weights(strategy)];
        prompts.push({ prompt: buildUserPrompt(SKETCH, context, 42, didacticBrief, strategy, learningObjectives), data });
        for (const history of HISTORIES) {
          const previousQuestions = [QUESTION, ...history.map(({ question }) => question)];
          prompts.push({
            prompt: buildDialogPrompt(SKETCH, context, history, QUESTION, ANSWER, 42, { didacticBrief, strategy, learningObjectives }),
            data: [...data, JSON.stringify(history), JSON.stringify(previousQuestions), QUESTION, ANSWER],
          });
        }
      }
    }
  }
  return prompts;
}

describe("Tutor prompt revision metadata", () => {
  it("exposes versioned system and user template sources", () => {
    expect(TUTOR_PROMPT_REVISION.id).toMatch(/^tutor-prompts-v\d+$/);
    expect(TUTOR_PROMPT_REVISION.templateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(TUTOR_PROMPT_REVISION.sources.system).toContain("didaktischer Tutor");
    expect(TUTOR_PROMPT_REVISION.sources.initialUser).toContain("Sketch:");
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).toContain("Nutzerantwort");
    expect(TUTOR_PROMPT_REVISION.sources.initialUser).not.toContain("function buildUserPrompt");
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).not.toContain("function buildDialogPrompt");
    expect(TUTOR_PROMPT_REVISION.templateDigest).toBe(digestTutorPromptTemplates(TUTOR_PROMPT_REVISION.sources));
  });

  it("changes the digest when an effective template source changes", () => {
    const changed: TutorPromptTemplateSources = {
      ...TUTOR_PROMPT_REVISION.sources,
      system: `${TUTOR_PROMPT_REVISION.sources.system}\nchanged`,
    };
    expect(digestTutorPromptTemplates(changed)).not.toBe(TUTOR_PROMPT_REVISION.templateDigest);
  });

  it("digests every instruction of the rendered initial and dialog prompts (R-ID-2)", () => {
    expect(TUTOR_PROMPT_REVISION.sources.system).toBe(TUTOR_SYSTEM_PROMPT);
    const undigested = renderedPrompts()
      .map(({ prompt, data }) => undigestedText(prompt, data))
      .filter((text) => text.length > 0);

    expect([...new Set(undigested)]).toEqual([]);
  });
});

describe("answer in the follow-up question (Freetutor point B, entry 08)", () => {
  const RULE = "Die Folgefrage darf die gesuchte Antwort nicht selbst nennen";

  it("tells the Tutor, in the system prompt and the dialog template, not to state the sought answer", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain(RULE);
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).toContain(RULE);
  });

  it("keeps the concrete-reference guidance from inviting a quoted declaration that holds the answer", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain("zitiere keine Zeile, die den gesuchten Wert");
  });

  it("changes the prompt revision identifier together with the digest (R-ID-2)", () => {
    expect(TUTOR_PROMPT_REVISION.id).toBe("tutor-prompts-v4");
  });
});

describe("rating independent of the follow-up question (Freetutor point C, strong-answer-progression)", () => {
  const RULE = "Bewerte die Antwort ausschließlich danach, ob sie die gestellte Frage fachlich korrekt beantwortet";

  it("separates rating the given answer from deepening in the follow-up question", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain(RULE);
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).toContain(RULE);
    expect(TUTOR_SYSTEM_PROMPT).toContain("rechtfertigen keine niedrigere Bewertung");
  });

  it("renders the rule into the dialog prompt", () => {
    const prompt = buildDialogPrompt(SKETCH, buildTutorContext(SKETCH), [], QUESTION, ANSWER, 40);
    expect(prompt).toContain(RULE);
  });
});

