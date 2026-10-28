import { BOARD_IDS, BOARD_STATUSES, type BoardId, type BoardStatus, DEFAULT_BOARD_ID, type RuntimeKind } from "@shared/boards";
import { isRuntimeKind } from "./runtime-selection";

/** The part of `GET /api/config` that concerns boards and runtimes (plan 4.11). */
export interface RuntimeConfig {
  readonly backends: readonly RuntimeKind[];
  readonly defaultRuntime: RuntimeKind;
  readonly boards: ReadonlyArray<{ readonly id: BoardId; readonly displayName: string; readonly status: BoardStatus; readonly runtimes: readonly RuntimeKind[] }>;
  readonly defaultBoard: BoardId;
}

/** What a server without these fields (older version, unreachable) means: the host mock for the Uno. */
export const FALLBACK_RUNTIME_CONFIG: RuntimeConfig = {
  backends: ["host-mock"],
  defaultRuntime: "host-mock",
  boards: [{ id: DEFAULT_BOARD_ID, displayName: "Arduino UNO", status: "available", runtimes: ["host-mock"] }],
  defaultBoard: DEFAULT_BOARD_ID,
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const kinds = (value: unknown): RuntimeKind[] => (Array.isArray(value) ? value.filter(isRuntimeKind) : []);
const isBoardId = (value: unknown): value is BoardId => typeof value === "string" && (BOARD_IDS as readonly string[]).includes(value);

/** Validates the answer of `/api/config`; whatever is missing or malformed falls back to the Uno with the host mock. */
export function parseRuntimeConfig(json: unknown): RuntimeConfig {
  if (!isObject(json) || !isObject(json.runtime)) return FALLBACK_RUNTIME_CONFIG;
  const backends = kinds(json.runtime.backends);
  if (backends.length === 0) return FALLBACK_RUNTIME_CONFIG;
  const defaultRuntime = isRuntimeKind(json.runtime.default) && backends.includes(json.runtime.default) ? json.runtime.default : backends[0];
  const boards = (Array.isArray(json.boards) ? json.boards : [])
    .filter(isObject)
    .filter((board) => isBoardId(board.id) && typeof board.displayName === "string")
    .map((board) => ({
      id: board.id as BoardId,
      displayName: board.displayName as string,
      // A server that does not report a status (older version) offers the board as it always did.
      status: (BOARD_STATUSES as readonly unknown[]).includes(board.status) ? (board.status as BoardStatus) : ("available" as BoardStatus),
      runtimes: kinds(board.runtimes),
    }));
  if (boards.length === 0) return { ...FALLBACK_RUNTIME_CONFIG, backends, defaultRuntime, boards: [{ ...FALLBACK_RUNTIME_CONFIG.boards[0], runtimes: backends }] };
  const defaultBoard = isBoardId(json.defaultBoard) && boards.some((board) => board.id === json.defaultBoard) ? json.defaultBoard : boards[0].id;
  return { backends, defaultRuntime, boards, defaultBoard };
}

let cachedConfig: Promise<RuntimeConfig> | undefined;

/**
 * Loads the runtime configuration from `/api/config` once per page view. A failed
 * request is not cached, so the next caller tries again; the caller gets the
 * fallback meanwhile.
 */
export function loadRuntimeConfig(request: typeof fetch = fetch): Promise<RuntimeConfig> {
  cachedConfig ??= (async () => {
    const response = await request("/api/config", { cache: "no-store", credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseRuntimeConfig(await response.json());
  })().catch(() => {
    cachedConfig = undefined;
    return FALLBACK_RUNTIME_CONFIG;
  });
  return cachedConfig;
}

/** Test hook: forget the cached answer. */
export function resetRuntimeConfigCache(): void {
  cachedConfig = undefined;
}
