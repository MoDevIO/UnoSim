import { stripComments } from "@shared/parser-patterns";
import type { FactRequirement } from "./curriculum-schema";

export type SketchType = "char" | "byte" | "int" | "long" | "float";

export interface SketchFacts {
  readonly typesUsed: readonly SketchType[];
  readonly arrays: readonly { name: string; elementType: SketchType; elementCount: number }[];
  readonly serialCalls: readonly ("print" | "write")[];
}

export interface SketchFactExtractor {
  extract(code: string): SketchFacts;
}

const TYPE_ALIASES: Readonly<Record<string, SketchType>> = {
  char: "char",
  byte: "byte",
  uint8_t: "byte",
  int: "int",
  "unsigned int": "int",
  long: "long",
  "unsigned long": "long",
  float: "float",
};

const TYPE_PATTERN = /\b(?:(?:unsigned|signed)\s+)?(?:char|byte|uint8_t|int|long|float)\b/g;
// The size expression is bounded: with "int a[" repeated and no closer, an unbounded `[^\]]*` rescans the rest
// of the text for every start (128 KiB of it took 1.3 s).
const MAX_SIZE_EXPRESSION_CHARS = 64;
const ARRAY_PATTERN = new RegExp(String.raw`\b(char|byte|uint8_t|int|long|float)\s+([A-Za-z_]\w*)\s*\[([^\]]{0,${MAX_SIZE_EXPRESSION_CHARS}})\]`, "g");
const INITIALIZER_HEAD = /^\s*=\s*\{/;
/** Where an initializer's head can start looking: whitespace and the equals sign are short. */
const INITIALIZER_HEAD_WINDOW = 256;

/**
 * The next closing brace at or after `from`, searched once for a run of increasing starts: while a start lies
 * before the brace found last, that brace is also its answer, and when none was found none follows a later
 * start. Looking up every initializer with its own search made "int a[]={" repeated, with no closer, quadratic.
 */
function closingBraceFinder(text: string): (from: number) => number {
  let searchedFrom = -1;
  let found = -1;
  return (from) => {
    if (searchedFrom >= 0 && from >= searchedFrom && (found === -1 || from <= found)) return found;
    searchedFrom = from;
    found = text.indexOf("}", from);
    return found;
  };
}
const SERIAL_PATTERN = /\bSerial\s*\.\s*(print|println|write)\s*\(/gi;

function canonicalType(value: string): SketchType | undefined {
  return TYPE_ALIASES[value.trim().toLowerCase()];
}

function distinct<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

export class DefaultSketchFactExtractor implements SketchFactExtractor {
  extract(code: string): SketchFacts {
    const clean = stripComments(code);
    const types: SketchType[] = [];
    for (const match of clean.matchAll(TYPE_PATTERN)) {
      const type = canonicalType(match[0]);
      if (type) types.push(type);
    }

    const arrays: Array<{ name: string; elementType: SketchType; elementCount: number }> = [];
    const closingBrace = closingBraceFinder(clean);
    for (const match of clean.matchAll(ARRAY_PATTERN)) {
      const elementType = canonicalType(match[1] ?? "");
      const name = match[2];
      if (!elementType || !name) continue;
      const afterDeclaration = (match.index ?? 0) + match[0].length;
      const head = INITIALIZER_HEAD.exec(clean.slice(afterDeclaration, afterDeclaration + INITIALIZER_HEAD_WINDOW));
      const close = head ? closingBrace(afterDeclaration + head[0].length) : -1;
      const initializer = head && close >= 0 ? clean.slice(afterDeclaration + head[0].length, close).trim() : undefined;
      const declaredSize = Number.parseInt(match[3]?.trim() ?? "", 10);
      let elementCount = 0;
      if (initializer) {
        elementCount = initializer.split(",").map((item) => item.trim()).filter(Boolean).length;
      } else if (Number.isSafeInteger(declaredSize) && declaredSize > 0) {
        elementCount = declaredSize;
      }
      arrays.push({ name, elementType, elementCount });
      types.push(elementType);
    }

    const serialCalls: ("print" | "write")[] = [];
    for (const match of clean.matchAll(SERIAL_PATTERN)) {
      const operation = match[1]?.toLowerCase();
      if (operation === "print" || operation === "println") serialCalls.push("print");
      if (operation === "write") serialCalls.push("write");
    }

    return {
      typesUsed: distinct(types),
      arrays,
      serialCalls: distinct(serialCalls),
    };
  }
}

export function matchesFactRequirement(facts: SketchFacts, requirement: FactRequirement): boolean {
  switch (requirement.fact) {
    case "type-used":
      return facts.typesUsed.some((type) => requirement.values?.includes(type) ?? false);
    case "array-declared":
      return facts.arrays.some((array) => requirement.elementTypes?.includes(array.elementType) ?? true);
    case "serial-call":
      return facts.serialCalls.some((operation) => requirement.values?.includes(operation) ?? false);
  }
}
