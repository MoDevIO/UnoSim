/**
 * Performance Parser
 * 
 * Analyzes Arduino code for performance issues:
 * - while(true) infinite loops
 * - for loops without exit condition
 * - Large arrays (≥1000 elements)
 * - Recursive functions
 */

import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  PERFORMANCE_PATTERNS,
  FUNCTION_DEF_BASIC,
  FUNCTION_DEF_UNSIGNED,
} from "../parser-patterns";

/**
 * Analyzer for performance issues
 */
export class PerformanceParser {
  constructor(
    private readonly uncommentedCode: string,
    private readonly fullCode: string,
  ) {}

  /**
   * Check for infinite loops and recursion
   */
  analyzeComplexity(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check for while (true)
    if (PERFORMANCE_PATTERNS.WHILE_TRUE.test(this.fullCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2,
        message:
          "Infinite while(true) loop detected. This may freeze the simulator.",
        suggestion: "delay(100);",
        line: this.findLineInFull(PERFORMANCE_PATTERNS.WHILE_TRUE),
      });
    }

    // Check for for loops without exit condition
    if (PERFORMANCE_PATTERNS.FOR_NO_EXIT.test(this.fullCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2,
        message:
          "for loop without exit condition detected. This creates an infinite loop.",
        suggestion: "for (int i = 0; i < 10; i++) { }",
        line: this.findLineInFull(PERFORMANCE_PATTERNS.FOR_NO_EXIT),
      });
    }

    return messages;
  }

  /**
   * Check for large arrays and recursion
   */
  analyzeLargeArraysAndRecursion(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check for large arrays
    const arrayRegex = PERFORMANCE_PATTERNS.LARGE_ARRAY;
    const arrayMatch = arrayRegex.exec(this.fullCode);
    if (arrayMatch) {
      const arraySize = Number.parseInt(arrayMatch[1], 10);
      if (arraySize > 1000) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "performance",
          severity: 2,
          message: `Large array of ${arraySize} elements detected. This may cause memory issues on Arduino.`,
          suggestion: `// Use smaller array size: int array[100];`,
          line: this.findLineInFull(arrayRegex),
        });
      }
    }

    // Check for recursion
    let match;
    for (const functionDefinitionRegex of [FUNCTION_DEF_BASIC, FUNCTION_DEF_UNSIGNED]) {
      functionDefinitionRegex.lastIndex = 0;
      while ((match = functionDefinitionRegex.exec(this.uncommentedCode)) !== null) {
        const functionName = match[1];
        const functionEnd = this._findFunctionBodyEnd(match.index);

        // Extract function body
        const functionBody = this.uncommentedCode.slice(match.index, functionEnd + 1);

        // Check if function calls itself (recursive)
        const functionCallRegex = new RegExp(String.raw`\b${functionName}\s*\(`, "g");
        const calls = functionBody.match(functionCallRegex);
        if (calls && calls.length > 1) {
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "performance",
            severity: 2,
            message: `Recursive function '${functionName}' detected. Deep recursion may cause stack overflow on Arduino.`,
            suggestion: "// Use iterative approach instead",
            line: this.findLineInFull(new RegExp(String.raw`\b${functionName}\s*\(`)),
          });
        }
      }
    }

    return messages;
  }

  private _findFunctionBodyEnd(functionStart: number): number {
    let braceCount = 0;
    let foundOpenBrace = false;
    for (let i = functionStart; i < this.uncommentedCode.length; i++) {
      if (this.uncommentedCode[i] === "{") {
        braceCount++;
        foundOpenBrace = true;
      } else if (this.uncommentedCode[i] === "}") {
        braceCount--;
        if (foundOpenBrace && braceCount === 0) return i;
      }
    }
    return functionStart;
  }

  private findLineInFull(pattern: RegExp): number | undefined {
    const match = pattern.exec(this.fullCode);
    if (!match) return undefined;
    const upToMatch = this.fullCode.slice(0, Math.max(0, match.index));
    return upToMatch.split("\n").length;
  }
}
