import { describe, expect, it } from "vitest";
import { BOARD_IDS, type BoardId } from "@shared/boards";
import { boardDisplayScale, boardView } from "@/lib/board-view";

const drawn = (id: BoardId, width: number, height: number, margin = 4) => {
  const scale = boardDisplayScale(id, width, height, margin);
  const view = boardView(id);
  return { width: view.width * scale, height: view.height * scale, scale };
};

describe("shared board display scale", () => {
  it.each([[640, 400], [1200, 350], [450, 700]])("preserves the approved widths in a %s × %s panel", (width, height) => {
    const uno = drawn("uno", width, height);
    expect(drawn("mega2560", width, height).width / uno.width).toBeCloseTo(1.25, 10);
    expect(drawn("nano", width, height).width / uno.width).toBeCloseTo(0.85, 10);
    expect(drawn("attiny85", width, height).width / uno.width).toBeCloseTo(0.65, 10);
  });

  it.each([[80, 60], [200, 160], [320, 220], [640, 400], [1200, 90], [150, 900]])("fits every board inside a %s × %s panel with the same width order", (width, height) => {
    const boards = Object.fromEntries(BOARD_IDS.map(id => [id, drawn(id, width, height)]));
    for (const board of Object.values(boards)) {
      expect(Number.isFinite(board.scale)).toBe(true);
      expect(board.scale).toBeGreaterThan(0);
      expect(board.width).toBeLessThanOrEqual(width - 8 + 1e-8);
      expect(board.height).toBeLessThanOrEqual(height - 8 + 1e-8);
    }
    expect(boards.mega2560.width).toBeGreaterThan(boards.uno.width);
    expect(boards.uno.width).toBeGreaterThan(boards.nano.width);
    expect(boards.nano.width).toBeGreaterThan(boards.attiny85.width);
  });

  it("softens differences for compact panels without maximising each drawing independently", () => {
    const uno = drawn("uno", 180, 180).width;
    expect(drawn("mega2560", 180, 180).width / uno).toBeCloseTo(1.15, 10);
    expect(drawn("nano", 180, 180).width / uno).toBeCloseTo(0.91, 10);
    expect(drawn("attiny85", 180, 180).width / uno).toBeCloseTo(0.79, 10);
    const midUno = drawn("uno", 320, 240).width;
    const nano = drawn("nano", 320, 240).width / midUno;
    expect(nano).toBeGreaterThan(0.85);
    expect(nano).toBeLessThan(0.91);
  });

  it("never makes a board smaller when its panel grows through the compact transition", () => {
    for (const id of BOARD_IDS) {
      let previousWidth = 0;
      for (let width = 40; width <= 800; width += 4) {
        const next = drawn(id, width, width * 0.65);
        expect(next.width, `${id} at ${width}px`).toBeGreaterThanOrEqual(previousWidth - 1e-8);
        previousWidth = next.width;
      }
    }
  });

  it("does not shrink a compact height-limited drawing when only its panel width grows", () => {
    for (const id of BOARD_IDS) {
      expect(drawn(id, 258, 154.5638).width, id).toBeGreaterThanOrEqual(drawn(id, 243, 154.5638).width - 1e-6);
    }
  });

  it.each(["width", "height"])("does not shrink a board when only %s grows", dimension => {
    for (const fixed of [80, 180, 320]) {
      for (const id of BOARD_IDS) {
        let previous = 0;
        for (let varying = 40; varying <= 800; varying += 8) {
          const next = dimension === "width" ? drawn(id, varying, fixed) : drawn(id, fixed, varying);
          expect(next.width, `${id}: ${dimension}=${varying}, fixed=${fixed}`).toBeGreaterThanOrEqual(previous - 1e-6);
          previous = next.width;
        }
      }
    }
  });

  it.each([[0, 200], [200, 0], [-1, 200], [200, -1], [Number.NaN, 200], [200, Number.POSITIVE_INFINITY], [8, 8]])("returns zero for unusable panel dimensions %s × %s", (width, height) => {
    for (const id of BOARD_IDS) expect(boardDisplayScale(id, width, height)).toBe(0);
  });

  it("honours the safe margin even below the old minimum zoom", () => {
    for (const id of BOARD_IDS) {
      const tiny = drawn(id, 10, 10);
      expect(tiny.width).toBeLessThanOrEqual(2 + 1e-8);
      expect(tiny.height).toBeLessThanOrEqual(2 + 1e-8);
      expect(drawn(id, 640, 400, 16).width).toBeLessThan(drawn(id, 640, 400, 4).width);
    }
  });
});
