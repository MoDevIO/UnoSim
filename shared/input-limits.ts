/**
 * Authoritative limits for data crossing the REST and WebSocket boundary.
 *
 * Keep this module dependency-free so client and server schemas share one
 * contract. Values are intentionally expressed in bytes where payload size is
 * relevant; JavaScript string limits are measured in UTF-16 code units by Zod.
 */
export const INPUT_LIMITS = {
  compile: {
    maxCodeChars: 128 * 1024,
    maxHeaders: 20,
    maxHeaderNameChars: 128,
    maxHeaderContentChars: 32 * 1024,
    maxLibraries: 20,
    maxLibraryNameChars: 128,
    maxFqbnChars: 128,
  },
  webSocket: {
    maxPayloadBytes: 256 * 1024,
    maxSerialInputChars: 4 * 1024,
    maxTestRunIdChars: 64,
  },
  simulation: {
    minTimeoutSeconds: 1,
    defaultTimeoutSeconds: 60,
    maxTimeoutSeconds: 300,
    minPin: 0,
    maxPin: 19,
    minBaudrate: 300,
    maxBaudrate: 115_200,
  },
} as const;

/** URL-safe identifier accepted for test-only artifact namespaces. */
export const TEST_RUN_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${INPUT_LIMITS.webSocket.maxTestRunIdChars}}$`,
);

/** Portable header basename; separators and traversal tokens cannot match. */
export const HEADER_NAME_PATTERN = new RegExp(
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,${INPUT_LIMITS.compile.maxHeaderNameChars - 1}}$`,
);

const WINDOWS_RESERVED_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function isSafeHeaderName(name: string): boolean {
  if (!HEADER_NAME_PATTERN.test(name)) return false;
  const basename = name.split(".")[0]?.toUpperCase();
  return !WINDOWS_RESERVED_BASENAMES.has(basename);
}
