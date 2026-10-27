import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardView } from "@/lib/board-view";

const drawing = (file: string) => new DOMParser().parseFromString(
  readFileSync(join(__dirname, "../../../client/public", file), "utf8"), "image/svg+xml",
);
const element = (document: Document, id: string): Element => {
  const found = document.getElementById(id);
  expect(found, id).not.toBeNull();
  return found!;
};
const number = (node: Element, attribute: string) => Number(node.getAttribute(attribute));

describe("ATtiny85 as a bare DIP-8 chip", () => {
  it("draws an eight-lead package with orientation marks and no carrier controls or logo", () => {
    const chip = drawing("ATtiny85.svg");
    expect(element(chip, "attiny-package").tagName).toBe("path");
    expect(element(chip, "attiny-pin1-marker")).toBeDefined();
    expect(element(chip, "attiny-notch")).toBeDefined();
    for (let dip = 1; dip <= 8; dip++) {
      expect(element(chip, `attiny-lead-${dip}`).tagName).toBe("path");
      expect(element(chip, `attiny-contact-${dip}`).tagName).toBe("rect");
    }
    expect(chip.querySelectorAll('path[id^="attiny-lead-"]')).toHaveLength(8);
    expect(chip.querySelectorAll('[id^="led-"], [id^="reset-"], #board-outline')).toHaveLength(0);
    expect(chip.documentElement.innerHTML).not.toContain("#0f7391");
    expect(boardView("attiny85")).toMatchObject({ width: 168, height: 112, logo: false });
  });

  it("keeps the five usable pins on the corresponding physical leads and leaves RESET and power passive", () => {
    const chip = drawing("ATtiny85.svg");
    const overlay = drawing("ATtiny85-overlay.svg");
    for (const [pin, dip] of [[0, 5], [1, 6], [2, 7], [3, 2], [4, 3]]) {
      const contact = element(chip, `attiny-contact-${dip}`);
      const expected = { x: number(contact, "x") + number(contact, "width") / 2, y: number(contact, "y") + number(contact, "height") / 2 };
      const state = element(overlay, `pin-${pin}-state`);
      expect(number(state, "cx")).toBe(expected.x);
      expect(number(state, "cy")).toBe(expected.y);
      for (const part of ["frame", "click"]) {
        const target = element(overlay, `pin-${pin}-${part}`);
        expect(number(target, "x") + number(target, "width") / 2).toBe(expected.x);
        expect(number(target, "y") + number(target, "height") / 2).toBe(expected.y);
      }
    }
    expect(overlay.querySelectorAll('[id^="pin-"][id$="-click"]')).toHaveLength(5);
    expect(overlay.getElementById("pin-5-click")).toBeNull();
    expect(overlay.querySelectorAll('[id^="led-"], #reset-click, #reset-button, #board-outline')).toHaveLength(0);
    for (const document of [chip, overlay]) expect(document.documentElement.getAttribute("viewBox")).toBe("0 0 168 112");
  });
});
