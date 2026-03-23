/**
 * Platform detection utilities
 */

/**
 * Detects if the current platform is macOS
 */
export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|Macintosh/.test(navigator.userAgent);

