import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardView } from "@/lib/board-view";

const drawing = (name: string) => new DOMParser().parseFromString(
  readFileSync(join(__dirname, "../../../client/public", name), "utf8"), "image/svg+xml",
);
const element = (document: Document, id: string): Element => {
  const found = document.getElementById(id);
  expect(found, id).not.toBeNull();
  return found!;
};
const number = (node: Element, attribute: string) => Number(node.getAttribute(attribute));
const centre = (node: Element) => node.tagName === "circle"
  ? { x: number(node, "cx"), y: number(node, "cy") }
  : { x: number(node, "x") + number(node, "width") / 2, y: number(node, "y") + number(node, "height") / 2 };
const names = [...Array.from({ length: 14 }, (_, pin) => String(pin)), ...Array.from({ length: 8 }, (_, pin) => `A${pin}`)];

describe("the supplied Nano artwork and its overlay", () => {
  it("remains SVG when inserted into HTML as the board component does", () => {
    const container = document.createElement("div");
    container.innerHTML = readFileSync(join(__dirname, "../../../client/public/ArduinoNano.svg"), "utf8");
    expect(container.querySelector("svg")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(container.querySelector("#nano-pad-1")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("crops unused export margins and gives both layers and the board view the same proportions", () => {
    const board = drawing("ArduinoNano.svg");
    const overlay = drawing("ArduinoNano-overlay.svg");
    expect(element(board, "nano-artwork").getAttribute("transform")).toBe("matrix(0.5 0 0 0.5 -20 -13.5)");
    for (const document of [board, overlay]) expect(document.documentElement.getAttribute("viewBox")).toBe("0 0 185 74");
    expect(boardView("nano")).toMatchObject({ width: 185, height: 74 });
  });

  it("centres all 22 pins, input frames and click targets on the drawn contacts in their actual order", () => {
    const board = drawing("ArduinoNano.svg");
    const overlay = drawing("ArduinoNano-overlay.svg");
    for (const pin of names) {
      const pad = element(board, `nano-pad-${pin}`);
      const point = centre(pad);
      const expected = { x: (point.x - 40) / 2, y: (point.y - 27) / 2 };
      const state = element(overlay, `pin-${pin}-state`);
      expect(number(state, "cx")).toBeCloseTo(expected.x, 5);
      expect(number(state, "cy")).toBeCloseTo(expected.y, 5);
      for (const part of ["frame", "click"]) {
        const target = element(overlay, `pin-${pin}-${part}`);
        expect(number(target, "x") + number(target, "width") / 2).toBeCloseTo(expected.x, 5);
        expect(number(target, "y") + number(target, "height") / 2).toBeCloseTo(expected.y, 5);
      }
    }
    // Contacts identified independently from the supplied drawing's labels, including A6/A7.
    for (const [pin, x, y] of [["12", 88.7137, 38.258], ["2", 294.9437, 38.258], ["0", 356.8127, 38.258], ["1", 377.4357, 38.258], ["13", 88.7217, 163.298], ["A0", 150.5907, 163.298], ["A6", 274.3287, 163.298], ["A7", 294.9517, 163.298]] as const) {
      const state = element(overlay, `pin-${pin}-state`);
      expect(number(state, "cx"), pin).toBeCloseTo((x - 40) / 2, 5);
      expect(number(state, "cy"), pin).toBeCloseTo((y - 27) / 2, 5);
    }
    expect(overlay.querySelectorAll('[id^="pin-"][id$="-click"]')).toHaveLength(22);
  });

  it("aligns all four LED lenses and reset, with unique namespaced source ids", () => {
    const board = drawing("ArduinoNano.svg");
    const overlay = drawing("ArduinoNano-overlay.svg");
    for (const name of ["tx", "rx", "on", "l"]) {
      const lens = element(board, `nano-led-${name}`);
      const light = element(overlay, `led-${name}`);
      expect(number(light, "x")).toBeCloseTo((number(lens, "x") - 40) / 2, 5);
      expect(number(light, "y")).toBeCloseTo((number(lens, "y") - 27) / 2, 5);
      expect(number(light, "width")).toBeCloseTo(number(lens, "width") / 2, 5);
      expect(number(light, "height")).toBeCloseTo(number(lens, "height") / 2, 5);
      expect(light.getAttribute("fill-opacity")).toBe("0");
    }
    const button = element(board, "nano-reset-surface");
    const reset = element(overlay, "reset-click");
    expect(number(reset, "cx")).toBeCloseTo((number(button, "cx") - 40) / 2, 5);
    expect(number(reset, "cy")).toBeCloseTo((number(button, "cy") - 27) / 2, 5);
    expect(number(reset, "r")).toBeCloseTo(number(button, "r") / 2, 5);
    const ids = [...board.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some(id => /^path\d+$/.test(id))).toBe(false);
  });
});
