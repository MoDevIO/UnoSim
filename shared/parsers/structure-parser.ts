/**
 * Structure Parser
 * 
 * Analyzes Arduino code for structure issues:
 * - Missing void setup()
 * - Missing void loop()
 * - setup()/loop() with parameters
 */

import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import { STRUCTURE_PATTERNS } from "../parser-patterns";
import { findLineNumber } from "../parser-patterns";

/**
 * Analyzer for structure (setup/loop) issues
 */
export class StructureParser {
  constructor(private readonly code: string) {}

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    const setupMatch = STRUCTURE_PATTERNS.SETUP_FUNCTION.test(this.code);
    const anySetup = STRUCTURE_PATTERNS.SETUP_ANY.test(this.code);

    if (!setupMatch && anySetup) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2,
        message: "setup() has parameters, but Arduino setup() should have no parameters.",
        suggestion: "void setup()",
        line: findLineNumber(this.code, STRUCTURE_PATTERNS.SETUP_ANY),
      });
    } else if (!setupMatch) {
      messages.push({
        id: randomUUID(),
        type: "error",
        category: "structure",
        severity: 3,
        message: "Missing void setup() function. Every Arduino program needs setup().",
        suggestion: "void setup() { }",
      });
    }

    const loopMatch = STRUCTURE_PATTERNS.LOOP_FUNCTION.test(this.code);
    const anyLoop = STRUCTURE_PATTERNS.LOOP_ANY.test(this.code);

    if (!loopMatch && anyLoop) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2,
        message: "loop() has parameters, but Arduino loop() should have no parameters.",
        suggestion: "void loop()",
        line: findLineNumber(this.code, STRUCTURE_PATTERNS.LOOP_ANY),
      });
    } else if (!loopMatch) {
      messages.push({
        id: randomUUID(),
        type: "error",
        category: "structure",
        severity: 3,
        message: "Missing void loop() function. Every Arduino program needs loop().",
        suggestion: "void loop() { }",
      });
    }

    return messages;
  }
}
