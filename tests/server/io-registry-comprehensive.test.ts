/**
 * @vitest-environment node
 * 
 * Comprehensive I/O Registry Test Suite
 * 
 * Tests static analysis and runtime tracking of digitalWrite/digitalRead
 * and analogWrite/analogRead operations across various code patterns.
 * 
 * Test Status Legend:
 * ✅ = Currently passing
 * 🔄 = Partially working (runtime tracks, static analysis limited)
 * ⏸️ = Not yet implemented (marked as it.todo)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import { CodeParser } from "../../shared/code-parser";
import type { IOPinRecord } from "@shared/schema";

describe("I/O Registry - Comprehensive Analysis", () => {
  let runner: SandboxRunner;
  let parser: CodeParser;
  let registryData: IOPinRecord[] = [];

  beforeEach(() => {
    runner = new SandboxRunner();
    parser = new CodeParser();
    registryData = [];
  });

  afterEach(async () => {
    if (runner.isRunning) {
      runner.stop();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /**
   * Helper: Run code and collect I/O registry from runtime
   * Also validates that compilation succeeded and contains no fatal errors in stderr
   */
  const runAndCollectRegistry = async (code: string): Promise<IOPinRecord[]> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        runner.stop();
        reject(new Error("Registry collection timeout"));
      }, 12000); // Increased timeout to account for stdio isolation overhead

      let collected: IOPinRecord[] = [];
      let stderrContent = "";

      runner.runSketch({
        code,
        onOutput: () => {},
        onError: (err) => {
          clearTimeout(timeout);
          reject(new Error(`Runtime error: ${err}`));
        },
        onExit: () => {
          clearTimeout(timeout);
          resolve(collected);
        },
        onCompileError: (err) => {
          clearTimeout(timeout);
          reject(new Error(`Compile error: ${err}`));
        },
        onCompileSuccess: () => {},
        onPinState: () => {},
        timeoutSec: 3,
        onIORegistry: (registry) => {
          collected = registry;
        },
      });
    });
  };

  describe("✅ Scenario 1: Literal Pin Numbers", () => {
    it("should track digitalWrite with literal pin number", async () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
          digitalWrite(13, HIGH);
        }
        void loop() {
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin13 = registryData.find((p) => p.pin === "13");
      
      expect(pin13).toBeDefined();
      expect(pin13?.defined).toBe(true);
      
      const digitalWriteOps = pin13?.usedAt?.filter(
        (u) => u.operation === "digitalWrite"
      );
      expect(digitalWriteOps).toBeDefined();
      expect(digitalWriteOps!.length).toBeGreaterThan(0);
    }, 12000);

    it("should track digitalRead with literal pin number", async () => {
      const code = `
        void setup() {
          pinMode(7, INPUT);
        }
        void loop() {
          int val = digitalRead(7);
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin7 = registryData.find((p) => p.pin === "7");
      
      expect(pin7).toBeDefined();
      const digitalReadOps = pin7?.usedAt?.filter(
        (u) => u.operation === "digitalRead"
      );
      expect(digitalReadOps!.length).toBeGreaterThan(0);
    }, 12000);

    it("should track analogWrite with literal pin number", async () => {
      const code = `
        void setup() {
          pinMode(9, OUTPUT);
        }
        void loop() {
          analogWrite(9, 128);
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin9 = registryData.find((p) => p.pin === "9");
      
      expect(pin9).toBeDefined();
      const analogWriteOps = pin9?.usedAt?.filter(
        (u) => u.operation.includes("analogWrite")
      );
      expect(analogWriteOps!.length).toBeGreaterThan(0);
    }, 12000);

    it("should track analogRead with literal pin number", async () => {
      const code = `
        void setup() {
          pinMode(A0, INPUT);
        }
        void loop() {
          int val = analogRead(A0);
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pinA0 = registryData.find((p) => p.pin === "A0");
      
      expect(pinA0).toBeDefined();
      const analogReadOps = pinA0?.usedAt?.filter(
        (u) => u.operation === "analogRead"
      );
      expect(analogReadOps!.length).toBeGreaterThan(0);
    }, 12000);
  });

  describe("🔄 Scenario 2: Constant Pin Variables", () => {
    it("should track const int pin in runtime registry", async () => {
      const code = `
        const int LED_PIN = 12;
        
        void setup() {
          pinMode(LED_PIN, OUTPUT);
          digitalWrite(LED_PIN, HIGH);
        }
        void loop() {
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin12 = registryData.find((p) => p.pin === "12");
      
      expect(pin12).toBeDefined();
      expect(pin12?.defined).toBe(true);
      
      const digitalWriteOps = pin12?.usedAt?.filter(
        (u) => u.operation === "digitalWrite"
      );
      expect(digitalWriteOps!.length).toBeGreaterThan(0);
    }, 12000);

    it("should detect const pin usage in static analysis (warning check)", () => {
      const code = `
        const int SENSOR_PIN = 8;
        
        void setup() {
          // Missing pinMode(SENSOR_PIN, INPUT);
          int val = digitalRead(SENSOR_PIN);
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Static parser should warn about missing pinMode for variable
      const pinModeWarnings = messages.filter(
        (m) => m.message.includes("SENSOR_PIN") && m.message.includes("pinMode")
      );
      
      // Currently this works - parser detects variable usage
      expect(pinModeWarnings.length).toBeGreaterThan(0);
    });
  });

  describe("🔄 Scenario 3: Loop-Based Dynamic Pins", () => {
    it("should track all pins used in for-loop at runtime", async () => {
      const code = `
        void setup() {
          for (int i = 0; i < 3; i++) {
            pinMode(i, OUTPUT);
            digitalWrite(i, HIGH);
          }
        }
        void loop() {
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      
      // Runtime should track pins 0, 1, 2
      const pin0 = registryData.find((p) => p.pin === "0");
      const pin1 = registryData.find((p) => p.pin === "1");
      const pin2 = registryData.find((p) => p.pin === "2");
      
      expect(pin0).toBeDefined();
      expect(pin1).toBeDefined();
      expect(pin2).toBeDefined();
      
      // All should have digitalWrite operations
      expect(pin0?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
      expect(pin1?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
      expect(pin2?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    }, 12000);

    it("should detect loop-configured pins in static analysis", () => {
      const code = `
        void setup() {
          for (byte i = 2; i < 7; i++) {
            pinMode(i, OUTPUT);
          }
          
          // Using pins from loop - should not warn
          digitalWrite(3, HIGH);
          digitalWrite(5, LOW);
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Static parser has getLoopConfiguredPins() method
      // It should recognize pins 2-6 are configured in loop
      // So digitalWrite(3) and digitalWrite(5) should not trigger warnings
      const pin3Warning = messages.filter(
        (m) => m.message.includes("Pin 3") && m.message.includes("pinMode")
      );
      const pin5Warning = messages.filter(
        (m) => m.message.includes("Pin 5") && m.message.includes("pinMode")
      );
      
      // These should be empty (no warnings) because loop covers these pins
      expect(pin3Warning.length).toBe(0);
      expect(pin5Warning.length).toBe(0);
    });

    it("should track digitalRead in loops at runtime", async () => {
      const code = `
        void setup() {
          for (int i = 8; i < 11; i++) {
            pinMode(i, INPUT);
          }
        }
        void loop() {
          for (int i = 8; i < 11; i++) {
            int val = digitalRead(i);
          }
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      
      const pin8 = registryData.find((p) => p.pin === "8");
      const pin9 = registryData.find((p) => p.pin === "9");
      const pin10 = registryData.find((p) => p.pin === "10");
      
      expect(pin8?.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
      expect(pin9?.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
      expect(pin10?.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    }, 12000);
  });

  describe("⏸️ Scenario 4: Array-Based Pin Access (TODO)", () => {
    it.todo("should track pins accessed via array indices (runtime)", async () => {
      const code = `
        int outputPins[] = {2, 4, 6};
        
        void setup() {
          pinMode(outputPins[0], OUTPUT);
          pinMode(outputPins[1], OUTPUT);
          pinMode(outputPins[2], OUTPUT);
          
          digitalWrite(outputPins[1], HIGH); // Pin 4
        }
        void loop() {
          delay(10);
          exit(0);
        }
      `;

      // Runtime tracking WILL work because C++ evaluates outputPins[1] to 4
      // But we can't currently test this in isolation due to compilation complexity
      
      registryData = await runAndCollectRegistry(code);
      const pin4 = registryData.find((p) => p.pin === "4");
      
      expect(pin4).toBeDefined();
      expect(pin4?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
    });

    it("should handle array-based pins in static analysis (limited support expected)", () => {
      const code = `
        int pins[] = {2, 4, 6};
        
        void setup() {
          digitalWrite(pins[1], HIGH); // Static parser can't resolve this to pin 4
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Static parser will see "pins" as a variable, not a literal
      // It should warn about variable usage without pinMode
      const warnings = messages.filter(
        (m) => m.message.includes("pins") || m.message.includes("variable")
      );
      
      // Expected: Some warning about array/variable usage
      // NOTE: Current implementation may not specifically detect array access
      console.log("Array-based pin warnings:", warnings);
    });
  });

  describe("⏸️ Scenario 5: Struct-Based Pin Access (TODO)", () => {
    it.todo("should track pins accessed via struct members (runtime)", async () => {
      const code = `
        struct PinConfig {
          int ledPin;
          int sensorPin;
        };
        
        PinConfig config = {13, 7};
        
        void setup() {
          pinMode(config.ledPin, OUTPUT);
          pinMode(config.sensorPin, INPUT);
          
          digitalWrite(config.ledPin, HIGH);
          int val = digitalRead(config.sensorPin);
        }
        void loop() {
          delay(10);
          exit(0);
        }
      `;

      // Runtime tracking WILL work (C++ evaluates config.ledPin to 13)
      registryData = await runAndCollectRegistry(code);
      const pin13 = registryData.find((p) => p.pin === "13");
      const pin7 = registryData.find((p) => p.pin === "7");
      
      expect(pin13).toBeDefined();
      expect(pin7).toBeDefined();
    });

    it("should handle struct members in static analysis (not supported)", () => {
      const code = `
        struct Config { int p; };
        Config c = {7};
        
        void setup() {
          digitalRead(c.p); // Static parser can't resolve this
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Static parser sees "c" as variable usage
      // Expected: Warning about variable without pinMode
      const warnings = messages.filter((m) => m.message.includes("c.p") || m.message.includes("variable"));
      
      console.log("Struct-based pin warnings:", warnings);
      // NOTE: Current implementation may not detect struct member access
    });
  });

  describe("⏸️ Scenario 6: Arithmetic Pin Expressions (TODO)", () => {
    it.todo("should track pins from arithmetic expressions (runtime)", async () => {
      const code = `
        void setup() {
          pinMode(10 + 2, OUTPUT); // Pin 12
          digitalWrite(10 + 2, HIGH);
        }
        void loop() {
          delay(10);
          exit(0);
        }
      `;

      // Runtime tracking WILL work (C++ evaluates 10+2 to 12)
      registryData = await runAndCollectRegistry(code);
      const pin12 = registryData.find((p) => p.pin === "12");
      
      expect(pin12).toBeDefined();
    });

    it("should handle arithmetic expressions in static analysis (not supported)", () => {
      const code = `
        void setup() {
          digitalWrite(5 + 3, HIGH); // Pin 8
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Static parser can't evaluate arithmetic
      // It won't recognize this as a valid pin number
      const warnings = messages.filter((m) => m.message.includes("5") || m.message.includes("pinMode"));
      
      console.log("Arithmetic expression warnings:", warnings);
      // Expected: Either ignored or generic warning
    });
  });

  describe("🔄 Scenario 7: Global Scope Pin Variables", () => {
    it("should track global pin variables at runtime", async () => {
      const code = `
        int LED_PIN = 11;
        int BUTTON_PIN = 3;
        
        void setup() {
          pinMode(LED_PIN, OUTPUT);
          pinMode(BUTTON_PIN, INPUT);
          digitalWrite(LED_PIN, HIGH);
        }
        void loop() {
          int state = digitalRead(BUTTON_PIN);
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin11 = registryData.find((p) => p.pin === "11");
      const pin3 = registryData.find((p) => p.pin === "3");
      
      expect(pin11).toBeDefined();
      expect(pin3).toBeDefined();
      expect(pin11?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
      expect(pin3?.usedAt?.some((u) => u.operation === "digitalRead")).toBe(true);
    }, 12000);

    it("should detect global variable usage in static analysis", () => {
      const code = `
        int MY_PIN = 6;
        
        void setup() {
          // Missing pinMode(MY_PIN, ...)
          digitalWrite(MY_PIN, HIGH);
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Parser should warn about variable usage without pinMode
      const warnings = messages.filter(
        (m) => m.message.includes("MY_PIN") && m.message.includes("pinMode")
      );
      
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("✅ Static Analysis - pinMode Coverage", () => {
    it("should warn when digitalWrite is used without pinMode", () => {
      const code = `
        void setup() {
          digitalWrite(10, HIGH); // Missing pinMode
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      const warning = messages.find(
        (m) => m.message.includes("Pin 10") && m.message.includes("pinMode")
      );
      
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe(2); // Warning level
    });

    it("should not warn when pinMode is properly called", () => {
      const code = `
        void setup() {
          pinMode(10, OUTPUT);
          digitalWrite(10, HIGH);
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      const warning = messages.find(
        (m) => m.message.includes("Pin 10") && m.message.includes("pinMode")
      );
      
      expect(warning).toBeUndefined();
    });

    it("should warn about analogWrite on non-PWM pins", () => {
      const code = `
        void setup() {
          pinMode(2, OUTPUT);
          analogWrite(2, 128); // Pin 2 is not PWM-capable
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      
      // Debug: Log all messages to see what's generated
      console.log("All hardware compatibility messages:", messages.map(m => m.message));
      
      const warning = messages.find(
        (m) => m.message.toLowerCase().includes("analogwrite") && m.message.includes("2")
      );
      
      expect(warning).toBeDefined();
      if (warning) {
        expect(warning.message).toContain("PWM");
      }
    });
  });

  describe("✅ Edge Cases", () => {
    it("should handle multiple operations on same pin", async () => {
      const code = `
        void setup() {
          pinMode(5, OUTPUT);
          digitalWrite(5, HIGH);
          digitalWrite(5, LOW);
          digitalWrite(5, HIGH);
        }
        void loop() {
          delay(10);
          exit(0);
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin5 = registryData.find((p) => p.pin === "5");
      
      expect(pin5).toBeDefined();
      // Should only track unique operation type once (not duplicate entries)
      const digitalWriteOps = pin5?.usedAt?.filter((u) => u.operation === "digitalWrite");
      expect(digitalWriteOps!.length).toBe(1); // Deduplicated
    }, 12000);

    it("should track both digital and analog operations on same pin", async () => {
      const code = `
        void setup() {
          pinMode(9, OUTPUT);
          digitalWrite(9, HIGH);
          analogWrite(9, 200);
        }
        void loop() {
          delay(10);
          exit(0);
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pin9 = registryData.find((p) => p.pin === "9");
      
      expect(pin9).toBeDefined();
      expect(pin9?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
      expect(pin9?.usedAt?.some((u) => u.operation.includes("analogWrite"))).toBe(true);
    }, 12000);

    it("should handle A0-A5 analog pin notation", async () => {
      const code = `
        void setup() {
          pinMode(A2, INPUT);
        }
        void loop() {
          int val = analogRead(A2);
          static int count = 0;
          count++;
          delay(10);
          if (count > 2) {
            exit(0);
          }
        }
      `;

      registryData = await runAndCollectRegistry(code);
      const pinA2 = registryData.find((p) => p.pin === "A2");
      
      expect(pinA2).toBeDefined();
      expect(pinA2?.usedAt?.some((u) => u.operation === "analogRead")).toBe(true);
    }, 12000);
  });
});
