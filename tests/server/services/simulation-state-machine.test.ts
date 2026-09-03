import { describe, expect, it } from "vitest";
import { canTransition, transition } from "../../../server/services/simulation-state-machine";

describe("simulation state machine", () => {
  it("allows only lifecycle transitions", () => {
    expect(canTransition("stopped", "starting")).toBe(true);
    expect(canTransition("running", "paused")).toBe(true);
    expect(canTransition("paused", "running")).toBe(true);
    expect(canTransition("stopped", "running")).toBe(false);
    expect(canTransition("error", "starting")).toBe(false);
  });

  it("keeps the current state for invalid transitions", () => {
    expect(transition("running", "starting")).toBe("running");
    expect(transition("paused", "stopped")).toBe("stopped");
  });
});
