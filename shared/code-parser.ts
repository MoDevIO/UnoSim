import type { ParserMessage } from "./schema";
import { randomUUID } from "crypto";

type SeverityLevel = 1 | 2 | 3;

export class CodeParser {
  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Remove comments to check active code
    const uncommentedCode = this.removeComments(code);

    // Check if Serial is actually used (print, println, read, write, available, etc.)
    const serialUsageRegex =
      /Serial\s*\.\s*(print|println|write|read|available|peek|readString|readBytes|parseInt|parseFloat|find|findUntil)/;
    const isSerialUsed = serialUsageRegex.test(uncommentedCode);

    // Only check Serial.begin if Serial is actually being used
    if (!isSerialUsed) {
      return messages; // No Serial usage, no warnings needed
    }

    // Check if Serial.begin exists at all
    const serialBeginExists = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(code);
    const serialBeginActive = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(
      uncommentedCode,
    );

    if (!serialBeginActive) {
      if (serialBeginExists) {
        // Serial.begin exists but is commented out
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "serial",
          severity: 2 as SeverityLevel,
          message:
            "Serial.begin() is commented out! Serial output may not work correctly.",
          suggestion: "Serial.begin(115200);",
          line: this.findLineNumber(code, /Serial\s*\.\s*begin/),
        });
      } else {
        // Serial.begin missing entirely
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "serial",
          severity: 2 as SeverityLevel,
          message:
            "Serial.begin(115200) is missing in setup(). Serial output may not work correctly.",
          suggestion: "Serial.begin(115200);",
        });
      }
    } else {
      // Check baudrate
      const baudRateMatch = uncommentedCode.match(
        /Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/,
      );
      if (baudRateMatch && baudRateMatch[1] !== "115200") {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "serial",
          severity: 2 as SeverityLevel,
          message: `Serial.begin(${baudRateMatch[1]}) uses wrong baud rate. This simulator expects Serial.begin(115200).`,
          suggestion: "Serial.begin(115200);",
          line: this.findLineNumber(
            code,
            new RegExp(`Serial\\s*\\.\\s*begin\\s*\\(\\s*${baudRateMatch[1]}`),
          ),
        });
      }
    }

    // Check for while (!Serial) antipattern
    if (/while\s*\(\s*!\s*Serial\s*\)/.test(uncommentedCode)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "serial",
        severity: 2 as SeverityLevel,
        message:
          "while (!Serial) loop detected. This blocks the simulator - not recommended.",
        suggestion: "// while (!Serial) { }",
        line: this.findLineNumber(code, /while\s*\(\s*!\s*Serial\s*\)/),
      });
    }

    // Check for Serial.read() without Serial.available() check
    const lines = uncommentedCode.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check if line has Serial.read() but not preceded by Serial.available check
      if (/Serial\s*\.\s*read\s*\(\s*\)/.test(line)) {
        // Look back to see if there's an available check nearby
        let hasAvailableCheck = false;
        for (let j = Math.max(0, i - 3); j <= i; j++) {
          if (/Serial\s*\.\s*available\s*\(\s*\)/.test(lines[j])) {
            hasAvailableCheck = true;
            break;
          }
        }

        if (!hasAvailableCheck) {
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "serial",
            severity: 2 as SeverityLevel,
            message:
              "Serial.read() used without checking Serial.available(). This may return -1 when no data is available.",
            suggestion: "if (Serial.available()) { }",
            line: this.findLineNumber(code, /Serial\s*\.\s*read\s*\(\s*\)/),
          });
          break; // Only report once
        }
      }
    }

    return messages;
  }

  /**
   * Parse structure issues (setup/loop)
   */
  parseStructure(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check for void setup() with proper signatures
    const setupRegex = /void\s+setup\s*\(\s*\)/;
    const setupMatch = setupRegex.test(code);

    // Check for any setup() function (even with wrong signature)
    const anySetup = /void\s+setup\s*\([^)]*\)/.test(code);

    if (!setupMatch && anySetup) {
      // setup() exists but has parameters
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2 as SeverityLevel,
        message:
          "setup() has parameters, but Arduino setup() should have no parameters.",
        suggestion: "void setup()",
        line: this.findLineNumber(code, /void\s+setup\s*\(/),
      });
    } else if (!setupMatch) {
      messages.push({
        id: randomUUID(),
        type: "error",
        category: "structure",
        severity: 3 as SeverityLevel,
        message:
          "Missing void setup() function. Every Arduino program needs setup().",
        suggestion: "void setup() { }",
      });
    }

    // Check for void loop()
    const loopRegex = /void\s+loop\s*\(\s*\)/;
    const loopMatch = loopRegex.test(code);

    // Check for any loop() function
    const anyLoop = /void\s+loop\s*\([^)]*\)/.test(code);

    if (!loopMatch && anyLoop) {
      // loop() exists but has parameters
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "structure",
        severity: 2 as SeverityLevel,
        message:
          "loop() has parameters, but Arduino loop() should have no parameters.",
        suggestion: "void loop()",
        line: this.findLineNumber(code, /void\s+loop\s*\(/),
      });
    } else if (!loopMatch) {
      messages.push({
        id: randomUUID(),
        type: "error",
        category: "structure",
        severity: 3 as SeverityLevel,
        message:
          "Missing void loop() function. Every Arduino program needs loop().",
        suggestion: "void loop() { }",
      });
    }

    return messages;
  }

  /**
   * Detect pins configured in loops (e.g., for i=0; i<7 with pinMode(i, ...)
   * Returns Set of numeric pin numbers that are likely configured by loop
   */
  private getLoopConfiguredPins(code: string): Set<number> {
    const configuredPins = new Set<number>();

    // Find for loops with pinMode calls using loop variable
    // Pattern: for (type var = start; var < end; ...) { ... pinMode(var, ...) ... }
    const loopRegex =
      /for\s*\(\s*(?:byte|int|var)?\s*([a-zA-Z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\d+)\s*;[^)]*\)\s*\{[^}]*pinMode\s*\(\s*\1\s*,/gi;
    let match;

    while ((match = loopRegex.exec(code)) !== null) {
      const startVal = parseInt(match[2], 10);
      const endVal = parseInt(match[3], 10);

      // Add all pins that would be configured by this loop (start to end-1)
      for (let i = startVal; i < endVal; i++) {
        configuredPins.add(i);
      }
    }

    return configuredPins;
  }
  parseHardwareCompatibility(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Valid PWM pins on Arduino UNO: 3, 5, 6, 9, 10, 11
    const PWM_PINS = [3, 5, 6, 9, 10, 11];

    // Check for analogWrite on non-PWM pins
    const analogWriteRegex = /analogWrite\s*\(\s*(\d+|A\d+)\s*,/g;
    let match;
    while ((match = analogWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      const pin = this.parsePinNumber(pinStr);

      if (pin !== undefined && !PWM_PINS.includes(pin)) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2 as SeverityLevel,
          message: `analogWrite(${pinStr}, ...) used on pin ${pin}, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.`,
          suggestion: `// Use PWM pin instead: analogWrite(3, value);`,
          line: this.findLineNumber(
            code,
            new RegExp(`analogWrite\\s*\\(\\s*${pinStr}`),
          ),
        });
      }
    }

    // Check for pinMode declarations
    const pinModeSet = new Set<string>();
    const pinModeRegex = /pinMode\s*\(\s*(\d+|A\d+)\s*,/g;
    while ((match = pinModeRegex.exec(code)) !== null) {
      pinModeSet.add(match[1]);
    }

    // Also detect pins configured in loops
    const loopConfiguredPins = this.getLoopConfiguredPins(code);

    // Check for digitalRead/digitalWrite without pinMode
    const digitalReadWriteRegex =
      /digital(?:Read|Write)\s*\(\s*(\d+|A\d+|[a-zA-Z_]\w*)/g;
    const warnedPins = new Set<string>();
    const usedVariables = new Set<string>();

    while ((match = digitalReadWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      usedVariables.add(pinStr); // Track all variable/pin references

      if (/^\d+/.test(pinStr) || /^A\d+/.test(pinStr)) {
        // Literal pin number
        const pin = this.parsePinNumber(pinStr);
        // Only warn if not explicitly configured with pinMode AND not in a loop range
        if (
          !pinModeSet.has(pinStr) &&
          (pin === undefined || !loopConfiguredPins.has(pin)) &&
          !warnedPins.has(pinStr)
        ) {
          warnedPins.add(pinStr);
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "hardware",
            severity: 2 as SeverityLevel,
            message: `Pin ${pinStr} used with digitalRead/digitalWrite but pinMode() was not called for this pin.`,
            suggestion: `pinMode(${pinStr}, INPUT);`,
            line: this.findLineNumber(
              code,
              new RegExp(`digital(?:Read|Write)\\s*\\(\\s*${pinStr}`),
            ),
          });
        }
      }
    }

    // Check if variable pins are used with pinMode - warn if there's a mismatch
    const pinModeVarRegex = /pinMode\s*\(\s*([a-zA-Z_]\w*)\s*,/g;
    const pinModeVariables = new Set<string>();
    while ((match = pinModeVarRegex.exec(this.removeComments(code))) !== null) {
      pinModeVariables.add(match[1]);
    }

    // Warn if digitalRead/digitalWrite uses variables not covered by pinMode
    for (const usedVar of usedVariables) {
      if (!/^\d+/.test(usedVar) && !/^A\d+/.test(usedVar)) {
        // It's a variable
        if (!pinModeVariables.has(usedVar)) {
          messages.push({
            id: randomUUID(),
            type: "warning",
            category: "hardware",
            severity: 2 as SeverityLevel,
            message: `Variable '${usedVar}' used in digitalRead/digitalWrite but no pinMode() call found for this variable.`,
            suggestion: `pinMode(${usedVar}, INPUT);`,
            line: this.findLineNumber(
              code,
              new RegExp(`digital(?:Read|Write)\\s*\\(\\s*${usedVar}`),
            ),
          });
          break; // Only warn once per unique variable
        }
      }
    }

    // Handle dynamic pin usage (e.g., digitalRead(i)) where pin numbers are not literals.
    // Only warn if NO pinMode calls exist at all. If pinMode is called (even in a loop),
    // we assume pins are being configured dynamically.
    const hasPinModeCalls = /pinMode\s*\(\s*[^,)]+\s*,/.test(
      this.removeComments(code),
    );
    if (!hasPinModeCalls) {
      const dynamicDigitalUse = /digital(?:Read|Write)\s*\(\s*[^0-9A\s][^,)]*/;
      if (dynamicDigitalUse.test(this.removeComments(code))) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2 as SeverityLevel,
          message:
            "digitalRead/digitalWrite uses variable pins without any pinMode() calls. Configure pinMode for the pins being read/written.",
          suggestion: "pinMode(<pin>, INPUT);",
          line: this.findLineNumber(code, /digital(?:Read|Write)\s*\(/),
        });
      }
    }

    // SPI and I2C pin warnings removed - not necessary for simulation

    return messages;
  }

  /**
   * Parse pin conflicts (same pin used as digital and analog)
   */
  parsePinConflicts(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Find all pins used in digitalWrite/digitalRead/pinMode
    const digitalPins = new Set<number>();
    const digitalRegex =
      /(?:digital(?:Write|Read)|pinMode)\s*\(\s*(\d+|A\d+)/gi;
    let match;
    while ((match = digitalRegex.exec(code)) !== null) {
      const pin = this.parsePinNumber(match[1]);
      if (pin !== undefined) {
        digitalPins.add(pin);
      }
    }

    // Find all pins used in analogRead/analogWrite
    const analogPins = new Set<number>();
    const analogRegex = /analog(?:Read|Write)\s*\(\s*(\d+|A\d+)/gi;
    while ((match = analogRegex.exec(code)) !== null) {
      const pin = this.parsePinNumber(match[1]);
      if (pin !== undefined) {
        analogPins.add(pin);
      }
    }

    // Find conflicts
    for (const pin of digitalPins) {
      if (analogPins.has(pin)) {
        const pinStr = pin >= 14 ? `A${pin - 14}` : `${pin}`;
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "hardware",
          severity: 2 as SeverityLevel,
          message: `Pin ${pinStr} used as both digital (digitalWrite/digitalRead) and analog (analogRead/analogWrite). This may be unintended.`,
          suggestion: `// Use separate pins for digital and analog`,
        });
      }
    }

    return messages;
  }

  /**
   * Parse performance issues
   */
  parsePerformance(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Check for while (true) loops
    if (/while\s*\(\s*true\s*\)/.test(code)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2 as SeverityLevel,
        message:
          "Infinite while(true) loop detected. This may freeze the simulator.",
        suggestion: "delay(100);",
        line: this.findLineNumber(code, /while\s*\(\s*true\s*\)/),
      });
    }

    // Check for for loops without exit condition
    const forLoopRegex = /for\s*\(\s*[^;]+;\s*;\s*[^)]+\)/;
    if (forLoopRegex.test(code)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2 as SeverityLevel,
        message:
          "for loop without exit condition detected. This creates an infinite loop.",
        suggestion: "for (int i = 0; i < 10; i++) { }",
        line: this.findLineNumber(code, forLoopRegex),
      });
    }

    // Check for large arrays
    const arrayRegex = /\[\s*(\d{4,})\s*\]/;
    const arrayMatch = code.match(arrayRegex);
    if (arrayMatch) {
      const arraySize = parseInt(arrayMatch[1]);
      if (arraySize > 1000) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "performance",
          severity: 2 as SeverityLevel,
          message: `Large array of ${arraySize} elements detected. This may cause memory issues on Arduino.`,
          suggestion: `// Use smaller array size: int array[100];`,
          line: this.findLineNumber(code, arrayRegex),
        });
      }
    }

    // Check for recursion
    // Match function definitions: return_type function_name(params) { ... }
    // Exclude keywords like if, for, while, switch
    const functionDefinitionRegex =
      /(?:void|int|bool|byte|long|float|double|char|String|unsigned\s+int|unsigned\s+long)\s+(\w+)\s*\([^)]*\)\s*\{/g;
    const uncommentedCode = this.removeComments(code);

    let match;
    while ((match = functionDefinitionRegex.exec(uncommentedCode)) !== null) {
      const functionName = match[1];
      const functionStart = match.index;

      // Find the end of this function by counting braces
      let braceCount = 0;
      let foundOpenBrace = false;
      let functionEnd = functionStart;

      for (let i = functionStart; i < uncommentedCode.length; i++) {
        if (uncommentedCode[i] === "{") {
          braceCount++;
          foundOpenBrace = true;
        } else if (uncommentedCode[i] === "}") {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            functionEnd = i;
            break;
          }
        }
      }

      // Extract function body
      const functionBody = uncommentedCode.substring(
        functionStart,
        functionEnd + 1,
      );

      // Check if function calls itself (recursive)
      const functionCallRegex = new RegExp(`\\b${functionName}\\s*\\(`, "g");
      // Count calls - there should be the definition itself, so if we find more than 1, it's recursive
      const calls = functionBody.match(functionCallRegex);
      if (calls && calls.length > 1) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "performance",
          severity: 2 as SeverityLevel,
          message: `Recursive function '${functionName}' detected. Deep recursion may cause stack overflow on Arduino.`,
          suggestion: "// Use iterative approach instead",
          line: this.findLineNumber(
            code,
            new RegExp(`\\b${functionName}\\s*\\(`),
          ),
        });
      }
    }

    return messages;
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

  /**
   * Remove comments from code (both single-line and multi-line)
   */
  private removeComments(code: string): string {
    // Remove single-line comments
    let result = code.replace(/\/\/.*$/gm, "");
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");
    return result;
  }

  /**
   * Parse pin number from string (e.g., "13" or "A0")
   */
  private parsePinNumber(pinStr: string): number | undefined {
    if (/^A\d+$/.test(pinStr)) {
      // Analog pin (A0-A5 map to 14-19 internally)
      const analogNum = parseInt(pinStr.substring(1));
      if (analogNum >= 0 && analogNum <= 5) {
        return 14 + analogNum;
      }
    } else {
      // Digital pin
      const digitalNum = parseInt(pinStr);
      if (!isNaN(digitalNum) && digitalNum >= 0 && digitalNum <= 19) {
        return digitalNum;
      }
    }
    return undefined;
  }

  /**
   * Find line number where pattern occurs
   */
  private findLineNumber(
    code: string,
    pattern: RegExp | string,
  ): number | undefined {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    const match = regex.exec(code);
    if (!match) return undefined;

    const upToMatch = code.substring(0, match.index);
    const lineNumber = upToMatch.split("\n").length;
    return lineNumber;
  }
}
