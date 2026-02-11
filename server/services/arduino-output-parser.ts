// arduino-output-parser.ts
// Pure parsing logic for Arduino C++ mock output

import { Logger } from "@shared/logger";
import type { IOPinRecord } from "@shared/schema";

const logger = new Logger("ArduinoOutputParser");

/**
 * Parsed stderr output types (discriminated union for type safety)
 */
export type ParsedStderrOutput =
  | { type: "serial_event"; timestamp: number; data: string }
  | { type: "registry_start" }
  | { type: "registry_end" }
  | {
      type: "registry_pin";
      pinRecord: IOPinRecord;
    }
  | { type: "pin_mode"; pin: number; mode: number }
  | { type: "pin_value"; pin: number; value: number }
  | { type: "pin_pwm"; pin: number; value: number }
  | { type: "debug_marker"; marker: string }
  | { type: "text"; line: string }
  | { type: "ignored" };

/**
 * ArduinoOutputParser - Stateless parser for Arduino mock output
 * 
 * Responsibilities:
 * - Parse stderr lines from C++ Arduino mock
 * - Extract structured data (serial events, pin states, registry)
 * - No side effects - pure functions only
 */
export class ArduinoOutputParser {
  private static readonly PATTERNS = {
    serialEvent: /\[\[SERIAL_EVENT:(\d+):([A-Za-z0-9+/=]+)\]\]/,
    registryStart: /\[\[IO_REGISTRY_START\]\]/,
    registryEnd: /\[\[IO_REGISTRY_END\]\]/,
    registryPin: /\[\[IO_PIN:([^:]+):([01]):(\d+):(\d+):?(.*)\]\]/,
    pinMode: /\[\[PIN_MODE:(\d+):(\d+)\]\]/,
    pinValue: /\[\[PIN_VALUE:(\d+):(\d+)\]\]/,
    pinPwm: /\[\[PIN_PWM:(\d+):(\d+)\]\]/,
    // Debug markers - should be ignored
    digitalRead: /\[\[DREAD:(\d+):(\d+)\]\]/,
    pinSet: /\[\[PIN_SET:(\d+):(\d+)\]\]/,
    stdinRecv: /\[\[STDIN_RECV:(.+)\]\]/,
    // Pause/Resume timing markers - should be ignored
    timeFrozen: /\[\[TIME_FROZEN:(\d+)\]\]/,
    timeResumed: /\[\[TIME_RESUMED:(\d+)\]\]/,
  };

  /**
   * Parse a single stderr line from Arduino mock process
   * Priority order: registry markers > pin states > serial events > text
   * 
   * @param line - Raw stderr line
   * @param processStartTime - Server timestamp when process started (for serial event timestamps)
   * @returns Structured ParsedStderrOutput object
   */
  parseStderrLine(
    line: string,
    processStartTime: number | null,
  ): ParsedStderrOutput {
    // Priority 1: Registry markers (start/end)
    if (ArduinoOutputParser.PATTERNS.registryStart.test(line)) {
      return { type: "registry_start" };
    }
    if (ArduinoOutputParser.PATTERNS.registryEnd.test(line)) {
      return { type: "registry_end" };
    }

    // Priority 2: Registry pin data
    const registryPinMatch = line.match(
      ArduinoOutputParser.PATTERNS.registryPin,
    );
    if (registryPinMatch) {
      const pinRecord = this.parseRegistryPin(registryPinMatch);
      if (pinRecord) {
        return { type: "registry_pin", pinRecord };
      }
    }

    // Priority 3: Pin state changes
    const pinModeMatch = line.match(ArduinoOutputParser.PATTERNS.pinMode);
    if (pinModeMatch) {
      return {
        type: "pin_mode",
        pin: parseInt(pinModeMatch[1]),
        mode: parseInt(pinModeMatch[2]),
      };
    }

    const pinValueMatch = line.match(ArduinoOutputParser.PATTERNS.pinValue);
    if (pinValueMatch) {
      return {
        type: "pin_value",
        pin: parseInt(pinValueMatch[1]),
        value: parseInt(pinValueMatch[2]),
      };
    }

    const pinPwmMatch = line.match(ArduinoOutputParser.PATTERNS.pinPwm);
    if (pinPwmMatch) {
      return {
        type: "pin_pwm",
        pin: parseInt(pinPwmMatch[1]),
        value: parseInt(pinPwmMatch[2]),
      };
    }

    // Priority 4: Serial events
    const serialEventMatch = line.match(
      ArduinoOutputParser.PATTERNS.serialEvent,
    );
    if (serialEventMatch) {
      const parsed = this.parseSerialEvent(
        serialEventMatch[1],
        serialEventMatch[2],
        processStartTime,
      );
      if (parsed) {
        return parsed;
      }
    }

    // Priority 5: Debug markers (ignore these)
    if (
      ArduinoOutputParser.PATTERNS.digitalRead.test(line) ||
      ArduinoOutputParser.PATTERNS.pinSet.test(line) ||
      ArduinoOutputParser.PATTERNS.stdinRecv.test(line) ||
      ArduinoOutputParser.PATTERNS.timeFrozen.test(line) ||
      ArduinoOutputParser.PATTERNS.timeResumed.test(line)
    ) {
      return { type: "ignored" };
    }

    // Priority 6: Protocol fragments (from interrupted writes during SIGSTOP/SIGCONT)
    // These occur when C++ is mid-write of a [[...]] message when SIGSTOP arrives.
    // After SIGCONT, the rest of the message (e.g., "]]") arrives as a separate chunk.
    // Ignore: standalone "]]", lines starting with "[[" that don't match known patterns,
    // or partial base64 data that looks like protocol message tails.
    if (
      line === "]]" ||
      line === "[[" ||
      /^\[\[.{0,20}$/.test(line) && !line.includes("]]") ||  // Partial [[... without closing
      /^[A-Za-z0-9+/=]{1,50}\]\]$/.test(line)  // base64 tail + ]]
    ) {
      logger.debug(`Ignoring protocol fragment: ${line}`);
      return { type: "ignored" };
    }

    // Default: Regular text (error/warning message)
    return { type: "text", line };
  }

  /**
   * Parse serial event from base64 encoded data
   * 
   * @param timestampStr - Raw timestamp string (millis since process start)
   * @param base64Data - Base64 encoded serial data
   * @param processStartTime - Server-side process start timestamp
   * @returns Parsed serial event or null on error
   */
  private parseSerialEvent(
    timestampStr: string,
    base64Data: string,
    processStartTime: number | null,
  ): ParsedStderrOutput | null {
    try {
      const ts = parseInt(timestampStr, 10);
      const buf = Buffer.from(base64Data, "base64");
      const decoded = buf.toString("utf8");

      return {
        type: "serial_event",
        timestamp: (processStartTime || Date.now()) + ts,
        data: decoded,
      };
    } catch (e) {
      logger.warn(
        `Failed to parse SERIAL_EVENT: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Parse I/O registry pin definition
   * Format: [[IO_PIN:pin:defined:line:pinMode:operations]]
   * 
   * @param match - Regex match array from registryPin pattern
   * @returns IOPinRecord or null on error
   */
  private parseRegistryPin(match: RegExpMatchArray): IOPinRecord | null {
    try {
      const pin = match[1];
      const defined = match[2] === "1";
      const definedLine = parseInt(match[3]);
      const pinModeParsed = parseInt(match[4]);
      const operationsStr = match[5];

      const usedAt: Array<{ line: number; operation: string }> = [];
      if (operationsStr) {
        // Parse operations: "pinMode:1@0:digitalWrite@5" -> extract operation@line pairs
        const opMatches = operationsStr.match(/([^:@]+(?::\d+)?@\d+)/g);
        if (opMatches) {
          opMatches.forEach((opMatch) => {
            if (opMatch && !opMatch.startsWith("_count")) {
              // Skip metadata like _count
              const atIndex = opMatch.lastIndexOf("@");
              if (atIndex > 0) {
                const operation = opMatch.substring(0, atIndex);
                const lineStr = opMatch.substring(atIndex + 1);
                usedAt.push({
                  line: parseInt(lineStr) || 0,
                  operation,
                });
              }
            }
          });
        }
      }

      return {
        pin,
        defined,
        pinMode: pinModeParsed,
        definedAt: defined ? { line: definedLine } : undefined,
        usedAt,
      };
    } catch (e) {
      logger.warn(
        `Failed to parse registry pin: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
