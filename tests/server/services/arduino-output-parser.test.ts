// arduino-output-parser.test.ts
// Unit tests for ArduinoOutputParser

// ...existing code...
import { ArduinoOutputParser } from "../../../server/services/arduino-output-parser";

describe("ArduinoOutputParser", () => {
  const parser = new ArduinoOutputParser();
  const processStartTime = Date.now();

  describe("parseStderrLine", () => {
    it("should parse registry start marker", () => {
      const result = parser.parseStderrLine(
        "[[IO_REGISTRY_START]]",
        processStartTime,
      );
      expect(result.type).toBe("registry_start");
    });

    it("should parse registry end marker", () => {
      const result = parser.parseStderrLine(
        "[[IO_REGISTRY_END]]",
        processStartTime,
      );
      expect(result.type).toBe("registry_end");
    });

    it("should parse registry pin definition", () => {
      const result = parser.parseStderrLine(
        "[[IO_PIN:13:1:10:1:pinMode:1@10:digitalWrite@15]]",
        processStartTime,
      );
      expect(result.type).toBe("registry_pin");
      if (result.type === "registry_pin") {
        expect(result.pinRecord.pin).toBe("13");
        expect(result.pinRecord.defined).toBe(true);
        expect(result.pinRecord.pinMode).toBe(1);
        expect(result.pinRecord.definedAt?.line).toBe(10);
        expect(result.pinRecord.usedAt).toHaveLength(2);
        expect(result.pinRecord.usedAt?.[0]).toEqual({
          line: 10,
          operation: "pinMode:1",
        });
        expect(result.pinRecord.usedAt?.[1]).toEqual({
          line: 15,
          operation: "digitalWrite",
        });
      }
    });

    it("should parse pin mode change", () => {
      const result = parser.parseStderrLine(
        "[[PIN_MODE:13:1]]",
        processStartTime,
      );
      expect(result).toEqual({ type: "pin_mode", pin: 13, mode: 1 });
    });

    it("should parse pin value change", () => {
      const result = parser.parseStderrLine(
        "[[PIN_VALUE:13:255]]",
        processStartTime,
      );
      expect(result).toEqual({ type: "pin_value", pin: 13, value: 255 });
    });

    it("should parse pin PWM change", () => {
      const result = parser.parseStderrLine(
        "[[PIN_PWM:9:128]]",
        processStartTime,
      );
      expect(result).toEqual({ type: "pin_pwm", pin: 9, value: 128 });
    });

    it("should parse serial event with base64 data", () => {
      // "Hello" in base64 is "SGVsbG8="
      const result = parser.parseStderrLine(
        "[[SERIAL_EVENT:1234:SGVsbG8=]]",
        processStartTime,
      );
      expect(result.type).toBe("serial_event");
      if (result.type === "serial_event") {
        expect(result.data).toBe("Hello");
        expect(result.timestamp).toBe(processStartTime + 1234);
      }
    });

    it("should mark debug markers as ignored", () => {
      const debugLines = [
        "[[DREAD:13:1]]",
        "[[PIN_SET:13:1]]",
        "[[STDIN_RECV:test]]",
      ];

      debugLines.forEach((line) => {
        const result = parser.parseStderrLine(line, processStartTime);
        expect(result.type).toBe("ignored");
      });
    });

    it("should return text for regular error messages", () => {
      const result = parser.parseStderrLine(
        "Regular error message",
        processStartTime,
      );
      expect(result).toEqual({
        type: "text",
        line: "Regular error message",
      });
    });

    it("should handle registry pin without operations", () => {
      const result = parser.parseStderrLine(
        "[[IO_PIN:A0:0:0:0:]]",
        processStartTime,
      );
      expect(result.type).toBe("registry_pin");
      if (result.type === "registry_pin") {
        expect(result.pinRecord.pin).toBe("A0");
        expect(result.pinRecord.defined).toBe(false);
        expect(result.pinRecord.usedAt).toEqual([]);
      }
    });

    it("should handle serial event with special characters", () => {
      // "Test\nNewline" in base64
      const base64 = Buffer.from("Test\nNewline").toString("base64");
      const result = parser.parseStderrLine(
        `[[SERIAL_EVENT:100:${base64}]]`,
        processStartTime,
      );
      expect(result.type).toBe("serial_event");
      if (result.type === "serial_event") {
        expect(result.data).toBe("Test\nNewline");
      }
    });

    it("should handle malformed serial event gracefully", () => {
      const result = parser.parseStderrLine(
        "[[SERIAL_EVENT:abc:invalid-base64!!!]]",
        processStartTime,
      );
      // Should return text if parsing fails
      expect(result.type).toBe("text");
    });
  });

  describe("priority handling", () => {
    it("should prioritize registry markers over pin states", () => {
      const result = parser.parseStderrLine(
        "[[IO_REGISTRY_START]] [[PIN_MODE:13:1]]",
        processStartTime,
      );
      // Should match registry start first
      expect(result.type).toBe("registry_start");
    });

    it("should prioritize pin states over serial events", () => {
      const result = parser.parseStderrLine(
        "[[PIN_MODE:13:1]] [[SERIAL_EVENT:100:SGVsbG8=]]",
        processStartTime,
      );
      // Should match pin mode first
      expect(result.type).toBe("pin_mode");
    });
  });

  describe("edge cases", () => {
    it("should handle empty lines", () => {
      const result = parser.parseStderrLine("", processStartTime);
      expect(result.type).toBe("text");
      expect((result as any).line).toBe("");
    });

    it("should handle whitespace-only lines", () => {
      const result = parser.parseStderrLine("   ", processStartTime);
      expect(result.type).toBe("text");
    });

    it("should handle registry pin with complex operations", () => {
      const result = parser.parseStderrLine(
        "[[IO_PIN:13:1:5:1:pinMode:1@5:digitalWrite@10:digitalWrite@15:analogWrite:128@20]]",
        processStartTime,
      );
      expect(result.type).toBe("registry_pin");
      if (result.type === "registry_pin") {
        expect(result.pinRecord.usedAt).toHaveLength(4);
        expect(result.pinRecord.usedAt?.[3]).toEqual({
          line: 20,
          operation: "analogWrite:128",
        });
      }
    });
  });

  describe("protocol fragment handling", () => {
    it("should ignore standalone closing brackets ']]'", () => {
      const result = parser.parseStderrLine("]]", processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("should ignore standalone opening brackets '[['", () => {
      const result = parser.parseStderrLine("[[", processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("should ignore partial protocol header without closing", () => {
      const result = parser.parseStderrLine("[[SERIAL_EVENT:", processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("should ignore short base64 tail with closing brackets", () => {
      const result = parser.parseStderrLine("SGVsbG8=]]", processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("T-PF-01: should ignore long timestamp:base64 tail from split SERIAL_EVENT", () => {
      // This is the exact pattern from the user's bug report:
      // A SERIAL_EVENT was split by concurrent stderr writes, producing
      // "4579:WzAwMDAwMl0gWFhY...Cg==]]" as a standalone line
      const base64 = Buffer.from("[000002] " + "X".repeat(120) + "\\n").toString("base64");
      const fragment = `4579:${base64}]]`;
      const result = parser.parseStderrLine(fragment, processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("T-PF-02: should ignore timestamp:base64 without brackets", () => {
      const base64 = Buffer.from("Hello World\\n").toString("base64");
      const fragment = `1234:${base64}`;
      const result = parser.parseStderrLine(fragment, processStartTime);
      expect(result.type).toBe("ignored");
    });

    it("T-PF-03: should still treat genuine error text as text", () => {
      const result = parser.parseStderrLine("Segmentation fault (core dumped)", processStartTime);
      expect(result.type).toBe("text");
      expect((result as any).line).toBe("Segmentation fault (core dumped)");
    });
  });
});
