import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  PIN_PATTERNS,
  parsePinNumber,
} from "@shared/parser-patterns";

/**
 * Parser for pin conflicts (same pin used as digital and analog)
 * 
 * Rules:
 * 1. Digital + analog on same pin
 * 2. Multiple conflicts
 * 3. Numeric pin notation
 */
export class PinConflictsParser {
  constructor(private readonly code: string) {}

  parse(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const digitalPins = new Set<number>();
    let match;

    for (const re of [PIN_PATTERNS.WRITE_READ_PIN, PIN_PATTERNS.WRITE_READ_DIO]) {
      re.lastIndex = 0;
      while ((match = re.exec(this.code)) !== null) {
        const pin = parsePinNumber(match[1]);
        if (pin !== undefined) digitalPins.add(pin);
      }
    }

    const analogPins = new Set<number>();
    const analogRegex = PIN_PATTERNS.ANALOG_READ_WRITE;
    while ((match = analogRegex.exec(this.code)) !== null) {
      const pin = parsePinNumber(match[1]);
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
