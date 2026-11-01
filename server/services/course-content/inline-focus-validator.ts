import { stripComments } from "@shared/parser-patterns";
import { focusCodeTerms, termOccursIn } from "../tutor/curriculum/focus-applicability";
import type { ExampleTutorAnnotation } from "./embedded-tutor-annotation";
import type { TutorContentQualityIssue } from "./tutor-quality-validator";

/**
 * Complete claims of the older course convention, in the wording of `normalizedClaimText`. A variable
 * definition is also a declaration, whatever its initializer, so a sentence that merely names these
 * words is not a finding.
 */
const NON_CPP_CLAIMS: readonly string[] = [
  "definition ist deklaration und initialisierung",
  "deklaration und initialisierung ist definition",
  "deklaration und zuweisung in einem schritt",
];
const CLAIM_REJECTED_BEFORE = /\b(?:nicht|keine?[mnrs]?|falsch|statt|irrtum|fehlvorstellung)\b/;
const CLAIM_REJECTED_AFTER = /\b(?:stimmt nicht|gilt nicht|ist falsch)\b/;
const PURE_DECLARATION_CLAIM = /(?<!nicht\s)nur\s+eine\s+deklaration/i;
const VARIABLE_QUALIFIERS = /^(?:(?:const|static|unsigned|volatile)\s+)+/;
const VARIABLE_TYPES: ReadonlySet<string> = new Set(["bool", "boolean", "byte", "char", "double", "float", "int", "long", "short", "String", "word"]);
const VARIABLE_NAME = /^\w+(?:$|[[=,])/;

function normalizedClaimText(sentence: string): string {
  return sentence
    .toLowerCase()
    .replaceAll("=", " ist ")
    .replaceAll("+", " und ")
    .replaceAll(/\b(?:heißt|bedeutet|nennen wir)(?=\s)/g, "ist")
    .replaceAll(/\bmit\b/g, "und")
    .replaceAll(/\b(?:zugleich|die|eine|einer|gleichzeitige)\b/g, " ")
    .replaceAll(/[^\p{L}]+/gu, " ");
}

function assertsClaim(sentence: string): boolean {
  const text = normalizedClaimText(sentence);
  return NON_CPP_CLAIMS.some((claim) => {
    const index = text.indexOf(claim);
    if (index < 0) return false;
    return !CLAIM_REJECTED_BEFORE.test(text.slice(0, index)) && !CLAIM_REJECTED_AFTER.test(text.slice(index + claim.length));
  });
}

function definesVariable(statement: string): boolean {
  const [type = "", name = ""] = statement.replace(/^[\s/*]+/, "").replace(VARIABLE_QUALIFIERS, "").split(/\s+/);
  return VARIABLE_TYPES.has(type) && VARIABLE_NAME.test(name);
}

/** Only a statement named on the same line can be judged: `extern int a;` and `void f();` are pure declarations. */
function callsDefinitionPureDeclaration(line: string): boolean {
  const match = PURE_DECLARATION_CLAIM.exec(line);
  if (!match) return false;
  const before = line.slice(0, match.index);
  return definesVariable(before.slice(0, before.lastIndexOf(";")).split(/[;`{}]/).at(-1) ?? "");
}

/** Errs toward passing: correct teaching must never be blocked, so a claim it cannot attribute stays allowed. */
function usesNonCppTerms(text: string): boolean {
  const lines = text.split("\n");
  const prose = lines.map((line) => line.trim().replace(/^(?:\*(?!\/)|\/\/)/, "").trim()).join(" ");
  return prose.split(/(?<=[.?!])\s/).some(assertsClaim) || lines.some(callsDefinitionPureDeclaration);
}

function unsupportedTerms(code: string, text: string): string[] {
  return focusCodeTerms(text).filter((term) => !termOccursIn(code, term));
}

function focusQuestionFindings(code: string, text: string): readonly [TutorContentQualityIssue["code"], string][] {
  const findings: [TutorContentQualityIssue["code"], string][] = [];
  if (focusCodeTerms(text).length === 0) findings.push(["inline-focus-question-without-term", "names no code term in backticks"]);
  if ((text.match(/\?/g)?.length ?? 0) > 1) findings.push(["inline-focus-multiple-questions", "asks more than one question"]);
  if (text.includes("```") || /\bvoid\s+setup\s*\(/.test(text)) findings.push(["inline-focus-complete-solution", "contains solution code"]);
  for (const term of unsupportedTerms(code, text)) {
    findings.push(["inline-focus-term-not-in-sketch", `names \`${term}\`, which does not occur in the sketch`]);
  }
  return findings;
}

/**
 * Teacher-authored focus questions put every code term in backticks. Each such term must occur in
 * the Example's code (comments excluded); otherwise the Tutor would ask about something the sketch
 * does not contain, such as `long` for an `unsigned long` sketch. Each question needs at least one
 * such term, because the term is how the Tutor decides that the question still fits an edited sketch,
 * and it stays one question without solution code, because it reaches the learner word for word.
 */
export function validateInlineFocus(
  examples: readonly { readonly id: string; readonly code: string; readonly annotation?: ExampleTutorAnnotation }[],
): TutorContentQualityIssue[] {
  const issues: TutorContentQualityIssue[] = [];
  for (const example of examples) {
    const focus = example.annotation?.focus ?? [];
    const code = stripComments(example.code);
    if (usesNonCppTerms(example.code)) {
      issues.push({ code: "inline-focus-non-cpp-terms", message: "The sketch or its comments use the older definition wording instead of the C++ terms", exampleId: example.id });
    }
    const texts = [...(example.annotation?.learningObjectives ?? []), ...focus.flatMap((area) => [area.title, area.objective, ...area.questions.map(({ text }) => text)])];
    if (texts.some(usesNonCppTerms)) {
      issues.push({ code: "inline-focus-non-cpp-terms", message: "The Tutor annotation uses the older definition wording instead of the C++ terms", exampleId: example.id });
    }
    for (const area of focus) {
      for (const [index, question] of area.questions.entries()) {
        for (const [issueCode, message] of focusQuestionFindings(code, question.text)) {
          issues.push({ code: issueCode, message: `Inline focus ${area.id} question ${index + 1} ${message}`, exampleId: example.id, conceptId: area.id });
        }
      }
    }
  }
  return issues;
}
