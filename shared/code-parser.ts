import type { ParserMessage } from './schema';

type SeverityLevel = 1 | 2 | 3;

// Browser-compatible UUID generator
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class CodeParser {
  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Remove comments to check active code
    const uncommentedCode = this.removeComments(code);

    // Check if Serial.begin exists at all
    const serialBeginExists = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(code);
    const serialBeginActive = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(uncommentedCode);

    if (!serialBeginActive) {
      if (serialBeginExists) {
        // Serial.begin exists but is commented out
        messages.push({
          id: generateUUID(),
          type: 'warning',
          category: 'serial',
          severity: 2 as SeverityLevel,
          message: 'Serial.begin() is commented out! Serial output may not work correctly.',
          suggestion: 'Serial.begin(115200);',
          line: this.findLineNumber(code, /Serial\s*\.\s*begin/),
        });
      } else {
        // Serial.begin missing entirely
        messages.push({
          id: generateUUID(),
          type: 'warning',
          category: 'serial',
          severity: 2 as SeverityLevel,
          message: 'Serial.begin(115200) is missing in setup(). Serial output may not work correctly.',
          suggestion: 'Serial.begin(115200);',
        });
      }
    } else {
      // Check baudrate
      const baudRateMatch = uncommentedCode.match(/Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/);
      if (baudRateMatch && baudRateMatch[1] !== '115200') {
        messages.push({
          id: generateUUID(),
          type: 'warning',
          category: 'serial',
          severity: 2 as SeverityLevel,
          message: `Serial.begin(${baudRateMatch[1]}) uses wrong baud rate. This simulator expects Serial.begin(115200).`,
          suggestion: 'Serial.begin(115200);',
          line: this.findLineNumber(code, new RegExp(`Serial\\s*\\.\\s*begin\\s*\\(\\s*${baudRateMatch[1]}`)),
        });
      }
    }

    // Check for while (!Serial) antipattern
    if (/while\s*\(\s*!\s*Serial\s*\)/.test(uncommentedCode)) {
      messages.push({
        id: generateUUID(),
        type: 'warning',
        category: 'serial',
        severity: 2 as SeverityLevel,
        message: 'while (!Serial) loop detected. This blocks the simulator - not recommended.',
        suggestion: '// while (!Serial) { }',
        line: this.findLineNumber(code, /while\s*\(\s*!\s*Serial\s*\)/),
      });
    }

    // Check for Serial.read() without Serial.available() check
    const lines = uncommentedCode.split('\n');
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
            id: generateUUID(),
            type: 'warning',
            category: 'serial',
            severity: 2 as SeverityLevel,
            message: 'Serial.read() used without checking Serial.available(). This may return -1 when no data is available.',
            suggestion: 'if (Serial.available()) { }',
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
        id: generateUUID(),
        type: 'warning',
        category: 'structure',
        severity: 2 as SeverityLevel,
        message: 'setup() has parameters, but Arduino setup() should have no parameters.',
        suggestion: 'void setup()',
        line: this.findLineNumber(code, /void\s+setup\s*\(/),
      });
    } else if (!setupMatch) {
      messages.push({
        id: generateUUID(),
        type: 'error',
        category: 'structure',
        severity: 3 as SeverityLevel,
        message: 'Missing void setup() function. Every Arduino program needs setup().',
        suggestion: 'void setup() { }',
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
        id: generateUUID(),
        type: 'warning',
        category: 'structure',
        severity: 2 as SeverityLevel,
        message: 'loop() has parameters, but Arduino loop() should have no parameters.',
        suggestion: 'void loop()',
        line: this.findLineNumber(code, /void\s+loop\s*\(/),
      });
    } else if (!loopMatch) {
      messages.push({
        id: generateUUID(),
        type: 'error',
        category: 'structure',
        severity: 3 as SeverityLevel,
        message: 'Missing void loop() function. Every Arduino program needs loop().',
        suggestion: 'void loop() { }',
      });
    }

    return messages;
  }

  /**
   * Parse hardware compatibility issues
   */
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
          id: generateUUID(),
          type: 'warning',
          category: 'hardware',
          severity: 2 as SeverityLevel,
          message: `analogWrite(${pinStr}, ...) used on pin ${pin}, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.`,
          suggestion: `// Use PWM pin instead: analogWrite(3, value);`,
          line: this.findLineNumber(code, new RegExp(`analogWrite\\s*\\(\\s*${pinStr}`)),
        });
      }
    }

    // Check for pinMode declarations
    const pinModeSet = new Set<string>();
    const pinModeRegex = /pinMode\s*\(\s*(\d+|A\d+)\s*,/g;
    while ((match = pinModeRegex.exec(code)) !== null) {
      pinModeSet.add(match[1]);
    }

    // Check for digitalRead/digitalWrite without pinMode
    const digitalReadWriteRegex = /digital(?:Read|Write)\s*\(\s*(\d+|A\d+)/g;
    const warnedPins = new Set<string>();
    while ((match = digitalReadWriteRegex.exec(code)) !== null) {
      const pinStr = match[1];
      if (!pinModeSet.has(pinStr) && !warnedPins.has(pinStr)) {
        warnedPins.add(pinStr);
        messages.push({
          id: generateUUID(),
          type: 'warning',
          category: 'hardware',
          severity: 2 as SeverityLevel,
          message: `Pin ${pinStr} used with digitalRead/digitalWrite but pinMode() was not called for this pin.`,
          suggestion: `pinMode(${pinStr}, INPUT);`,
          line: this.findLineNumber(code, new RegExp(`digital(?:Read|Write)\\s*\\(\\s*${pinStr}`)),
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
    const digitalRegex = /(?:digital(?:Write|Read)|pinMode)\s*\(\s*(\d+|A\d+)/gi;
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
          id: generateUUID(),
          type: 'warning',
          category: 'hardware',
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
        id: generateUUID(),
        type: 'warning',
        category: 'performance',
        severity: 2 as SeverityLevel,
        message: 'Infinite while(true) loop detected. This may freeze the simulator.',
        suggestion: 'delay(100);',
        line: this.findLineNumber(code, /while\s*\(\s*true\s*\)/),
      });
    }

    // Check for for loops without exit condition
    const forLoopRegex = /for\s*\(\s*[^;]+;\s*;\s*[^)]+\)/;
    if (forLoopRegex.test(code)) {
      messages.push({
        id: generateUUID(),
        type: 'warning',
        category: 'performance',
        severity: 2 as SeverityLevel,
        message: 'for loop without exit condition detected. This creates an infinite loop.',
        suggestion: 'for (int i = 0; i < 10; i++) { }',
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
          id: generateUUID(),
          type: 'warning',
          category: 'performance',
          severity: 2 as SeverityLevel,
          message: `Large array of ${arraySize} elements detected. This may cause memory issues on Arduino.`,
          suggestion: `// Use smaller array size: int array[100];`,
          line: this.findLineNumber(code, arrayRegex),
        });
      }
    }

    // Check for recursion
    const functionRegex = /(\w+)\s*\([^)]*\)\s*{[^}]*\1\s*\(/;
    if (functionRegex.test(code)) {
      messages.push({
        id: generateUUID(),
        type: 'warning',
        category: 'performance',
        severity: 2 as SeverityLevel,
        message: 'Recursive function detected. Deep recursion may cause stack overflow on Arduino.',
        suggestion: '// Use iterative approach instead',
      });
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
    let result = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
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
  private findLineNumber(code: string, pattern: RegExp | string): number | undefined {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const match = regex.exec(code);
    if (!match) return undefined;

    const upToMatch = code.substring(0, match.index);
    const lineNumber = upToMatch.split('\n').length;
    return lineNumber;
  }
}
