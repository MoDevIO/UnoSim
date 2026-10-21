import { describe, expect, it } from "vitest";
import { diagnosticLine } from "../../../../client/src/lib/runtime/diagnostic-lines";

describe("diagnostic line for discarded serial input (plan P5.3)", () => {
  it.each([
    [0, "Serial"],
    [1, "Serial1"],
    [3, "Serial3"],
  ])("names %i as %s", (port, name) => {
    const line = diagnosticLine({ kind: "serial-input-discarded", port, bytes: 3, simTimeMs: 5 });

    expect(line).toBe(`--- Serial input discarded because the receiver was not enabled yet (${name}.begin() has not run) ---\n`);
  });
});
