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
export const TEST_RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Portable header basename; separators and traversal tokens cannot match. */
export const HEADER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
