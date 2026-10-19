import { describe, expect, it, vi } from "vitest";
import {
  BOARD_PREFERENCE_EVENT, BOARD_PREFERENCE_KEY, isSelectableBoard, readBoardPreference, selectBoard, storeBoardPreference,
} from "../../../../client/src/lib/runtime/board-selection";

const config = {
  defaultBoard: "uno" as const,
  boards: [
    { id: "uno" as const, displayName: "Arduino UNO", status: "available" as const, runtimes: ["browser" as const] },
    { id: "nano" as const, displayName: "Arduino Nano", status: "preview" as const, runtimes: ["browser" as const] },
    { id: "mega2560" as const, displayName: "Arduino Mega 2560", status: "planned" as const, runtimes: ["browser" as const] },
  ],
};

describe("board selection (plan P4.5)", () => {
  it("selects the stored board if the server offers it and it is selectable", () => {
    expect(selectBoard(config, "nano")?.id).toBe("nano");
  });

  it("falls back to the server's default for nothing stored, an unknown board or a planned one", () => {
    expect(selectBoard(config, undefined)?.id).toBe("uno");
    expect(selectBoard(config, "attiny85")?.id).toBe("uno");
    expect(selectBoard(config, "mega2560")?.id).toBe("uno");
  });

  it("takes the first board when the default is not in the list", () => {
    expect(selectBoard({ ...config, defaultBoard: "attiny85" }, undefined)?.id).toBe("uno");
  });

  it("calls planned boards not selectable and preview and available ones selectable", () => {
    expect(config.boards.map(isSelectableBoard)).toEqual([true, true, false]);
  });

  it("reads a stored board and ignores an unknown value or unreadable storage", () => {
    expect(readBoardPreference({ getItem: () => "nano" })).toBe("nano");
    expect(readBoardPreference({ getItem: () => "esp32" })).toBeUndefined();
    expect(readBoardPreference({ getItem: () => { throw new Error("blocked"); } })).toBeUndefined();
    expect(readBoardPreference(undefined)).toBeUndefined();
  });

  it("stores the choice, clears it, tells the page, and survives blocked storage", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const heard: unknown[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent).detail.value);
    document.addEventListener(BOARD_PREFERENCE_EVENT, listener);
    try {
      storeBoardPreference("nano", { setItem, removeItem });
      storeBoardPreference(undefined, { setItem, removeItem });
      storeBoardPreference("uno", { setItem: () => { throw new Error("blocked"); }, removeItem });
    } finally {
      document.removeEventListener(BOARD_PREFERENCE_EVENT, listener);
    }

    expect(setItem).toHaveBeenCalledWith(BOARD_PREFERENCE_KEY, "nano");
    expect(removeItem).toHaveBeenCalledWith(BOARD_PREFERENCE_KEY);
    expect(heard).toEqual(["nano", null, "uno"]);
  });
});
