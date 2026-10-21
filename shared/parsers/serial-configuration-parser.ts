/**
 * Serial Configuration Parser
 * 
 * Analyzes Arduino code for Serial configuration issues:
 * - Missing Serial.begin()
 * - Wrong baud rate (not 115200)
 * - Commented-out Serial.begin()
 * - while(!Serial) antipattern
 * - Serial.read() without Serial.available() check
 * - Serial1–Serial3: used on a board without that port, or without begin() (Mega 2560)
 */

import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  SERIAL_PATTERNS,
  stripComments,
  findLineNumber,
} from "../parser-patterns";
import type { BoardId } from "../boards";
import { type PinContext, pinContext } from "./pin-context";

/** `Serial1`–`Serial3`, the hardware ports after `Serial`. */
const EXTRA_PORTS = [1, 2, 3] as const;

/**
 * Analyzer for Serial configuration issues
 */
export class SerialConfigurationParser {
  private readonly board: PinContext;

  constructor(
    private readonly code: string,
    board?: BoardId,
  ) {
    this.board = pinContext(board);
  }

  parse(): ParserMessage[] {
    return [...this.parseSerial(), ...this.parseExtraPorts()];
  }

  /** `Serial1`–`Serial3`: a port the board does not have, and a used port that was never started. */
  private parseExtraPorts(): ParserMessage[] {
    // Text in strings is no use of a port (positions stay, so line numbers still match).
    const uncommentedCode = stripComments(this.code).replaceAll(/"(?:\\.|[^"\\\n])*"/g, (text) => " ".repeat(text.length));
    const portCount = this.board.serialPortCount();
    return EXTRA_PORTS.flatMap((port): ParserMessage[] => {
      const name = `Serial${port}`;
      const use = new RegExp(String.raw`\b${name}\s*\.\s*(?!begin\b|end\b)\w+`);
      if (!use.test(uncommentedCode) || this.declaresOwn(uncommentedCode, name)) return [];
      if (port >= portCount) {
        return [{
          id: randomUUID(),
          type: "warning",
          category: "serial",
          severity: 2,
          message: `${name} does not exist on ${this.board.displayName}, which has ${portCount === 1 ? "only Serial" : `Serial to Serial${portCount - 1}`}.`,
          suggestion: portCount === 1 ? "// Use Serial, or choose Tools → Board → Arduino Mega 2560" : "// Use one of the serial ports of this board",
          line: findLineNumber(this.code, use),
        }];
      }
      if (new RegExp(String.raw`\b${name}\s*\.\s*begin\s*\(`).test(uncommentedCode)) return [];
      const commented = new RegExp(String.raw`\b${name}\s*\.\s*begin\s*\(`).test(this.code);
      return [{
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: commented
          ? `${name}.begin() is commented out! ${name} output may not work correctly.`
          : `${name}.begin(9600) is missing in setup(). ${name} output may not work correctly.`,
        suggestion: `${name}.begin(9600);`,
        line: findLineNumber(this.code, use),
      }];
    });
  }

  /** A sketch may declare its own object with that name, for example `SoftwareSerial Serial1(10, 11);`. */
  private declaresOwn(code: string, name: string): boolean {
    return new RegExp(String.raw`\b\w+[\s&*]+${name}\s*[(;={,)]`).test(code);
  }

  private parseSerial(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const uncommentedCode = stripComments(this.code);

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
