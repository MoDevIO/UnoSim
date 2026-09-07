import { describe, expect, it } from "vitest";
import { SimulationAdmissionController } from "../../../server/services/simulation-admission-controller";

describe("SimulationAdmissionController", () => {
  it("admits different trusted identities independently", () => {
    const controller = new SimulationAdmissionController(2);

    expect(controller.reserve("student-a").admitted).toBe(true);
    expect(controller.reserve("student-b").admitted).toBe(true);
    expect(controller.getStats().active).toBe(2);
  });

  it("atomically rejects a second reservation for the same identity", () => {
    const controller = new SimulationAdmissionController(2);

    expect(controller.reserve("student-a").admitted).toBe(true);
    expect(controller.reserve("student-a")).toEqual({
      admitted: false,
      reason: "identity",
    });
    expect(controller.getStats()).toMatchObject({
      active: 1,
      identityRejectedTotal: 1,
    });
  });

  it("rejects immediately at the global running-plus-waiting limit", () => {
    const controller = new SimulationAdmissionController(1);

    expect(controller.reserve("student-a").admitted).toBe(true);
    expect(controller.reserve("student-b")).toEqual({
      admitted: false,
      reason: "capacity",
    });
    expect(controller.getStats()).toMatchObject({
      active: 1,
      max: 1,
      capacityRejectedTotal: 1,
    });
  });

  it("ignores stale and duplicate releases", () => {
    const controller = new SimulationAdmissionController(1);
    const first = controller.reserve("student-a");
    if (!first.admitted) throw new Error("first reservation failed");

    expect(controller.release(first.reservation)).toBe(true);
    const second = controller.reserve("student-a");
    if (!second.admitted) throw new Error("second reservation failed");

    expect(controller.release(first.reservation)).toBe(false);
    expect(controller.getStats().active).toBe(1);
    expect(controller.release(second.reservation)).toBe(true);
    expect(controller.getStats().active).toBe(0);
  });
});
