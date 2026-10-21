import { afterEach, describe, expect, it } from "vitest";
import {
  activeAnalogPins, activePinLabel, activePins, activePwmPins, analogChannelPin, getActiveBoard, isActivePwmPin, isAnalogPin, setActiveBoard,
} from "../../../client/src/lib/active-board";

afterEach(() => setActiveBoard("uno"));

describe("active board (plan P4.3)", () => {
  it("is the Uno until a board is set: analog pins 14–19, 20 pins", () => {
    expect(getActiveBoard()).toBe("uno");
    expect(activePins()).toHaveLength(20);
    expect([13, 14, 19, 20].map(isAnalogPin)).toEqual([false, true, true, false]);
    expect(activePinLabel(14)).toBe("A0");
    expect(activePinLabel(5)).toBe("5");
    expect(analogChannelPin(5)).toBe(19);
    expect(analogChannelPin(6)).toBeUndefined();
    expect(activePwmPins()).toEqual([3, 5, 6, 9, 10, 11]);
    expect(isActivePwmPin(9)).toBe(true);
  });

  it("follows the Nano: 22 pins, A6 and A7 as pins 20 and 21", () => {
    setActiveBoard("nano");

    expect(activePins()).toHaveLength(22);
    expect([19, 20, 21, 22].map(isAnalogPin)).toEqual([true, true, true, false]);
    expect(activePinLabel(21)).toBe("A7");
    expect(analogChannelPin(6)).toBe(20);
    expect(activeAnalogPins().map((pin) => pin.label)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
  });

  it("uses the Uno's pins for a board without a hardware profile yet", () => {
    setActiveBoard("attiny85");

    expect(activePins()).toHaveLength(20);
    expect(isAnalogPin(20)).toBe(false);
  });
});
