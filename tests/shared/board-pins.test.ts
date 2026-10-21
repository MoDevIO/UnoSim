import { describe, expect, it } from "vitest";
import {
  boardAnalogPins, boardPinLabel, boardPins, boardPwmPins, findBoardPin, isBoardPin, maxBoardPin, resolveBoardPin,
} from "@shared/board-pins";

describe("board pins (plan P4.1)", () => {
  it("lists the 20 pins of the Uno: D0–D13 and A0–A5 as 14–19, PWM on 3 5 6 9 10 11", () => {
    const pins = boardPins("uno") ?? [];

    expect(pins).toHaveLength(20);
    expect(pins.map((pin) => pin.pin)).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(boardPwmPins("uno")).toEqual([3, 5, 6, 9, 10, 11]);
    expect(boardAnalogPins("uno").map((pin) => [pin.pin, pin.label, pin.adcChannel])).toEqual([[14, "A0", 0], [15, "A1", 1], [16, "A2", 2], [17, "A3", 3], [18, "A4", 4], [19, "A5", 5]]);
    expect(findBoardPin("uno", 13)).toMatchObject({ name: "13", label: "D13", digital: true, analog: false, pwm: false });
    expect(findBoardPin("uno", 14)).toMatchObject({ name: "A0", label: "A0", digital: true, analog: true });
    expect(findBoardPin("uno", 0)).toMatchObject({ role: "serial" });
  });

  it("gives the Nano two analog-only inputs more: A6 and A7 as pins 20 and 21, without a digital function", () => {
    expect(boardPins("nano")).toHaveLength(22);
    expect(findBoardPin("nano", 20)).toMatchObject({ name: "A6", digital: false, analog: true, adcChannel: 6, pwm: false });
    expect(findBoardPin("nano", 21)).toMatchObject({ name: "A7", digital: false, analog: true, adcChannel: 7 });
    expect(boardPwmPins("nano")).toEqual(boardPwmPins("uno"));
    expect(maxBoardPin("nano")).toBe(21);
    expect(maxBoardPin("uno")).toBe(19);
  });

  it("describes the Mega 2560 with 70 pins, 16 analog inputs and PWM on 2–13 and 44–46", () => {
    expect(boardPins("mega2560")).toHaveLength(70);
    expect(maxBoardPin("mega2560")).toBe(69);
    expect(boardPwmPins("mega2560")).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46]);
    expect(boardAnalogPins("mega2560").map((pin) => pin.label)).toEqual(Array.from({ length: 16 }, (_, channel) => `A${channel}`));
    expect(findBoardPin("mega2560", 69)).toMatchObject({ name: "A15", digital: true, analog: true, adcChannel: 15 });
    expect(resolveBoardPin("mega2560", "A15")).toBe(69);
    expect(resolveBoardPin("mega2560", "53")).toBe(53);
    expect(resolveBoardPin("mega2560", "70")).toBeUndefined();
    expect(boardPinLabel("mega2560", 54)).toBe("A0");
    expect(boardPinLabel("mega2560", 14)).toBe("14");
    expect(isBoardPin("mega2560", 69)).toBe(true);
    expect(isBoardPin("mega2560", 70)).toBe(false);
  });

  it("checks whether a board has a pin", () => {
    expect(isBoardPin("uno", 19)).toBe(true);
    expect(isBoardPin("uno", 20)).toBe(false);
    expect(isBoardPin("nano", 21)).toBe(true);
    expect(isBoardPin("nano", 22)).toBe(false);
    expect(isBoardPin("uno", -1)).toBe(false);
    expect(isBoardPin("uno", 2.5)).toBe(false);
  });

  it("names pins the way a sketch does", () => {
    expect(boardPinLabel("uno", 5)).toBe("5");
    expect(boardPinLabel("uno", 14)).toBe("A0");
    expect(boardPinLabel("nano", 21)).toBe("A7");
    expect(boardPinLabel("uno", 99)).toBe("99");
  });

  it("resolves the names a sketch uses", () => {
    expect(resolveBoardPin("uno", "13")).toBe(13);
    expect(resolveBoardPin("uno", "A0")).toBe(14);
    expect(resolveBoardPin("uno", "a5")).toBe(19);
    expect(resolveBoardPin("uno", "LED_BUILTIN")).toBe(13);
    expect(resolveBoardPin("uno", "A6")).toBeUndefined();
    expect(resolveBoardPin("nano", "A6")).toBe(20);
    expect(resolveBoardPin("nano", "22")).toBeUndefined();
    expect(resolveBoardPin("uno", "D13")).toBeUndefined();
  });

  it("has no pins for a board without a hardware profile yet", () => {
    expect(boardPins("attiny85")).toBeUndefined();
    expect(isBoardPin("attiny85", 2)).toBe(false);
    expect(resolveBoardPin("attiny85", "0")).toBeUndefined();
    expect(maxBoardPin("attiny85")).toBeUndefined();
    expect(boardPwmPins("attiny85")).toEqual([]);
    expect(boardPinLabel("attiny85", 3)).toBe("3");
  });
});
