import { describe, expect, it } from "vitest";
import { shouldSendSimulationEndMessage } from "../../server/services/simulation-end";

describe("simulation end message", () => {
  it("suppresses end message when compilation fails", () => {
    expect(shouldSendSimulationEndMessage(true)).toBe(false);
  });

  it("allows end message when compilation succeeds", () => {
    expect(shouldSendSimulationEndMessage(false)).toBe(true);
  });
});
