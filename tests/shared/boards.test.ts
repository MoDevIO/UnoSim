import { describe, expect, it } from "vitest";
import { BOARD_HARDWARE_IDS, boardHardware, hasBoardHardware } from "@unosim/avr-emulator/boards";
import {
  BOARD_CATALOG, BOARD_IDS, BOARD_STATUSES, DEFAULT_BOARD_ID, RUNTIME_KINDS, boardIdSchema, boardPinAliases, enabledBoards, findBoardByFqbn, fqbnAllowlist, getBoard,
} from "../../shared/boards";

describe("board catalog (plan 4.3, P2.1)", () => {
  it("lists the four boards of the plan: the Uno is available since M1, the Nano is in preview, the others are planned", () => {
    expect(BOARD_CATALOG.map((board) => board.id)).toEqual(["uno", "nano", "mega2560", "attiny85"]);
    expect(BOARD_CATALOG.map((board) => board.status)).toEqual(["available", "preview", "planned", "planned"]);
  });

  it("has exactly the boards of the emulation package", () => {
    expect([...BOARD_IDS].sort()).toEqual([...BOARD_HARDWARE_IDS].sort());
  });

  it("has hardware in the package for every board that is not merely planned or that already has a profile", () => {
    for (const board of BOARD_CATALOG) {
      if (board.status !== "planned") expect(hasBoardHardware(board.id), board.id).toBe(true);
    }
    expect(hasBoardHardware("uno") && hasBoardHardware("nano")).toBe(true);
  });

  it("gives every board a unique FQBN that is in the compile allowlist", () => {
    const fqbns = BOARD_CATALOG.map((board) => board.fqbn);
    const allowlist = fqbnAllowlist();

    expect(new Set(fqbns).size).toBe(fqbns.length);
    for (const board of BOARD_CATALOG) expect(allowlist, board.id).toContain(board.fqbn);
    expect(allowlist).not.toContain("esp32:esp32:esp32");
  });

  it("uses pinned cores and known runtimes and statuses", () => {
    for (const board of BOARD_CATALOG) {
      expect(board.core.version, board.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(board.fqbn.startsWith(`${board.core.id}:`), board.id).toBe(true);
      expect(board.runtimes.length).toBeGreaterThan(0);
      for (const runtime of board.runtimes) expect(RUNTIME_KINDS).toContain(runtime);
      expect(BOARD_STATUSES).toContain(board.status);
    }
  });

  it("offers the host mock only for the Uno (appendix A)", () => {
    expect(BOARD_CATALOG.filter((board) => board.runtimes.includes("host-mock")).map((board) => board.id)).toEqual(["uno"]);
  });

  it("validates board ids", () => {
    expect(boardIdSchema.parse("nano")).toBe("nano");
    expect(boardIdSchema.safeParse("esp32").success).toBe(false);
    expect(boardIdSchema.safeParse(undefined).success).toBe(false);
  });

  it("finds boards by id and FQBN", () => {
    expect(getBoard("mega2560").displayName).toBe("Arduino Mega 2560");
    expect(findBoardByFqbn("arduino:avr:nano:cpu=atmega328")?.id).toBe("nano");
    expect(findBoardByFqbn("arduino:avr:nano")).toBeUndefined();
    expect(() => getBoard("esp32" as never)).toThrow(RangeError);
  });

  describe("enabledBoards", () => {
    it("offers the Uno and the Nano (preview) by default, not the planned boards", () => {
      expect(enabledBoards().map((board) => board.id)).toEqual([DEFAULT_BOARD_ID, "nano"]);
    });

    it("offers only the boards the offered backends can run: the Uno alone without the browser backend", () => {
      expect(enabledBoards(undefined, "uno", ["host-mock"]).map((board) => board.id)).toEqual(["uno"]);
      expect(enabledBoards(undefined, "uno", ["browser", "host-mock"]).map((board) => board.id)).toEqual(["uno", "nano"]);
    });

    it("does not filter an explicit list by backend (the startup check rejects an impossible one)", () => {
      expect(enabledBoards(["nano"], "uno", ["host-mock"]).map((board) => board.id)).toEqual(["uno", "nano"]);
    });

    it("offers the requested boards plus the default board, in catalog order", () => {
      expect(enabledBoards(["nano", "attiny85"]).map((board) => board.id)).toEqual(["uno", "nano", "attiny85"]);
      expect(enabledBoards(["mega2560"], "nano").map((board) => board.id)).toEqual(["nano", "mega2560"]);
    });
  });

  describe("boardPinAliases", () => {
    it("derives A0..A5 and LED_BUILTIN for the Uno from the package pin map", () => {
      const uno = boardPinAliases("uno");

      expect(uno).toMatchObject({ A0: 14, A5: 19, LED_BUILTIN: 13 });
      expect(Object.keys(uno ?? {})).toHaveLength(7);
      for (const [alias, pin] of Object.entries(uno ?? {})) {
        if (alias.startsWith("A")) expect(boardHardware("uno").pins.find((p) => p.pin === pin)?.label).toBe(alias);
      }
    });

    it("adds A6 and A7 for the Nano", () => {
      expect(boardPinAliases("nano")).toMatchObject({ A6: 20, A7: 21 });
    });

    it("derives A0..A15 at pins 54..69 for the Mega 2560", () => {
      const mega = boardPinAliases("mega2560");

      expect(mega).toMatchObject({ A0: 54, A8: 62, A15: 69, LED_BUILTIN: 13 });
      expect(Object.keys(mega ?? {})).toHaveLength(17);
    });

    it("has none for boards without a hardware profile yet", () => {
      expect(boardPinAliases("attiny85")).toBeUndefined();
    });
  });
});
