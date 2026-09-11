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
const ARRAY_PATTERN = /\b(?:(?:unsigned|signed)\s+)?(char|byte|uint8_t|int|long|float)\s+([A-Za-z_]\w*)\s*\[\s*([^\]]*)\s*\]\s*(?:=\s*\{([^}]*)\})?/g;
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
    for (const match of clean.matchAll(ARRAY_PATTERN)) {
      const elementType = canonicalType(match[1] ?? "");
      const name = match[2];
      if (!elementType || !name) continue;
      const initializer = match[4]?.trim();
      const declaredSize = Number.parseInt(match[3]?.trim() ?? "", 10);
      const elementCount = initializer
        ? initializer.split(",").map((item) => item.trim()).filter(Boolean).length
        : Number.isSafeInteger(declaredSize) && declaredSize > 0 ? declaredSize : 0;
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
