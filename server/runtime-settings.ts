import {
  BOARD_CATALOG, BOARD_IDS, type BoardId, DEFAULT_BOARD_ID, RUNTIME_KINDS, type RuntimeKind, enabledBoards, findBoardByFqbn, getBoard,
} from "../shared/boards";

/**
 * Runtime backends, runtime default, offered boards and default board of a
 * deployment (plan 4.11, P2.6). Pure: reads only the environment it is given.
 */
export interface RuntimeSettings {
  /** Offered backends. Without `host-mock` no sandbox runner pool starts. */
  readonly backends: readonly RuntimeKind[];
  readonly defaultRuntime: RuntimeKind;
  /** `UNOSIM_BOARDS`; undefined = every board with status `preview` or `available`. */
  readonly boards: readonly BoardId[] | undefined;
  readonly defaultBoard: BoardId;
}

export interface RuntimeSettingsOptions {
  /** Whether the Docker profile compiles in the compile sandbox the `browser` backend needs (package P2.4); the image itself is a startup check. */
  readonly compileSandboxAvailable?: boolean;
}

function parseList(name: string, raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw new Error(`${name} must not be empty`);
  if (new Set(items).size !== items.length) throw new Error(`${name} lists a value twice`);
  return items;
}

function parseChoice<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${name}: unknown value "${value}" (allowed: ${allowed.join(", ")})`);
  return value as T;
}

function parseBackends(env: NodeJS.ProcessEnv, serverMode: "local" | "docker", options: RuntimeSettingsOptions): RuntimeKind[] {
  const listed = parseList("UNOSIM_RUNTIME_BACKENDS", env.UNOSIM_RUNTIME_BACKENDS);
  const defaults: RuntimeKind[] = serverMode === "local" ? ["browser", "host-mock"] : ["host-mock"];
  const backends = listed ? listed.map((item) => parseChoice("UNOSIM_RUNTIME_BACKENDS", item, RUNTIME_KINDS)) : defaults;
  if (serverMode === "docker" && backends.includes("browser") && !options.compileSandboxAvailable) {
    throw new Error("UNOSIM_RUNTIME_BACKENDS: the browser backend needs the compile sandbox in the Docker profile (plan P2.4)");
  }
  return backends;
}

/** `ARDUINO_FQBN` is accepted as an alias while it names the FQBN of a catalog board. */
function parseDefaultBoard(env: NodeJS.ProcessEnv): BoardId {
  const fromBoard = env.UNOSIM_DEFAULT_BOARD === undefined ? undefined : parseChoice("UNOSIM_DEFAULT_BOARD", env.UNOSIM_DEFAULT_BOARD.trim(), BOARD_IDS);
  if (env.ARDUINO_FQBN === undefined) return fromBoard ?? DEFAULT_BOARD_ID;
  const alias = findBoardByFqbn(env.ARDUINO_FQBN.trim());
  if (!alias) throw new Error(`ARDUINO_FQBN must be the FQBN of a board in the catalog (${BOARD_CATALOG.map((board) => board.fqbn).join(", ")}); use UNOSIM_DEFAULT_BOARD`);
  if (fromBoard !== undefined && fromBoard !== alias.id) throw new Error(`ARDUINO_FQBN (${alias.id}) and UNOSIM_DEFAULT_BOARD (${fromBoard}) name different boards`);
  return alias.id;
}

export function parseRuntimeSettings(env: NodeJS.ProcessEnv, serverMode: "local" | "docker", options: RuntimeSettingsOptions = {}): RuntimeSettings {
  const backends = parseBackends(env, serverMode, options);
  const requestedDefault = env.UNOSIM_DEFAULT_RUNTIME === undefined ? undefined : parseChoice("UNOSIM_DEFAULT_RUNTIME", env.UNOSIM_DEFAULT_RUNTIME.trim(), RUNTIME_KINDS);
  // Milestone M1 (plan P3.10): locally the browser emulation is the default; the Docker profile keeps the host mock until M4.
  const preferBrowser = serverMode === "local" && backends.includes("browser");
  const defaultRuntime = requestedDefault ?? (preferBrowser || !backends.includes("host-mock") ? "browser" : "host-mock");
  if (!backends.includes(defaultRuntime)) throw new Error(`UNOSIM_DEFAULT_RUNTIME (${defaultRuntime}) is not among UNOSIM_RUNTIME_BACKENDS (${backends.join(", ")})`);

  const listedBoards = parseList("UNOSIM_BOARDS", env.UNOSIM_BOARDS);
  const boards = listedBoards?.map((item) => parseChoice("UNOSIM_BOARDS", item, BOARD_IDS));
  const defaultBoard = parseDefaultBoard(env);

  for (const board of enabledBoards(boards, defaultBoard, boards === undefined ? backends : undefined)) {
    if (!board.runtimes.some((runtime) => backends.includes(runtime))) {
      throw new Error(`board ${board.id} needs one of the runtime backends ${getBoard(board.id).runtimes.join(", ")}, but UNOSIM_RUNTIME_BACKENDS offers ${backends.join(", ")}`);
    }
  }
  return { backends, defaultRuntime, boards, defaultBoard };
}
