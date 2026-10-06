import { stripComments } from "@shared/parser-patterns";

/** Type names a Tutor text can wrongly attribute to a sketch. */
const TYPE_TERMS = ["unsigned long", "unsigned int", "long", "int", "byte", "float", "double", "char", "bool", "struct", "String"] as const;

export type CatalogIssueCode =
  | "type-not-in-sketch"
  | "question-repeated"
  | "planner-after-free"
  | "focus-question-not-asked"
  | "provider-error";

export interface CatalogIssue {
  readonly code: CatalogIssueCode;
  readonly turn: number;
  readonly details: string;
}

export interface CatalogTurn {
  /** The question the Tutor asked in this turn (initial question or follow-up). */
  readonly question: string;
  readonly feedback?: string;
  readonly followUpSource: "planner" | "provider" | "application-fallback";
}

function declaredTerms(code: string): Set<string> {
  const clean = stripComments(code);
  const found = new Set<string>();
  for (const term of TYPE_TERMS) {
    const pattern = term === "long"
      ? /(?<!unsigned\s)\blong\b/
      : term === "int"
        ? /(?<!unsigned\s)\bint\b/
        : new RegExp(String.raw`\b${term.replace(" ", String.raw`\s+`)}\b`);
    if (pattern.test(clean)) found.add(term);
  }
  return found;
}

/** Type names the text mentions in backticks or code-like positions but the sketch does not use. */
export function findUnsupportedTypeMentions(text: string, code: string): string[] {
  const declared = declaredTerms(code);
  const mentioned = new Set<string>();
  for (const term of TYPE_TERMS) {
    const pattern = term === "long"
      ? /(?<!unsigned\s)(?<![A-Za-zÄÖÜäöü])long\b/
      : term === "int"
        ? /(?<!unsigned\s)(?<![A-Za-zÄÖÜäöü])int\b/
        : new RegExp(`(?<![A-Za-zÄÖÜäöü])${term.replace(" ", String.raw`\s+`)}(?![A-Za-zÄÖÜäöü])`);
    if (pattern.test(text)) mentioned.add(term);
  }
  return [...mentioned].filter((term) => !declared.has(term));
}

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/[^a-zäöüß0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Word-set overlap in [0, 1]. */
export function questionSimilarity(left: string, right: string): number {
  const a = new Set(normalizeQuestion(left).split(" ").filter(Boolean));
  const b = new Set(normalizeQuestion(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

export function analyzeCatalogSession(input: {
  readonly code: string;
  readonly turns: readonly CatalogTurn[];
  readonly focusQuestions: readonly string[];
}): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const seen: string[] = [];
  let free = false;
  input.turns.forEach((turn, index) => {
    for (const [label, text] of [["question", turn.question], ["feedback", turn.feedback ?? ""]] as const) {
      const unsupported = findUnsupportedTypeMentions(text, input.code);
      if (unsupported.length > 0) {
        issues.push({ code: "type-not-in-sketch", turn: index, details: `${label} names ${unsupported.join(", ")}` });
      }
    }
    const normalized = normalizeQuestion(turn.question);
    if (seen.some((previous) => questionSimilarity(previous, normalized) >= 0.85)) {
      issues.push({ code: "question-repeated", turn: index, details: turn.question });
    }
    seen.push(normalized);
    if (turn.followUpSource !== "planner") free = true;
    else if (free && index > 0) issues.push({ code: "planner-after-free", turn: index, details: turn.question });
  });
  const first = input.turns[0];
  const firstFocus = input.focusQuestions[0];
  if (first && firstFocus && questionSimilarity(first.question, firstFocus) < 0.4) {
    issues.push({ code: "focus-question-not-asked", turn: 0, details: `asked "${first.question}" instead of "${firstFocus}"` });
  }
  return issues;
}
