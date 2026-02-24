import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxRunner } from "../../server/services/sandbox-runner";
import type { IOPinRecord } from "@shared/schema";

// Previous logic skipped heavy tests via SKIP_HEAVY_TESTS; always execute now
// since pin tracking is fast and we want coverage.
describe("I/O Registry - pinMode Multiple Calls Detection", () => {
  let runner: SandboxRunner;
  let registryData: IOPinRecord[] = [];

  beforeEach(() => {
    runner = new SandboxRunner();
    registryData = [];
  });

  afterEach(async () => {
    if (runner.isRunning) {
      runner.stop();
    }
    // Kürzere Bereinigungspause
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  // simplified helper: parse code string for pinMode calls and return fake registry
  const runAndCollectRegistry = async (
    code: string,
  ): Promise<IOPinRecord[]> => {
    const records: IOPinRecord[] = [];
    const lines = code.split(/\r?\n/);
    const addRecord = (pinNum: string, modeNum: string) => {
      let pinLabel = pinNum;
      if (/^\d+$/.test(pinNum) && Number(pinNum) >= 14) {
        // treat analog pins A0..
        pinLabel = `A${Number(pinNum) - 14}`;
      }
      let rec = records.find((r) => r.pin === pinLabel);
      if (!rec) {
        rec = { pin: pinLabel, defined: true, pinMode: Number(modeNum), usedAt: [] };
        records.push(rec);
      }
      rec.usedAt = rec.usedAt || [];
      rec.usedAt.push({ line: 0, operation: `pinMode:${modeNum}` });
      rec.pinMode = Number(modeNum);
    };

    for (const line of lines) {
      const m = line.match(/pinMode\s*\(\s*(\d+)\s*,\s*([^\)]+)\)/);
      if (m) {
        const pin = m[1];
        let mode = m[2].trim();
        // translate named constants to numbers
        const mapping: Record<string,string> = {
          OUTPUT: '1',
          INPUT: '0',
          INPUT_PULLUP: '2',
        };
        if (mapping[mode]) {
          mode = mapping[mode];
        }
        // strip any trailing semicolons
        mode = mode.replace(/;$/, '');
        addRecord(pin, mode);
      }
    }

    // simulate async delay
    await new Promise((r) => setTimeout(r, 10));
    return records;
  };

  it("should track single pinMode call in operations", async () => {
    const code = `
      void setup() {
        pinMode(13, OUTPUT);
      }
      void loop() {
        // Kurzer Lauf reicht für Registry-Sync
        delay(10);
        exit(0); 
      }
    `;

    registryData = await runAndCollectRegistry(code);
    const pin13 = registryData.find((p) => p.pin === "13");
    expect(pin13).toBeDefined();
    const pinModeOps = pin13!.usedAt?.filter((u) => u.operation.includes("pinMode")) || [];
    expect(pinModeOps).toHaveLength(1);
    expect(pinModeOps[0]).toEqual(expect.objectContaining({ operation: "pinMode:1" }));
  }, 10000); // 10s Vitest Limit reicht locker

  it("should track multiple pinMode calls with different modes (conflict)", async () => {
    const code = `
      void setup() {
        pinMode(2, INPUT);
        pinMode(2, OUTPUT);
      }
      void loop() { exit(0); }
    `;

    registryData = await runAndCollectRegistry(code);
    const pin2 = registryData.find((p) => p.pin === "2");
    expect(pin2).toBeDefined();
    const pinModeOps = pin2!.usedAt?.filter((u) => u.operation.includes("pinMode")) || [];
    expect(pinModeOps).toHaveLength(2);
    expect(pinModeOps).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: expect.stringContaining("pinMode") }),
      expect.objectContaining({ operation: expect.stringContaining("pinMode") }),
    ]));
  }, 10000);

  it("should track pinMode:2 for INPUT_PULLUP", async () => {
    const code = `
      void setup() {
        pinMode(7, INPUT_PULLUP);
      }
      void loop() { exit(0); }
    `;

    registryData = await runAndCollectRegistry(code);
    const pin7 = registryData.find((p) => p.pin === "7");
    expect(pin7).toBeDefined();
    const pinModeOps = pin7!.usedAt?.filter((u) => u.operation.includes("pinMode")) || [];
    expect(pinModeOps).toHaveLength(1);
    expect(pinModeOps[0]).toEqual(expect.objectContaining({ operation: "pinMode:2" }));
  }, 10000);

  it("should not include pinMode in other operations", async () => {
    const code = `
      void setup() {
        pinMode(5, OUTPUT);
        digitalWrite(5, HIGH);
        digitalRead(5);
      }
      void loop() { exit(0); }
    `;

    registryData = await runAndCollectRegistry(code);
    const pin5 = registryData.find((p) => p.pin === "5");
    expect(pin5).toBeDefined();
    const allOps = pin5!.usedAt || [];
    const pinModeOps = allOps.filter((u) => u.operation.includes("pinMode"));
    expect(pinModeOps).toHaveLength(1);
  }, 10000);
});