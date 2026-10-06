import { stripComments } from "@shared/parser-patterns";

/** Type names a Tutor text can wrongly attribute to a sketch. */
const TYPE_WORDS = new Set(["long", "int", "byte", "float", "double", "char", "bool", "struct", "String"]);

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

function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Type names that occur as whole words; `unsigned long` counts as its own type, not as `long`. */
function typesIn(text: string): Set<string> {
  const words = wordsOf(text);
  const found = new Set<string>();
  for (const [index, word] of words.entries()) {
    const unsigned = words[index - 1] === "unsigned" && (word === "long" || word === "int");
    if (unsigned) found.add(`unsigned ${word}`);
    else if (TYPE_WORDS.has(word)) found.add(word);
  }
  return found;
}

/** Type names the text mentions but the sketch (outside comments) does not use. */
export function findUnsupportedTypeMentions(text: string, code: string): string[] {
  const declared = typesIn(stripComments(code));
  return [...typesIn(text)].filter((term) => !declared.has(term));
}

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().replaceAll(/[^a-zäöüß0-9 ]+/g, " ").replaceAll(/\s+/g, " ").trim();
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
  /** Questions of the first focus area; any of them may open the session. */
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
  if (first && input.focusQuestions.length > 0
    && input.focusQuestions.every((focus) => questionSimilarity(first.question, focus) < 0.4)) {
    issues.push({ code: "focus-question-not-asked", turn: 0, details: `asked "${first.question}" instead of one of the first focus area's questions` });
  }
  return issues;
}
