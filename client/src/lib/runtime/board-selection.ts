import { BOARD_IDS, type BoardId, type BoardStatus } from "@shared/boards";
import type { RuntimeConfig } from "./runtime-config";

/** localStorage key of the board chosen in Tools → Board (plan P4.5). */
export const BOARD_PREFERENCE_KEY = "unoSelectedBoard";
/** Fired on `document` with `detail.value` (a BoardId or null) when the choice changes. */
export const BOARD_PREFERENCE_EVENT = "selectedBoardChange";

export const isBoardId = (value: unknown): value is BoardId => typeof value === "string" && (BOARD_IDS as readonly string[]).includes(value);

type ConfigBoard = RuntimeConfig["boards"][number];

/** `planned` boards are not selectable; `preview` boards are, with a notice (plan P4.5). */
export const isSelectableBoard = (board: { readonly status: BoardStatus }): boolean => board.status !== "planned";

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored choice; unreadable storage or an unknown value is no choice. */
export function readBoardPreference(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): BoardId | undefined {
  try {
    const stored = storage?.getItem(BOARD_PREFERENCE_KEY);
    return isBoardId(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Stores the choice (`undefined` clears it) and tells other parts of the page. */
export function storeBoardPreference(board: BoardId | undefined, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()): void {
  try {
    if (board === undefined) storage?.removeItem(BOARD_PREFERENCE_KEY);
    else storage?.setItem(BOARD_PREFERENCE_KEY, board);
  } catch {
    // storage unavailable: the choice then lasts for this page view only, through the event below
  }
  try {
    document.dispatchEvent(new CustomEvent(BOARD_PREFERENCE_EVENT, { detail: { value: board ?? null } }));
  } catch {
    // no document (tests without DOM)
  }
}

/**
 * The board of the next compile and run: the stored choice if the server offers
 * it and it is selectable, else the server's default board.
 */
export function selectBoard(config: Pick<RuntimeConfig, "boards" | "defaultBoard">, stored: BoardId | undefined): ConfigBoard | undefined {
  const chosen = stored === undefined ? undefined : config.boards.find((board) => board.id === stored && isSelectableBoard(board));
  return chosen ?? config.boards.find((board) => board.id === config.defaultBoard) ?? config.boards[0];
}
