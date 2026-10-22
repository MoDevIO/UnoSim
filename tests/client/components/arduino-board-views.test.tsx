import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardView } from "@/lib/board-view";

const publicFile = (path: string) => readFileSync(join(__dirname, "../../../client/public", path), "utf8");

// The component itself is covered by the browser tests (e2e): rendering it with jsdom does not return, also before P4.4.
describe("board view per board (plan P4.4)", () => {
  it("draws the Uno as before and the Nano with its own graphics and size", () => {
    expect(boardView("uno")).toEqual({ boardSvg: "/ArduinoUno.svg", overlaySvg: "/ArduinoUno-overlay.svg", width: 285.2, height: 209 });
    expect(boardView("nano")).toEqual({ boardSvg: "/ArduinoNano.svg", overlaySvg: "/ArduinoNano-overlay.svg", width: 172.8, height: 72 });
    expect(boardView()).toBe(boardView("uno"));
    expect(boardView("attiny85")).toBe(boardView("uno")); // no graphics yet
    expect(boardView("mega2560")).toMatchObject({ boardSvg: "/ArduinoMega.svg", overlaySvg: "/ArduinoMega-overlay.svg", width: 406.4, height: 213.2 });
    expect(boardView("mega2560").logo).toEqual({ left: 74, top: 38, width: 20, height: 10 });
    expect(boardView("uno").logo).toBeUndefined(); // the Uno keeps the mark where it was
  });

  it("gives the Mega overlay the id convention for pins 0–53, A0–A15, the LEDs and the reset button", () => {
    const overlay = publicFile("ArduinoMega-overlay.svg");
    const ids = new Set([...overlay.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    const names = [...Array.from({ length: 54 }, (_, pin) => String(pin)), ...Array.from({ length: 16 }, (_, channel) => `A${channel}`)];

    for (const name of names) {
      for (const part of ["", "-click", "-state", "-frame"]) expect(ids.has(`pin-${name}${part}`), `pin-${name}${part}`).toBe(true);
    }
    for (const id of ["led-l", "led-on", "led-tx", "led-rx", "reset-click"]) expect(ids.has(id), id).toBe(true);
    expect(overlay.match(/id="pin-[^"]+-click"/g)).toHaveLength(70);
  });

  it("draws the Mega at the size of its overlay's view box", () => {
    const { width, height } = boardView("mega2560");
    for (const file of ["ArduinoMega.svg", "ArduinoMega-overlay.svg"]) {
      expect(publicFile(file)).toContain(`viewBox="-4 -4 ${width + 8} ${Number((height + 8).toFixed(1))}"`);
    }
  });

  it("gives the Nano overlay the id convention of the Uno for every pin, the LEDs and the reset button", () => {
    const overlay = publicFile("ArduinoNano-overlay.svg");
    const ids = new Set([...overlay.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

    for (const pin of ["0", "1", ...Array.from({ length: 12 }, (_, index) => String(index + 2)), "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
      for (const part of ["", "-click", "-state", "-frame"]) expect(ids.has(`pin-${pin}${part}`), `pin-${pin}${part}`).toBe(true);
    }
    for (const id of ["led-l", "led-on", "led-tx", "led-rx", "reset-click"]) expect(ids.has(id), id).toBe(true);
  });
});
