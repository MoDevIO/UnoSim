import type { ParserMessage } from "./schema";
import type { PinMode } from "@shared/types/arduino.types";
import { randomUUID } from "node:crypto";

/**
 * Centralized patterns and constants for Arduino code parsing
 * Extracted to reduce cognitive complexity and enable reuse
 */
// Two separate for-loop regexes to avoid super-linear backtracking (S5843):
const FOR_LOOP_TYPED = /for\s*\(\s*\w+\s+(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<=?)\s*(\d+)\s*;[^)]*\)/g;
const FOR_LOOP_BARE = /for\s*\(\s*(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<=?)\s*(\d+)\s*;[^)]*\)/g;
// Two separate function-def regexes to reduce alternation complexity (S5843):
const FUNCTION_DEF_BASIC = /(?:void|int|bool|byte|long|float|double|char|String)\s+(\w+)\s*\([^)]*\)\s*\{/g;
const FUNCTION_DEF_UNSIGNED = /unsigned\s+(?:int|long)\s+(\w+)\s*\([^)]*\)\s*\{/g;
const PARSER_PATTERNS = {
  // Serial configuration patterns
  SERIAL_USAGE: /Serial\s*\.\s*(print|println|write|read|available|peek|readString|readBytes|parseInt|parseFloat|find|findUntil)/,
  SERIAL_BEGIN: /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/,
  SERIAL_BEGIN_EXTRACT: /Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/,
  SERIAL_WHILE_NOT: /while\s*\(\s*!\s*Serial\s*\)/,
  SERIAL_READ: /Serial\s*\.\s*read\s*\(\s*\)/,
  SERIAL_AVAILABLE: /Serial\s*\.\s*available\s*\(\s*\)/,

  // Structure patterns
  SETUP_FUNCTION: /void\s+setup\s*\(\s*\)/,
  SETUP_ANY: /void\s+setup\s*\([^)]*\)/,
  LOOP_FUNCTION: /void\s+loop\s*\(\s*\)/,
  LOOP_ANY: /void\s+loop\s*\([^)]*\)/,

  // Pin-related patterns
  FOR_LOOP_TYPED,
  FOR_LOOP_BARE,
  PIN_MODE: /pinMode\s*\(\s*(\d+|A\d+)\s*,/g,
  PIN_MODE_WITH_MODE: /pinMode\s*\(\s*(\d+|A\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g,
  PIN_MODE_VAR: /pinMode\s*\(\s*([a-zA-Z_]\w*)\s*,/g,
  ANALOG_WRITE: /analogWrite\s*\(\s*(\d+|A\d+)\s*,/g,
  DIGITAL_READ_WRITE: /digital(?:Read|Write)\s*\(\s*(\d+|A\d+|[a-zA-Z_]\w*)/g,
  DIGITAL_READ_LITERAL: /\bdigitalRead\s*\(\s*(\d+|A\d+)\s*\)/g,
  DIGITAL_WRITE_READ_PIN: /pinMode\s*\(\s*(\d+|A\d+)/gi,
  DIGITAL_WRITE_READ_DIO: /digital(?:Write|Read)\s*\(\s*(\d+|A\d+)/gi,
  ANALOG_READ_WRITE: /analog(?:Read|Write)\s*\(\s*(\d+|A\d+)/gi,

  // Performance patterns
  WHILE_TRUE: /while\s*\(\s*true\s*\)/,
  FOR_NO_EXIT: /for *\( *[^;\n]+; *; *[^)\n]+\)/, // NOSONAR S5843
  LARGE_ARRAY: /\[\s*(\d{4,})\s*\]/,
  FUNCTION_DEF_BASIC,
  FUNCTION_DEF_UNSIGNED,

  // Comment patterns (consolidated from inline)
  COMMENT_SINGLE_LINE: /\/\/[^\n]*$/gm, // NOSONAR S5843
  COMMENT_MULTI_LINE: /\/\*[^*]*(?:\*+[^*/][^*]*)*\*\//g,

  // Additional pin patterns (consolidated from inline)
  PIN_MODE_ANY: /pinMode *\( *[^,)\n]+,/, // NOSONAR S5843
  DIGITAL_DYNAMIC_PIN_READ: /digitalRead\s*\(\s*[^0-9A\s][^,)]*/,
  DIGITAL_DYNAMIC_PIN_WRITE: /digitalWrite\s*\(\s*[^0-9A\s][^,)]*/,
  
  // Utility patterns
  ANALOG_PIN_FORMAT: /^A\d+$/,
} as const;

interface PinModeCall {
  pin: number;
  mode: PinMode;
  line: number;
}

interface PinModeEntry {
  modes: Array<PinMode>;
  lines: number[];
}

/**
 * Specialized analyzer for pin mode conflicts and hardware compatibility
 */
class PinCompatibilityChecker {
  constructor(private readonly uncommentedCode: string) {}

  /**
   * Extract all pins configured with pinMode calls (direct and loop-based)
   */
  getPinModeInfo(getLoopPinModeCalls: (code: string) => PinModeCall[]): Map<string, PinModeEntry> {
    const result = new Map<string, PinModeEntry>();

    // Direct pinMode() calls
    const pinModeWithModeRegex = PARSER_PATTERNS.PIN_MODE_WITH_MODE;
    let match;
    while ((match = pinModeWithModeRegex.exec(this.uncommentedCode)) !== null) {
      const pin = match[1];
      const rawMode = match[2];
      const mode: PinMode =
        rawMode === "INPUT" || rawMode === "OUTPUT" || rawMode === "INPUT_PULLUP"
          ? rawMode
          : "INPUT";
      const line = this.uncommentedCode.slice(0, Math.max(0, match.index)).split("\n").length;

      if (result.has(pin)) {
        const entry = result.get(pin);
        if (entry) {
          entry.modes.push(mode);
          entry.lines.push(line);
        }
      } else {
        result.set(pin, { modes: [mode], lines: [line] });
      }
    }

    // Loop-based pinMode() calls
    for (const { pin, mode, line } of getLoopPinModeCalls(this.uncommentedCode)) {
      const key = String(pin);
      if (result.has(key)) {
        const entry = result.get(key);
        if (entry) {
          entry.modes.push(mode);
          entry.lines.push(line);
        }
      } else {
        result.set(key, { modes: [mode], lines: [line] });
      }
    }

    return result;
  }

  /**
   * Check for conflicting pin mode declarations
   */
  checkPinModeConflicts(
    pinModeCalls: Map<string, PinModeEntry>,
  ): ParserMessage[] {
    const messages: ParserMessage[] = [];

    for (const [pin, entry] of pinModeCalls.entries()) {
      if (entry.modes.length < 2) continue;

      const uniqueModes = Array.from(new Set(entry.modes));
      const line = entry.lines[1];

      if (uniqueModes.length > 1) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "pins",
          severity: 2,
          message: `Pin ${pin} has multiple pinMode() calls with different modes: ${uniqueModes.join(", ")}.`,
          suggestion: `Use a single pinMode(${pin}, <MODE>) call in setup().`,
          line,
        });
      } else {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "pins",
          severity: 2,
          message: `Pin ${pin} has pinMode() called multiple times (${entry.modes.length}x).`,
          suggestion: `Remove duplicate pinMode(${pin}, ${uniqueModes[0]}) calls.`,
          line,
        });
      }
    }

    return messages;
  }

  /**
   * Check for OUTPUT pins being read with digitalRead()
   */
  checkOutputPinsReadAsInput(
    uncommentedCode: string,
    outputPins: Set<number>,
    parsePinNumber: (pin: string) => number | undefined,
  ): ParserMessage[] {
    const messages: ParserMessage[] = [];

    if (outputPins.size > 0) {
      const digitalReadLiteralRe = PARSER_PATTERNS.DIGITAL_READ_LITERAL;
      const outputReadWarnedPins = new Set<number>();
      let match;
      while ((match = digitalReadLiteralRe.exec(uncommentedCode)) !== null) {
        const pinNum = parsePinNumber(match[1]);
        if (
          pinNum !== undefined &&
          outputPins.has(pinNum) &&
          !outputReadWarnedPins.has(pinNum)
        ) {
          outputReadWarnedPins.add(pinNum);
          const pinStr = pinNum >= 14 ? `A${pinNum - 14}` : String(pinNum);
          const line = uncommentedCode.slice(0, Math.max(0, match.index)).split("\n").length;
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "pins",
            severity: 2,
            message: `Pin ${pinStr} is configured as OUTPUT but read with digitalRead(). Reading an OUTPUT pin may return unexpected values.`,
            suggestion: `If you need to read the pin, use pinMode(${pinStr}, INPUT) or INPUT_PULLUP instead.`,
            line,
          });
        }
      }
    }

    return messages;
  }
}

/**
 * Specialized analyzer for Serial configuration issues
 */
class SerialConfigurationParser {
  constructor(private readonly code: string) {}

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const uncommentedCode = removeCommentsHelper(this.code);

    // Check if Serial is used
    if (!PARSER_PATTERNS.SERIAL_USAGE.test(uncommentedCode)) return messages;

    // Check Serial.begin
    const serialBeginExists = PARSER_PATTERNS.SERIAL_BEGIN.test(this.code);
    const serialBeginActive = PARSER_PATTERNS.SERIAL_BEGIN.test(uncommentedCode);

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
        line: findLineNumberHelper(this.code, /Serial\s*\.\s*begin/),
      });
    }

    // Check for while (!Serial) antipattern
    if (PARSER_PATTERNS.SERIAL_WHILE_NOT.test(uncommentedCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: "while (!Serial) loop detected. This blocks the simulator - not recommended.",
        suggestion: "// while (!Serial) { }",
        line: findLineNumberHelper(this.code, PARSER_PATTERNS.SERIAL_WHILE_NOT),
      });
    }

    // Check for Serial.read() without Serial.available() check
    const readMsg = this._detectSerialReadWithoutAvailable(uncommentedCode.split("\n"));
    if (readMsg) messages.push(readMsg);

    return messages;
  }

  private _detectBaudRateMismatch(uncommentedCode: string): ParserMessage | null {
    const baudRateMatch = PARSER_PATTERNS.SERIAL_BEGIN_EXTRACT.exec(uncommentedCode);
    if (baudRateMatch && baudRateMatch[1] !== "115200") {
      return {
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2,
        message: `Serial.begin(${baudRateMatch[1]}) uses wrong baud rate. This simulator expects Serial.begin(115200).`,
        suggestion: "Serial.begin(115200);",
        line: findLineNumberHelper(
          this.code,
          new RegExp(String.raw`Serial\s*\.\s*begin\s*\(\s*${baudRateMatch[1]}`),
        ),
      };
    }
    return null;
  }

  private _detectSerialReadWithoutAvailable(lines: string[]): ParserMessage | null {
    for (let i = 0; i < lines.length; i++) {
      if (!PARSER_PATTERNS.SERIAL_READ.test(lines[i])) continue;
      let hasAvailableCheck = false;
      for (let j = Math.max(0, i - 3); j <= i; j++) {
        if (PARSER_PATTERNS.SERIAL_AVAILABLE.test(lines[j])) {
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
          line: findLineNumberHelper(this.code, PARSER_PATTERNS.SERIAL_READ),
        };
      }
    }
    return null;
  }
}

/**
 * Specialized analyzer for structure (setup/loop) issues
 */
class StructureParser {
  constructor(private readonly code: string) {}

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    const setupMatch = PARSER_PATTERNS.SETUP_FUNCTION.test(this.code);
    const anySetup = PARSER_PATTERNS.SETUP_ANY.test(this.code);

    if (!setupMatch && anySetup) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2,
        message: "setup() has parameters, but Arduino setup() should have no parameters.",
        suggestion: "void setup()",
        line: findLineNumberHelper(this.code, PARSER_PATTERNS.SETUP_ANY),
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

    const loopMatch = PARSER_PATTERNS.LOOP_FUNCTION.test(this.code);
    const anyLoop = PARSER_PATTERNS.LOOP_ANY.test(this.code);

    if (!loopMatch && anyLoop) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2,
        message: "loop() has parameters, but Arduino loop() should have no parameters.",
        suggestion: "void loop()",
        line: findLineNumberHelper(this.code, PARSER_PATTERNS.LOOP_ANY),
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

/**
 * Helper function to remove comments (used by sub-parsers)
 */
function removeCommentsHelper(code: string): string {
  let result = code.replaceAll(PARSER_PATTERNS.COMMENT_SINGLE_LINE, "");
  result = result.replaceAll(PARSER_PATTERNS.COMMENT_MULTI_LINE, "");
  return result;
}

/**
 * Helper function to find line numbers (used by sub-parsers)
 */
function findLineNumberHelper(
  code: string,
  pattern: RegExp | string,
): number | undefined {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  const match = regex.exec(code);
  if (!match) return undefined;
  const upToMatch = code.slice(0, Math.max(0, match.index));
  return upToMatch.split("\n").length;
}

/**
 * Analyzer for pin conflicts (same pin used as digital and analog)
 */
class PinConflictAnalyzer {
  constructor(private readonly code: string) {}

  analyze(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const digitalPins = new Set<number>();
    let match;

    for (const re of [PARSER_PATTERNS.DIGITAL_WRITE_READ_PIN, PARSER_PATTERNS.DIGITAL_WRITE_READ_DIO]) {
      re.lastIndex = 0;
      while ((match = re.exec(this.code)) !== null) {
        const pin = parsePinNumberHelper(match[1]);
        if (pin !== undefined) digitalPins.add(pin);
      }
    }

    const analogPins = new Set<number>();
    const analogRegex = PARSER_PATTERNS.ANALOG_READ_WRITE;
    while ((match = analogRegex.exec(this.code)) !== null) {
      const pin = parsePinNumberHelper(match[1]);
      if (pin !== undefined) analogPins.add(pin);
    }

    for (const pin of digitalPins) {
      if (analogPins.has(pin)) {
        const pinStr = pin >= 14 ? `A${pin - 14}` : `${pin}`;
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2,
          message: `Pin ${pinStr} used as both digital and analog. This may be unintended.`,
          suggestion: `// Use separate pins for digital and analog`,
        });
      }
    }
    return messages;
  }
}

/**
 * Helper function for parsing pin numbers (used by sub-parsers)
 */
function parsePinNumberHelper(pinStr: string): number | undefined {
  if (PARSER_PATTERNS.ANALOG_PIN_FORMAT.test(pinStr)) {
    const analogNum = Number.parseInt(pinStr.slice(1));
    if (analogNum >= 0 && analogNum <= 5) return 14 + analogNum;
  } else {
    const digitalNum = Number.parseInt(pinStr);
    if (!Number.isNaN(digitalNum) && digitalNum >= 0 && digitalNum <= 19) return digitalNum;
  }
  return undefined;
}

/**
 * Specialized analyzer for performance issues
 */
class PerformanceAnalyzer {
  constructor(private readonly uncommentedCode: string, private readonly fullCode: string) {}

  /**
   * Check for infinite loops and recursion
   */
  analyzeComplexity(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check for while (true)
    if (PARSER_PATTERNS.WHILE_TRUE.test(this.fullCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2,
        message:
          "Infinite while(true) loop detected. This may freeze the simulator.",
        suggestion: "delay(100);",
        line: this.findLineInFull(PARSER_PATTERNS.WHILE_TRUE),
      });
    }

    // Check for for loops without exit condition
    if (PARSER_PATTERNS.FOR_NO_EXIT.test(this.fullCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2,
        message:
          "for loop without exit condition detected. This creates an infinite loop.",
        suggestion: "for (int i = 0; i < 10; i++) { }",
        line: this.findLineInFull(PARSER_PATTERNS.FOR_NO_EXIT),
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
    const arrayRegex = PARSER_PATTERNS.LARGE_ARRAY;
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
    for (const functionDefinitionRegex of [PARSER_PATTERNS.FUNCTION_DEF_BASIC, PARSER_PATTERNS.FUNCTION_DEF_UNSIGNED]) {
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

export class CodeParser {
  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const parser = new SerialConfigurationParser(code);
    return parser.parse();
  }

  /**
   * Parse structure issues (setup/loop)
   */
  parseStructure(code: string): ParserMessage[] {
    const parser = new StructureParser(code);
    return parser.parse();
  }

  /**
   * Extract all (pin, mode) pairs produced by for-loops containing
   * `pinMode(loopVar, MODE)`.  Handles:
   *   - Both braced bodies `{ ... }` and braceless single-statement bodies
   *   - Both `<` and `<=` comparisons
   *   - Type keywords: int, byte, uint8_t, unsigned int, unsigned, var, or none
   */
  private extractLoopBodyFromCode(code: string, forMatch: RegExpExecArray): string {
    let pos = forMatch.index + forMatch[0].length;
    while (pos < code.length && /[ \t\r\n]/.test(code[pos])) pos++;

    if (code[pos] === "{") {
      let depth = 0;
      let bodyStart = pos + 1;
      for (let i = pos; i < code.length; i++) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") {
          depth--;
          if (depth === 0) return code.slice(bodyStart, i);
        }
      }
      return "";
    }

    const semiIdx = code.indexOf(";", pos);
    return semiIdx >= 0 ? code.slice(pos, semiIdx) : "";
  }

  private findPinModesInLoopBody(body: string, varName: string): Array<{ mode: PinMode }> {
    const pinModeRe = new RegExp(
      String.raw`\bpinMode\s*\(\s*${varName}\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)`,
      "g",
    );
    const modes: Array<{ mode: PinMode }> = [];
    let pmMatch: RegExpExecArray | null;
    while ((pmMatch = pinModeRe.exec(body)) !== null) {
      modes.push({ mode: pmMatch[1] as PinMode });
    }
    return modes;
  }

  private getLoopPinModeCalls(code: string): PinModeCall[] {
    const results: PinModeCall[] = [];
    // Use both typed and bare for-loop regexes to avoid S5843
    for (const forHeaderRe of [PARSER_PATTERNS.FOR_LOOP_TYPED, PARSER_PATTERNS.FOR_LOOP_BARE]) {
      forHeaderRe.lastIndex = 0;

      let forMatch: RegExpExecArray | null;
      while ((forMatch = forHeaderRe.exec(code)) !== null) {
        const varName = forMatch[1];
        const startVal = Number.parseInt(forMatch[2], 10);
        const op = forMatch[3];
        const endVal = Number.parseInt(forMatch[4], 10);
        const lastVal = op === "<=" ? endVal : endVal - 1;
        const forLine = code.slice(0, Math.max(0, forMatch.index)).split("\n").length;

        const body = this.extractLoopBodyFromCode(code, forMatch);
        const modes = this.findPinModesInLoopBody(body, varName);

        for (const { mode } of modes) {
          for (let pin = startVal; pin <= lastVal; pin++) {
            results.push({ pin, mode, line: forLine });
          }
        }
      }
    }

    return results;
  }

  /**
   * Detect pins configured in loops (e.g., for i=0; i<7 with pinMode(i, ...)
   * Returns Set of numeric pin numbers that are likely configured by loop.
   * Delegates to getLoopPinModeCalls so braceless and <= loops are covered.
   */
  private getLoopConfiguredPins(code: string): Set<number> {
    const configuredPins = new Set<number>();
    for (const { pin } of this.getLoopPinModeCalls(removeCommentsHelper(code))) {
      configuredPins.add(pin);
    }
    return configuredPins;
  }

  private checkAnalogWritePWM(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
    const analogWriteRegex = PARSER_PATTERNS.ANALOG_WRITE;
    let match;
    
    while ((match = analogWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      const pin = parsePinNumberHelper(pinStr);
      if (pin !== undefined && !PWM_PINS.has(pin)) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2,
          message: `analogWrite(${pinStr}, ...) used on pin ${pin}, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.`,
          suggestion: `// Use PWM pin instead: analogWrite(3, value);`,
          line: findLineNumberHelper(code, new RegExp(String.raw`analogWrite\s*\(\s*${pinStr}`)),
        });
      }
    }
    return messages;
  }

  private checkDigitalIOSetup(code: string, pinModeSet: Set<string>, loopConfiguredPins: Set<number>): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const digitalReadWriteRegex = PARSER_PATTERNS.DIGITAL_READ_WRITE;
    const warnedPins = new Set<string>();
    let match;

    while ((match = digitalReadWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      if (/^\d+/.test(pinStr) || /^A\d+/.test(pinStr)) {
        const pin = parsePinNumberHelper(pinStr);
        if (!pinModeSet.has(pinStr) && (pin === undefined || !loopConfiguredPins.has(pin)) && !warnedPins.has(pinStr)) {
          warnedPins.add(pinStr);
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "hardware",
            severity: 2,
            message: `Pin ${pinStr} used with digitalRead/digitalWrite but pinMode() was not called for this pin.`,
            suggestion: `pinMode(${pinStr}, INPUT);`,
            line: findLineNumberHelper(code, new RegExp(String.raw`digital(?:Read|Write)\s*\(\s*${pinStr}`)),
          });
        }
      }
    }
    return messages;
  }

  private checkVariablePinUsage(code: string, uncommentedCode: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Identify pins configured via variable names
    const pinModeVarRegex = PARSER_PATTERNS.PIN_MODE_VAR;
    const pinModeVariables = new Set<string>();
    let match;
    while ((match = pinModeVarRegex.exec(uncommentedCode)) !== null) {
      pinModeVariables.add(match[1]);
    }

    // Check if variable pins are used without pinMode and for dynamic usage
    const digitalReadWriteRegex = PARSER_PATTERNS.DIGITAL_READ_WRITE;
    let foundUnconfiguredVariable = false;
    while ((match = digitalReadWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      if (!/^\d+/.test(pinStr) && !/^A\d+/.test(pinStr)) {
        if (!pinModeVariables.has(pinStr) && !foundUnconfiguredVariable) {
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "hardware",
            severity: 2,
            message: `Variable '${pinStr}' used in digitalRead/digitalWrite but no pinMode() call found for this variable.`,
            suggestion: `pinMode(${pinStr}, INPUT);`,
            line: findLineNumberHelper(code, new RegExp(String.raw`digital(?:Read|Write)\s*\(\s*${pinStr}`)),
          });
          foundUnconfiguredVariable = true;
        }
      }
    }

    // Check for dynamic pin usage without any pinMode configuration
    const hasPinModeCalls = PARSER_PATTERNS.PIN_MODE_ANY.test(uncommentedCode);
    if (!hasPinModeCalls && !foundUnconfiguredVariable) {
      if (PARSER_PATTERNS.DIGITAL_DYNAMIC_PIN_READ.test(uncommentedCode) ||
          PARSER_PATTERNS.DIGITAL_DYNAMIC_PIN_WRITE.test(uncommentedCode)) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2,
          message: "digitalRead/digitalWrite uses variable pins without any pinMode() calls. Configure pinMode for the pins being read/written.",
          suggestion: "pinMode(<pin>, INPUT);",
          line: findLineNumberHelper(code, PARSER_PATTERNS.DIGITAL_READ_WRITE),
        });
      }
    }

    return messages;
  }

  parseHardwareCompatibility(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const uncommentedCode = removeCommentsHelper(code);
    const pinChecker = new PinCompatibilityChecker(uncommentedCode);

    // Check analogWrite on non-PWM pins
    messages.push(...this.checkAnalogWritePWM(code));

    // Collect pinMode information
    const pinModeSet = new Set<string>();
    const pinModeRegex = PARSER_PATTERNS.PIN_MODE;
    let match;
    while ((match = pinModeRegex.exec(code)) !== null) {
      pinModeSet.add(match[1]);
    }

    const pinModeCalls = pinChecker.getPinModeInfo((c) => this.getLoopPinModeCalls(c));
    messages.push(...pinChecker.checkPinModeConflicts(pinModeCalls));

    const loopConfiguredPins = this.getLoopConfiguredPins(code);
    messages.push(
      ...this.checkDigitalIOSetup(code, pinModeSet, loopConfiguredPins),
      ...this.checkVariablePinUsage(code, uncommentedCode),
    );

    // Check OUTPUT pins being read
    const outputPins = new Set<number>();
    for (const [pin, entry] of pinModeCalls.entries()) {
      const pinNum = parsePinNumberHelper(pin);
      if (pinNum !== undefined && entry.modes.includes("OUTPUT")) outputPins.add(pinNum);
    }
    for (const { pin, mode } of this.getLoopPinModeCalls(uncommentedCode)) {
      if (mode === "OUTPUT") outputPins.add(pin);
    }
    messages.push(...pinChecker.checkOutputPinsReadAsInput(uncommentedCode, outputPins, parsePinNumberHelper));

    return messages;
  }

  /**
   * Parse pin conflicts (same pin used as digital and analog)
   */
  parsePinConflicts(code: string): ParserMessage[] {
    const analyzer = new PinConflictAnalyzer(code);
    return analyzer.analyze();
  }

  /**
   * Parse performance issues
   */
  parsePerformance(code: string): ParserMessage[] {
    const uncommentedCode = removeCommentsHelper(code);
    const analyzer = new PerformanceAnalyzer(uncommentedCode, code);

    return [
      ...analyzer.analyzeComplexity(),
      ...analyzer.analyzeLargeArraysAndRecursion(),
    ];
  }

  /**
   * Parse all categories and combine results
   */
  parseAll(code: string): ParserMessage[] {
    return [
      ...this.parseSerialConfiguration(code),
      ...this.parseStructure(code),
      ...this.parseHardwareCompatibility(code),
      ...this.parsePinConflicts(code),
      ...this.parsePerformance(code),
    ];
  }

}
