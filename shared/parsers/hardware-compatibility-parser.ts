import type { ParserMessage } from "../schema";
import type { PinMode } from "@shared/types/arduino.types";
import { randomUUID } from "node:crypto";
import {
  PIN_PATTERNS,
  parsePinNumber,
  removeComments,
  findLineNumber,
  FOR_LOOP_TYPED,
  FOR_LOOP_BARE,
} from "@shared/parser-patterns";

interface PinModeCall {
  pin: number;
  mode: PinMode;
  line: number;
}

interface PinModeEntry {
  modes: Array<PinMode>;
  lines: number[];
}

const VALID_PIN_MODES = new Set<string>(["INPUT", "OUTPUT", "INPUT_PULLUP"]);

function addPinModeEntry(result: Map<string, PinModeEntry>, pin: string, mode: PinMode, line: number): void {
  const existing = result.get(pin);
  if (existing) {
    existing.modes.push(mode);
    existing.lines.push(line);
  } else {
    result.set(pin, { modes: [mode], lines: [line] });
  }
}

/**
 * Parser for hardware compatibility issues
 * 
 * Rules:
 * 1. PWM on non-PWM pins
 * 2. Missing pinMode() for digital I/O
 * 3. Variable pins without pinMode
 * 4. Multiple pinMode() for same pin
 * 5. OUTPUT pins being read
 */
export class HardwareCompatibilityParser {
  private pinModeCalls: Map<string, PinModeEntry>;

  constructor(private readonly code: string) {
    this.code = code;
    const uncommentedCode = removeComments(code);
    const pinChecker = new PinCompatibilityChecker(uncommentedCode);
    this.pinModeCalls = pinChecker.getPinModeInfo((c) => this.getLoopPinModeCalls(c));
  }

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check analogWrite on non-PWM pins
    messages.push(...this.checkAnalogWritePWM());

    // Collect pinMode information
    const pinModeSet = new Set<string>();
    const pinModeRegex = PIN_PATTERNS.MODE;
    let match;
    while ((match = pinModeRegex.exec(this.code)) !== null) {
      pinModeSet.add(match[1]);
    }

    const pinChecker = new PinCompatibilityChecker(removeComments(this.code));
    messages.push(...pinChecker.checkPinModeConflicts(this.pinModeCalls));

    const loopConfiguredPins = this.getLoopConfiguredPins();
    messages.push(
      ...this.checkDigitalIOSetup(pinModeSet, loopConfiguredPins),
      ...this.checkVariablePinUsage(),
    );

    // Check OUTPUT pins being read
    const outputPins = new Set<number>();
    for (const [pin, entry] of this.pinModeCalls.entries()) {
      const pinNum = parsePinNumber(pin);
      if (pinNum !== undefined && entry.modes.includes("OUTPUT")) outputPins.add(pinNum);
    }
    for (const { pin, mode } of this.getLoopPinModeCalls(removeComments(this.code))) {
      if (mode === "OUTPUT") outputPins.add(pin);
    }
    messages.push(...pinChecker.checkOutputPinsReadAsInput(removeComments(this.code), outputPins, parsePinNumber));

    return messages;
  }

  private checkAnalogWritePWM(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
    const analogWriteRegex = PIN_PATTERNS.ANALOG_WRITE;
    let match;
    
    while ((match = analogWriteRegex.exec(this.code)) !== null) {
      const pinStr = match[1];
      const pin = parsePinNumber(pinStr);
      if (pin !== undefined && !PWM_PINS.has(pin)) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2,
          message: `analogWrite(${pinStr}, ...) used on pin ${pin}, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.`,
          suggestion: `// Use PWM pin instead: analogWrite(3, value);`,
          line: findLineNumber(this.code, new RegExp(String.raw`analogWrite\s*\(\s*${pinStr}`)),
        });
      }
    }
    return messages;
  }

  private checkDigitalIOSetup(pinModeSet: Set<string>, loopConfiguredPins: Set<number>): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const digitalReadWriteRegex = PIN_PATTERNS.DIGITAL_READ_WRITE;
    const warnedPins = new Set<string>();
    let match;

    while ((match = digitalReadWriteRegex.exec(this.code)) !== null) {
      const pinStr = match[1];
      if (/^\d+/.test(pinStr) || /^A\d+/.test(pinStr)) {
        const pin = parsePinNumber(pinStr);
        if (!pinModeSet.has(pinStr) && (pin === undefined || !loopConfiguredPins.has(pin)) && !warnedPins.has(pinStr)) {
          warnedPins.add(pinStr);
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "hardware",
            severity: 2,
            message: `Pin ${pinStr} used with digitalRead/digitalWrite but pinMode() was not called for this pin.`,
            suggestion: `pinMode(${pinStr}, INPUT);`,
            line: findLineNumber(this.code, new RegExp(String.raw`digital(?:Read|Write)\s*\(\s*${pinStr}`)),
          });
        }
      }
    }
    return messages;
  }

  private checkVariablePinUsage(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const uncommentedCode = removeComments(this.code);

    // Identify pins configured via variable names
    const pinModeVarRegex = PIN_PATTERNS.MODE_VAR;
    const pinModeVariables = new Set<string>();
    let match;
    while ((match = pinModeVarRegex.exec(uncommentedCode)) !== null) {
      pinModeVariables.add(match[1]);
    }

    // Check if variable pins are used without pinMode and for dynamic usage
    const digitalReadWriteRegex = PIN_PATTERNS.DIGITAL_READ_WRITE;
    let foundUnconfiguredVariable = false;
    while ((match = digitalReadWriteRegex.exec(this.code)) !== null) {
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
            line: findLineNumber(this.code, new RegExp(String.raw`digital(?:Read|Write)\s*\(\s*${pinStr}`)),
          });
          foundUnconfiguredVariable = true;
        }
      }
    }

    // Check for dynamic pin usage without any pinMode configuration
    const hasPinModeCalls = PIN_PATTERNS.MODE_ANY.test(uncommentedCode);
    if (!hasPinModeCalls && !foundUnconfiguredVariable) {
      if (PIN_PATTERNS.DYNAMIC_PIN_READ.test(uncommentedCode) ||
          PIN_PATTERNS.DYNAMIC_PIN_WRITE.test(uncommentedCode)) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2,
          message: "digitalRead/digitalWrite uses variable pins without any pinMode() calls. Configure pinMode for the pins being read/written.",
          suggestion: "pinMode(<pin>, INPUT);",
          line: findLineNumber(this.code, PIN_PATTERNS.DIGITAL_READ_WRITE),
        });
      }
    }

    return messages;
  }

  private getLoopConfiguredPins(): Set<number> {
    const configuredPins = new Set<number>();
    for (const { pin } of this.getLoopPinModeCalls(removeComments(this.code))) {
      configuredPins.add(pin);
    }
    return configuredPins;
  }

  private getLoopPinModeCalls(code: string): PinModeCall[] {
    const results: PinModeCall[] = [];
    // Use both typed and bare for-loop regexes to avoid S5843
    for (const forHeaderRe of [FOR_LOOP_TYPED, FOR_LOOP_BARE]) {
      forHeaderRe.lastIndex = 0;

      let forMatch: RegExpExecArray | null;
      while ((forMatch = forHeaderRe.exec(code)) !== null) {
        // Groups: [1]=type/empty, [2]=var, [3]=start, [4]=op, [5]=limit
        const varName = forMatch[2];
        const startVal = Number.parseInt(forMatch[3], 10);
        const op = forMatch[4];
        const endVal = Number.parseInt(forMatch[5], 10);
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
    const pinModeWithModeRegex = PIN_PATTERNS.MODE_WITH_MODE;
    let match;
    while ((match = pinModeWithModeRegex.exec(this.uncommentedCode)) !== null) {
      const pin = match[1];
      const rawMode = match[2];
      const mode: PinMode = VALID_PIN_MODES.has(rawMode) ? (rawMode as PinMode) : "INPUT";
      const line = this.uncommentedCode.slice(0, Math.max(0, match.index)).split("\n").length;
      addPinModeEntry(result, pin, mode, line);
    }

    // Loop-based pinMode() calls
    for (const { pin, mode, line } of getLoopPinModeCalls(this.uncommentedCode)) {
      addPinModeEntry(result, String(pin), mode, line);
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
          message: `Pin ${pin} has multiple pinMode() calls with different modes: ${[...uniqueModes].join(", ")}.`,
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
      const digitalReadLiteralRe = PIN_PATTERNS.DIGITAL_READ_LITERAL;
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
          const pinStr = pinNum >= 14 ? `A${pinNum - 14}` : `${pinNum}`;
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
