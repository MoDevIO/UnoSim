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
    expect(boardView("mega2560")).toBe(boardView("uno")); // no graphics yet
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
