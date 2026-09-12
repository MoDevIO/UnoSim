import { describe, expect, it, vi } from "vitest";
import { ArduinoOutputParser } from "../../server/services/arduino-output-parser";
import { RegistryManager } from "../../server/services/registry-manager";

describe("pre-main pinMode registry integration", () => {
  it("retains early pinMode markers when the first registry snapshot is collected", () => {
    vi.useFakeTimers();
    const updateCallback = vi.fn();
    const parser = new ArduinoOutputParser();
    const manager = new RegistryManager({
      debounceMs: 100,
      onUpdate: updateCallback,
    });

    try {
      manager.enableWaitMode(1000);

      const markers = [
        "[[PIN_MODE:4:1]]",
        "[[PIN_MODE:5:1]]",
        "[[IO_REGISTRY_START]]",
        "[[IO_PIN:4:0:0:0:digitalWrite@0]]",
        "[[IO_PIN:5:0:0:0:digitalWrite@0]]",
        "[[IO_REGISTRY_END]]",
      ];

      for (const marker of markers) {
        const parsed = parser.parseStderrLine(marker, null);
        switch (parsed.type) {
          case "pin_mode":
            manager.updatePinMode(parsed.pin, parsed.mode);
            break;
          case "registry_start":
            manager.startCollection();
            break;
          case "registry_pin":
            manager.addPin(parsed.pinRecord);
            break;
          case "registry_end":
            manager.finishCollection();
            break;
          default:
            break;
        }
      }

      const finalRegistry = updateCallback.mock.calls.at(-1)?.[0];
      expect(finalRegistry).toBeDefined();

      for (const pin of ["4", "5"]) {
        const record = finalRegistry.find((entry) => entry.pin === pin);
        expect(record).toBeDefined();
        expect(record!.defined).toBe(true);
        expect(record!.pinMode).toBe(1);
        expect(record!.usedAt).toEqual(
          expect.arrayContaining([
            { line: 0, operation: "pinMode:1" },
            { line: 0, operation: "digitalWrite" },
          ]),
        );
      }
    } finally {
      manager.destroy();
      vi.useRealTimers();
    }
  });
});
