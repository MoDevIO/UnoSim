import { describe, expect, it } from "vitest";
import { BOARD_HARDWARE_IDS, boardHardware, hasBoardHardware } from "@unosim/avr-emulator/boards";
import {
  BOARD_CATALOG, BOARD_IDS, BOARD_STATUSES, DEFAULT_BOARD_ID, RUNTIME_KINDS, boardIdSchema, boardPinAliases, enabledBoards, findBoardByFqbn, fqbnAllowlist, getBoard,
} from "../../shared/boards";

describe("board catalog (plan 4.3, P2.1)", () => {
  it("lists the four boards of the plan, all planned for now", () => {
    expect(BOARD_CATALOG.map((board) => board.id)).toEqual(["uno", "nano", "mega2560", "attiny85"]);
    expect(BOARD_CATALOG.every((board) => board.status === "planned")).toBe(true);
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
    it("offers only the default board while every board is planned", () => {
      expect(enabledBoards().map((board) => board.id)).toEqual([DEFAULT_BOARD_ID]);
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

    it("has none for boards without a hardware profile yet", () => {
      expect(boardPinAliases("mega2560")).toBeUndefined();
      expect(boardPinAliases("attiny85")).toBeUndefined();
    });
  });
});
