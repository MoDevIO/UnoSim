import type { BoardId, BoardStatus } from "@shared/boards";

export interface BoardOption {
  readonly id: BoardId;
  readonly displayName: string;
  readonly status: BoardStatus;
}

/** What to ask when an example is written for another board than the selected one (plan P4.6). */
export interface ExampleBoardPrompt {
  readonly exampleBoard: BoardId;
  readonly exampleBoardName: string;
  readonly selectedBoardName: string;
  /** The server offers the example's board and it can be selected: "Switch board" is possible. */
  readonly canSwitch: boolean;
}

/**
 * `undefined` when the example fits (no board named, or the selected one); otherwise the question to put to
 * the user. A board the server does not offer, or one that is only planned, cannot be switched to.
 */
export function exampleBoardPrompt(
  exampleBoard: BoardId | undefined,
  selected: BoardOption | undefined,
  offered: readonly BoardOption[],
): ExampleBoardPrompt | undefined {
  if (exampleBoard === undefined || exampleBoard === selected?.id) return undefined;
  const target = offered.find((board) => board.id === exampleBoard);
  return {
    exampleBoard,
    exampleBoardName: target?.displayName ?? exampleBoard,
    selectedBoardName: selected?.displayName ?? "the current board",
    canSwitch: target !== undefined && target.status !== "planned",
  };
}
