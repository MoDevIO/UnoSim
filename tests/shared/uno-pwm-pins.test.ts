import { describe, expect, it } from "vitest";
import { UNO_PWM_PINS, isUnoPwmPin } from "@shared/utils/arduino-utils";

describe("Arduino UNO PWM pins", () => {
  it("lists the PWM-capable pins in board order", () => {
    expect([...UNO_PWM_PINS]).toEqual([3, 5, 6, 9, 10, 11]);
  });

  it.each([3, 5, 6, 9, 10, 11])("treats pin %i as PWM-capable", (pin) => {
    expect(isUnoPwmPin(pin)).toBe(true);
  });

  it.each([0, 1, 2, 4, 7, 8, 12, 13, 14, 19, 20, -1, 3.5])("treats pin %s as not PWM-capable", (pin) => {
    expect(isUnoPwmPin(pin)).toBe(false);
  });

  it("agrees with the list for every pin number the UNO exposes", () => {
    for (let pin = 0; pin <= 19; pin += 1) {
      expect(isUnoPwmPin(pin), `pin ${pin}`).toBe(UNO_PWM_PINS.includes(pin));
    }
  });
});
