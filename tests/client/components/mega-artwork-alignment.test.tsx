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
const centre = (node: Element) => ({
  x: number(node, "x") + number(node, "width") / 2,
  y: number(node, "y") + number(node, "height") / 2,
});
const pinNames = [...Array.from({ length: 54 }, (_, pin) => String(pin)), ...Array.from({ length: 16 }, (_, pin) => `A${pin}`)];

describe("the supplied Mega artwork and its interactive overlay", () => {
  it("uses the supplied drawing's proportions in both layers and the board view", () => {
    const board = drawing("ArduinoMega.svg");
    const overlay = drawing("ArduinoMega-overlay.svg");
    expect(element(board, "mega-artwork").getAttribute("transform")).toBe("scale(0.25)");
    const viewBox = [0, 0, 1755.62 / 4, 855.06 / 4];
    for (const document of [board, overlay]) {
      expect(document.documentElement.getAttribute("viewBox")?.split(/\s+/).map(Number)).toEqual(viewBox);
    }
    expect(boardView("mega2560")).toMatchObject({ width: viewBox[2], height: viewBox[3] });
  });

  it("centres every logical pin on its actual contact, including the two distant rows", () => {
    const board = drawing("ArduinoMega.svg");
    const overlay = drawing("ArduinoMega-overlay.svg");
    for (const pin of pinNames) {
      const pad = centre(element(board, `mega-pad-${pin}`));
      const state = element(overlay, `pin-${pin}-state`);
      const frame = centre(element(overlay, `pin-${pin}-frame`));
      const click = centre(element(overlay, `pin-${pin}-click`));
      for (const actual of [{ x: number(state, "cx"), y: number(state, "cy") }, frame, click]) {
        expect(actual.x, `pin ${pin}: x`).toBeCloseTo(pad.x / 4, 5);
        expect(actual.y, `pin ${pin}: y`).toBeCloseTo(pad.y / 4, 5);
      }
    }
    // Independently identified contacts of the supplied drawing: these catch a shifted pin order.
    for (const [pin, x, y] of [["13", 588.885, 34.375], ["0", 1152.465, 33.365], ["22", 1642.385, 72.985], ["53", 1680.955, 699.005], ["A0", 947.075, 823.605], ["A15", 1600.865, 823.595]] as const) {
      const state = element(overlay, `pin-${pin}-state`);
      expect(number(state, "cx")).toBeCloseTo(x / 4, 5);
      expect(number(state, "cy")).toBeCloseTo(y / 4, 5);
    }
  });

  it("shares D20/D21 state and click availability with their SDA/SCL duplicate sockets", () => {
    const board = drawing("ArduinoMega.svg");
    const overlay = drawing("ArduinoMega-overlay.svg");
    for (const [pin, alias] of [[20, "sda"], [21, "scl"]] as const) {
      const pad = centre(element(board, `mega-pad-${pin}-${alias}`));
      const state = element(overlay, `pin-${pin}-state`);
      for (const part of ["state", "frame", "click"]) {
        const duplicate = element(overlay, `pin-${pin}-${alias}-${part}`);
        expect(duplicate.tagName).toBe("use");
        expect(duplicate.getAttribute("href")).toBe(`#pin-${pin}-${part}`);
        expect(number(state, "cx") + number(duplicate, "x")).toBeCloseTo(pad.x / 4, 5);
        expect(number(state, "cy") + number(duplicate, "y")).toBeCloseTo(pad.y / 4, 5);
      }
    }
  });

  it("places all LED lenses and the reset target on their drawn parts, with no permanently lit source LEDs", () => {
    const board = drawing("ArduinoMega.svg");
    const overlay = drawing("ArduinoMega-overlay.svg");
    for (const [led, source] of [["l", "led_l_off"], ["on", "led_l_off-2"], ["tx", "led_l_off-3"], ["rx", "led_l_off-4"]]) {
      const lens = element(board, `mega-source-${source}`);
      const light = element(overlay, `led-${led}`);
      for (const attribute of ["x", "y", "width", "height"]) {
        expect(number(light, attribute), `${led}: ${attribute}`).toBeCloseTo(number(lens, attribute) / 4, 5);
      }
      expect(light.getAttribute("fill-opacity")).toBe("0");
    }
    const button = element(board, "mega-source-button_off");
    const target = element(overlay, "reset-click");
    for (const attribute of ["cx", "cy", "r"]) expect(number(target, attribute)).toBeCloseTo(number(button, attribute) / 4, 5);
    const sourceLights = board.querySelectorAll('[data-source-led-glow]');
    expect(sourceLights).toHaveLength(2);
    for (const glow of sourceLights) expect(glow.getAttribute("display")).toBe("none");
    const ids = [...board.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
