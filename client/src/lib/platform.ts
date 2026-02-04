/**
 * Platform detection utilities
 */

/**
 * Detects if the current platform is macOS
 */
export const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

