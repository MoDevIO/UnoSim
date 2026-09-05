/**
 * Serial Configuration Parser
 * 
 * Analyzes Arduino code for Serial configuration issues:
 * - Missing Serial.begin()
 * - Wrong baud rate (not 115200)
 * - Commented-out Serial.begin()
 * - while(!Serial) antipattern
 * - Serial.read() without Serial.available() check
 */

import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  SERIAL_PATTERNS,
  removeComments,
  findLineNumber,
} from "../parser-patterns";

/**
 * Analyzer for Serial configuration issues
 */
export class SerialConfigurationParser {
  constructor(private readonly code: string) {}

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const uncommentedCode = removeComments(this.code);

    // Check if Serial is used
    if (!SERIAL_PATTERNS.USAGE.test(uncommentedCode)) return messages;

    // Check Serial.begin
    const serialBeginExists = SERIAL_PATTERNS.BEGIN.test(this.code);
    const serialBeginActive = SERIAL_PATTERNS.BEGIN.test(uncommentedCode);

    if (serialBeginActive) {
      const baudMsg = this._detectBaudRateMismatch(uncommentedCode);
      if (baudMsg) messages.push(baudMsg);
    } else {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: serialBeginExists
          ? "Serial.begin() is commented out! Serial output may not work correctly."
          : "Serial.begin(115200) is missing in setup(). Serial output may not work correctly.",
        suggestion: "Serial.begin(115200);",
        line: findLineNumber(this.code, /Serial\s*\.\s*begin/),
      });
    }

    // Check for while (!Serial) antipattern
    if (SERIAL_PATTERNS.WHILE_NOT.test(uncommentedCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: "while (!Serial) loop detected. This blocks the simulator - not recommended.",
        suggestion: "// while (!Serial) { }",
        line: findLineNumber(this.code, SERIAL_PATTERNS.WHILE_NOT),
      });
    }

    // Check for Serial.read() without Serial.available() check
    const readMsg = this._detectSerialReadWithoutAvailable(uncommentedCode.split("\n"));
    if (readMsg) messages.push(readMsg);

    return messages;
  }

  private _detectBaudRateMismatch(uncommentedCode: string): ParserMessage | null {
    const baudRateMatch = SERIAL_PATTERNS.BEGIN_EXTRACT.exec(uncommentedCode);
    if (baudRateMatch && baudRateMatch[1] !== "115200") {
      return {
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: `Serial.begin(${baudRateMatch[1]}) uses wrong baud rate. This simulator expects Serial.begin(115200).`,
        suggestion: "Serial.begin(115200);",
        line: findLineNumber(
          this.code,
          new RegExp(String.raw`Serial\s*\.\s*begin\s*\(\s*${baudRateMatch[1]}`),
        ),
      };
    }
    return null;
  }

  private _detectSerialReadWithoutAvailable(lines: string[]): ParserMessage | null {
    for (let i = 0; i < lines.length; i++) {
      if (!SERIAL_PATTERNS.READ.test(lines[i])) continue;
      let hasAvailableCheck = false;
      for (let j = Math.max(0, i - 3); j <= i; j++) {
        if (SERIAL_PATTERNS.AVAILABLE.test(lines[j])) {
          hasAvailableCheck = true;
          break;
        }
      }
      if (!hasAvailableCheck) {
        return {
          id: randomUUID(),
          type: "warning",
          category: "serial",
          severity: 2,
          message: "Serial.read() used without checking Serial.available(). This may return -1 when no data is available.",
          suggestion: "if (Serial.available()) { }",
          line: findLineNumber(this.code, SERIAL_PATTERNS.READ),
        };
      }
    }
    return null;
  }
}
