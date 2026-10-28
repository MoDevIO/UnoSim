import { RUNTIME_KINDS, type RuntimeKind } from "@shared/boards";

/** localStorage key of the user's choice in File → Settings → "Simulation engine". */
export const ENGINE_PREFERENCE_KEY = "unoSimulationEngine";
/** Fired on `document` with `detail.value` (a RuntimeKind or null) when the choice changes. */
export const ENGINE_PREFERENCE_EVENT = "simulationEngineChange";

/** Names in the settings dialog (the interface stays English). */
export const ENGINE_LABELS: Readonly<Record<RuntimeKind, string>> = {
  browser: "Emulation",
  "host-mock": "Legacy",
};

export const isRuntimeKind = (value: unknown): value is RuntimeKind =>
  typeof value === "string" && (RUNTIME_KINDS as readonly string[]).includes(value);

export interface RuntimeSelectionInput {
  /** Backends the server offers (`/api/config`). */
  readonly offered: readonly RuntimeKind[];
  /** Runtimes the selected board supports (board catalog). */
  readonly boardRuntimes: readonly RuntimeKind[];
  /** The user's stored choice, if any. */
  readonly userChoice?: RuntimeKind;
  /** The server's default (`runtime.default`). */
  readonly serverDefault: RuntimeKind;
}

/** Runtimes that are both offered by the server and supported by the board, in the order the server lists them. */
export function usableRuntimes({ offered, boardRuntimes }: Pick<RuntimeSelectionInput, "offered" | "boardRuntimes">): RuntimeKind[] {
  return offered.filter((kind) => boardRuntimes.includes(kind));
}

/**
 * The runtime of the next run (plan P3.1): the user's choice if the server
 * offers it and the board supports it, else the server default under the same
 * conditions, else the first usable one. `undefined` when nothing is usable.
 */
export function selectRuntime(input: RuntimeSelectionInput): RuntimeKind | undefined {
  const usable = usableRuntimes(input);
  if (input.userChoice !== undefined && usable.includes(input.userChoice)) return input.userChoice;
  if (usable.includes(input.serverDefault)) return input.serverDefault;
  return usable[0];
}

/** The stored choice; unreadable storage or an unknown value is no choice. */
export function readEnginePreference(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): RuntimeKind | undefined {
  try {
    const stored = storage?.getItem(ENGINE_PREFERENCE_KEY);
    return isRuntimeKind(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Stores the choice (`undefined` clears it) and tells other parts of the page. */
export function storeEnginePreference(kind: RuntimeKind | undefined, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()): void {
  try {
    if (kind === undefined) storage?.removeItem(ENGINE_PREFERENCE_KEY);
    else storage?.setItem(ENGINE_PREFERENCE_KEY, kind);
  } catch {
    // storage unavailable: the choice then lasts for this page view only, through the event below
  }
  try {
    document.dispatchEvent(new CustomEvent(ENGINE_PREFERENCE_EVENT, { detail: { value: kind ?? null } }));
  } catch {
    // no document (tests without DOM)
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
